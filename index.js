
// Ensure package.json has: { "type": "module" }

import http from 'http';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import crypto from 'crypto'

// ---- Crypto (Node) ----
// Provide WebCrypto in Node if not present; harmless in browsers.
if (typeof globalThis.crypto === 'undefined') {
  import('crypto')
    .then(({ webcrypto, default: cjsCrypto }) => {
      globalThis.crypto = webcrypto ?? cjsCrypto;
    })
    .catch(err => console.error('Failed to load Node crypto:', err));
}

// ---- Basics ----
const PORT = process.env.PORT || 80;   // matches WEBSITES_PORT=80
const HOST = '0.0.0.0';                // listen on all interfaces

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();


// Use Express’ built-in parsers (no need for body-parser)
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Views & static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helmet CSP (switch by environment) ----
const isProd = process.env.NODE_ENV === 'production';

app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64'); // 128-bit nonce
  next();
});

// 2) CSP with nonces and your allowed sources
app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true, // includes base sensible defaults
    directives: {
      // Base restrictions
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],

      // Scripts: self + jsDelivr + per-request nonce (no unsafe-inline)
      "script-src": [
        "'self'",
        "https://cdn.jsdelivr.net",       // your CDN
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],

      // Styles: self + jsDelivr + Google Fonts (no unsafe-inline)
      "style-src": [
        "'self'",
        "https://cdn.jsdelivr.net",       // if you load CSS from jsDelivr
        "https://fonts.googleapis.com",   // Google Fonts CSS
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],

      // Images: self + data URLs (favicons, inline images)
      "img-src": ["'self'", "data:"],

      // Fonts: self + Google Fonts static
      "font-src": ["'self'", "https://fonts.gstatic.com"],

      // XHR/fetch/websockets: prod vs dev
      "connect-src": isProd
        ? ["'self'", "https:", "https://*.azurewebsites.net", "https://albanyjwparking.org"]
        : ["'self'", "http://localhost:3000"],

      // Optional: allow inline event handlers only via nonces (already covered)
      // Optional: upgrade insecure requests (if you might link http assets)
      // "upgrade-insecure-requests": []
    },
    // Optional reporting (CSP Level 3):
    // reportOnly: false,
  })
);


// ---- Azure Key Vault ----
const vaultName = 'ApiStorage';                       // your Key Vault name
const vaultUrl  = `https://${vaultName}.vault.azure.net`;
const credential    = new DefaultAzureCredential();
const secretClient  = new SecretClient(vaultUrl, credential);
const secretName    = 'kickboxBrowser';               // your secret name

async function loadKickboxKey(retries = 5) {
  let attempt = 0;
  const delay = ms => new Promise(res => setTimeout(res, ms));
  while (true) {
    try {
      const secret = await secretClient.getSecret(secretName);
      process.env.KICKBOX_API_KEY = secret.value;
      console.log('✅ Kickbox API key loaded from Key Vault.');
      return;
    } catch (err) {
      attempt++;
      console.error(`❌ Failed to load Kickbox key (attempt ${attempt}): ${err.message}`);
      if (attempt >= retries) throw err;
      await delay(Math.min(2000 * attempt, 10000)); // simple backoff
    }
  }
}

// ---- Kickbox (ESM/CJS-safe init) ----
let kickboxClient;

async function initKickbox() {
  if (!kickboxClient) {
    const mod = await import('kickbox');
    const kbRoot = mod.default ?? mod; // works for both CJS and ESM
    kickboxClient = kbRoot.client(process.env.KICKBOX_API_KEY).kickbox();
    console.log('✅ Kickbox client initialized.');
  }
  return kickboxClient;
}

async function verifyEmail(email) {
  const kb = await initKickbox();
  return new Promise((resolve, reject) => {
    kb.verify(email, (err, response) => {
      if (err) return reject(err);
      resolve(response.body);
    });
  });
}

// ---- Routes ----
app.get('/health', (req, res) => res.send('OK'));
app.get('/',          (req, res) => res.render('index'));
app.get('/email-pass',(req, res) => res.render('emailPass'));
app.get('/nonProfile',(req, res) => res.render('nonProfile'));

app.get('/validate-email', async (req, res) => {
  const email = (req.query.email || '').toString().trim();
  if (!email) return res.status(400).json({ error: 'Email required' });

  // Block jwpub.org domain
  if (email.toLowerCase().endsWith('@jwpub.org')) {
    return res.json({ result: 'invalid', reason: 'Domain not allowed' });
  }

  try {
    const result = await verifyEmail(email);
    res.json({ result: result.result, reason: result.reason });
  } catch (err) {
    console.error('Kickbox verification error:', err);
    res.status(500).json({ error: 'Verification failed' });
  }
});

// ---- Server & graceful shutdown ----
const server = http.createServer(app);

function shutdown(signal) {
  console.log(`Received ${signal}. Closing server...`);
  server.close(err => {
    if (err) {
      console.error('Error during server close:', err);
      process.exit(1);
    }
    console.log('Server closed. Exiting.');
    process.exit(0);
  });
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ---- Start after dependencies ready ----
(async () => {
  try {
    await loadKickboxKey();
    await initKickbox();
    server.listen(PORT, HOST, () => {
      console.log(`✅ Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();
