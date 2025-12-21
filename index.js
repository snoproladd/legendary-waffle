
import dotenv from 'dotenv';
import http from 'http';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import crypto from 'crypto';
import cookieParser from 'cookie-parser';
import session from 'express-session';
import csurf from 'csurf';

// ✅ Load .env for local development
dotenv.config();

function log(...args) {
  console.log(`[${new Date().toISOString()}] [index.js]`, ...args);
}
function logError(...args) {
  console.error(`[${new Date().toISOString()}] [index.js]`, ...args);
}

// ---- Crypto (Node) ----
if (typeof globalThis.crypto === 'undefined') {
  import('crypto')
    .then(({ webcrypto, default: cjsCrypto }) => {
      globalThis.crypto = webcrypto ?? cjsCrypto;
    })
    .catch(err => logError('Failed to load Node crypto:', err));
}

// ---- Basics ----
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? (isProd ? 80 : 3000));
const HOST = '0.0.0.0';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();

// --- Early middleware ---
app.use((req, res, next) => {
  const h = (req.hostname || "").toLowerCase();
  if (h === "albanyjwparking.org") {
    res.redirect(301, "https://www.albanyjwparking.org" + req.originalUrl);
  } else {
    next();
  }
});
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ---- Azure Key Vault ----
const vaultName = 'ApiStorage';
const vaultUrl = `https://${vaultName}.vault.azure.net`;
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);

const secretNames = [
  { name: 'kickboxBrowser', env: 'KICKBOX_API_KEY' },
  { name: 'TwilioSID', env: 'TWILIO_ACCOUNT_SID' },
  { name: 'TwilioAuthToken', env: 'TWILIO_AUTH_TOKEN' },
  { name: 'AZSQLServer', env: 'AZSQLServer' },
  { name: 'AZSQLDB', env: 'AZSQLDB' },
  { name: 'AZSQLPort', env: 'AZSQLPort' },
  { name: 'CookieSession', env: 'AZSessionCookie' }
];

async function loadSecrets(retries = 5) {
  let attempt = 0;
  while (true) {
    try {
      log('Loading secrets from Key Vault...');
      const secrets = await Promise.all(
        secretNames.map(s =>
          secretClient.getSecret(s.name).catch(() => ({ value: undefined }))
        )
      );
      secrets.forEach((secret, i) => {
        if (secret.value) process.env[secretNames[i].env] = secret.value;
      });
      log('Loaded secrets:', {
        AZSQLServer: process.env.AZSQLServer,
        AZSQLDB: process.env.AZSQLDB,
        AZSQLPort: process.env.AZSQLPort
      });
      return;
    } catch (err) {
      attempt++;
      logError(`Failed to load secrets (attempt ${attempt}): ${err.message}`);
      if (attempt >= retries) throw err;
      await new Promise(res => setTimeout(res, Math.min(2000 * attempt, 10000)));
    }
  }
}

let twClient;
async function initTwilio() {
  if (!twClient) {
    log('Initializing Twilio...');
    const mod = await import('twilio');
    const twRoot = mod.default ?? mod;
    twClient = twRoot(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    log('Twilio client initialized.');
  }
  return twClient;
}

// ---- Server & graceful shutdown ----
const server = http.createServer(app);
function shutdown(signal) {
  log(`Received ${signal}. Closing server...`);
  server.close(err => {
    if (err) {
      logError('Error during server close:', err);
      process.exit(1);
    }
    log('Server closed. Exiting.');
    process.exit(0);
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// ---- Startup sequence ----
(async () => {
  try {
    log('Starting loadSecrets...');
    await loadSecrets();

    // ✅ Register session middleware after secrets are loaded
    app.use(session({
      secret: process.env.AZSessionCookie || 'fallback-secret',
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true }
    }));

    const csrfProtection = csurf({ cookie: true });
    app.use((req, res, next) => {
      res.locals.nonce = crypto.randomBytes(16).toString('base64');
      next();
    });

    app.use(helmet.contentSecurityPolicy({
      useDefaults: true,
      directives: {
        "default-src": ["'self'"],
        "script-src": ["'self'", "https://cdn.jsdelivr.net", (req, res) => `'nonce-${res.locals.nonce}'`],
        "style-src": ["'self'", "https://cdn.jsdelivr.net", "https://fonts.googleapis.com", (req, res) => `'nonce-${res.locals.nonce}'`],
        "img-src": ["'self'", "data:"],
        "font-src": ["'self'", "https://fonts.gstatic.com"],
        "connect-src": isProd ? ["'self'", "https:", "https://*.azurewebsites.net", "https://albanyjwparking.org", "https://api.kickbox.com"]
                              : ["'self'", "http://localhost:3000", "https://api.kickbox.com", "https://cdn.jsdelivr.net"]
      }
    }));

    // ✅ Import routes and DB helpers AFTER secrets are ready
    const dbRoutes = (await import('./routes/volunteers.js')).default;
    const { exec, insertEmailPass, insertNameAndPhone, namePhoneExists } = await import('./lib/dbSync.js');
    const { getSqlPool } = await import('./lib/sql.js');

    app.use('/api', dbRoutes);

    // ✅ Routes
    app.get('/health', (req, res) => res.send('OK'));
    app.get('/', csrfProtection, (req, res) => res.render('index', { csrfToken: req.csrfToken() }));
    // ... (keep your other routes unchanged)

    // ✅ Start server
    server.listen(PORT, HOST, () => log(`✅ Server running on http://${HOST}:${PORT}`));

    // ✅ Initialize Twilio and SQL pool
    await initTwilio();
    log('Twilio initialized.');
    await getSqlPool();
    log('✅ SQL pool initialized.');

  } catch (err) {
    logError('❌ Failed to start server:', err);
    process.exit(1);
  }
})();
