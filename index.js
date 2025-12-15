
import http from 'http';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import crypto from 'crypto';

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
const __dirname  = dirname(__filename);

const app = express();

app.use((req, res, next) => {
  const h = (req.hostname || "").toLowerCase();
  if (h === "albanyjwparking.org") {
    res.redirect(301, "https://www.albanyjwparking.org" + req.originalUrl);
  } else {
    next();
  }
});


app.use(express.urlencoded({ extended: true }));
app.use(express.json());

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64');
  next();
});

app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "script-src": [
        "'self'",
        "https://cdn.jsdelivr.net",
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],
      "style-src": [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://fonts.googleapis.com",
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],
      "img-src": ["'self'", "data:"],
      "font-src": ["'self'", "https://fonts.gstatic.com"],
      "connect-src": isProd
        ? [
            "'self'",
            "https:",
            "https://*.azurewebsites.net",
            "https://albanyjwparking.org",
            "https://api.kickbox.com"
          ]
        : [
            "'self'",
            "http://localhost:3000",
            "https://api.kickbox.com",
            "https://cdn.jsdelivr.net"
          ],
    },
  })
);

// ---- Azure Key Vault ----
const vaultName = 'ApiStorage';
const vaultUrl  = `https://${vaultName}.vault.azure.net`;
const credential    = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);

const secretNameKickbox = 'kickboxBrowser';
const secretNameTwiSid  = 'TwilioSID';
const secretNameTwiTok  = 'TwilioAuthToken';
const secretNameSqlServer = 'AZSQLServer';
const secretNameSqlDb = 'AZSQLDB';
const secretNameSqlPort = 'AZSQLPort'; // if you store port as a secret

async function loadSecrets(retries = 5) {
  let attempt = 0;
  while (true) {
    try {
      log('Loading secrets from Key Vault...');
      const [kb, sid, tok, sqlServer, sqlDb, sqlPort] = await Promise.all([
        secretClient.getSecret(secretNameKickbox),
        secretClient.getSecret(secretNameTwiSid),
        secretClient.getSecret(secretNameTwiTok),
        secretClient.getSecret(secretNameSqlServer),
        secretClient.getSecret(secretNameSqlDb),
        secretClient.getSecret(secretNameSqlPort).catch(() => ({ value: undefined }))
      ]);
      process.env.KICKBOX_API_KEY       = kb.value;
      process.env.TWILIO_ACCOUNT_SID    = sid.value;
      process.env.TWILIO_AUTH_TOKEN     = tok.value;
      process.env.AZSQLServer           = sqlServer.value;
      process.env.AZSQLDB               = sqlDb.value;
      if (sqlPort && sqlPort.value) process.env.AZSQLPort = sqlPort.value;

      log('Loaded secrets:', {
        KICKBOX_API_KEY: !!kb.value,
        TWILIO_ACCOUNT_SID: !!sid.value,
        TWILIO_AUTH_TOKEN: !!tok.value,
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
    const mod    = await import('twilio');
    const twRoot = mod.default ?? mod;
    twClient     = twRoot(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    log('Twilio client initialized.');
  }
  return twClient;
}

// ---- Kickbox: call API directly via Node's built-in fetch ----
async function verifyEmail(email, { timeoutMs = 8000 } = {}) {
  if (!process.env.KICKBOX_API_KEY) {
    throw new Error('KICKBOX_API_KEY missing');
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL('https://api.kickbox.com/v2/verify');
    url.searchParams.set('email', email);
    url.searchParams.set('apikey', process.env.KICKBOX_API_KEY);
    const resp = await fetch(url.toString(), {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Kickbox API error ${resp.status} ${resp.statusText}`);
    }
    const data = await resp.json();
    return data;
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('Kickbox API request timed out');
    }
    throw err;
  } finally {
    clearTimeout(t);
  }
}

// ---- Routes ----
app.get('/health', (req, res) => res.send('OK'));
app.get('/',          (req, res) => res.render('index'));
app.get('/email-pass',(req, res) => res.render('emailPass'));
app.get('/nonProfile',(req, res) => res.render('nonProfile'));
app.post('/submit-basic-info', (req, res) => {
  res.redirect('/volunteerIn');
});
app.post('/submit-advanced-info', (req, res) => {
  res.redirect('/volunteerIn');
});
app.get('/volunteerIn', (req, res) => res.render('volunteerIn'));

app.get('/validate-phone', async (req, res) => {
  try {
    const raw = (req.query.phone || '').toString();
    const digits = raw.replace(/\D+/g, '');
    if (!digits) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;
    const tw = await initTwilio();
    const lookup = await tw.lookups.v2
      .phoneNumbers(e164)
      .fetch({ type: ['carrier'] });
    const carrierType = lookup?.carrier?.type || '';
    const smsCapable = carrierType === 'mobile' || carrierType === 'voip';
    return res.status(200).json({
      valid: true,
      normalized: e164,
      smsCapable,
      carrierType,
      validation_errors: ''
    });
  } catch (err) {
    if (err.status === 404) {
      return res.status(200).json({
        valid: false,
        validation_errors: 'Invalid or unrecognized phone number.'
      });
    }
    logError('Twilio Lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

app.get('/validate-email', async (req, res) => {
  const email = (req.query.email || '').toString().trim();
  if (!email) return res.status(400).json({ valid: false, reason: 'Please enter an email address' });
  if (email.toLowerCase().endsWith('@jwpub.org')) {
    return res.json({ result: 'invalid', reason: 'Domain not allowed' });
  }
  try {
    const result = await verifyEmail(email);
    res.json({ result: result.result, reason: result.reason });
  } catch (err) {
    logError('Kickbox verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

app.get('/whoami', async (req,res) => {
  try { const x = await whoAmI(); res.json(x || {}); }
  catch(e) { res.status(500).json({error: String(e)}) }
});

// ---- 404 handler ----
app.use((req, res, next) => {
    // Set the HTTP status code to 404
    res.status(404);
    
    // Render the 404 EJS view
    res.render('404', { url: req.originalUrl });
});


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
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---- Start after dependencies ready ----
(async () => {
  try {
    log('Starting loadSecrets...');
    await loadSecrets();
    log('Secrets loaded.');

    log('Starting initTwilio...');
    await initTwilio();
    log('Twilio initialized.');

    // Import SQL helpers only after secrets are loaded
    log('Importing SQL helpers...');
    const { getSqlPool } = await import('./lib/sql.js');

    log('Warming up SQL pool...');
    getSqlPool()
      .then(() => log('✅ SQL pool initialized.'))
      .catch(err => logError('⚠️ SQL warm-up failed:', err));

    server.on('error', (err) => {
      logError('Server error:', err);
    });

    log(`Starting server on http://${HOST}:${PORT}...`);
    server.listen(PORT, HOST, () => {
      log(`✅ Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    logError('❌ Failed to start server:', err);
    process.exit(1);
  }
})();
