
// Ensure package.json has: { "type": "module" }

import http from 'http';
import express from 'express';
import path from 'path';
import helmet from 'helmet';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { DefaultAzureCredential } from '@azure/identity';
import { SecretClient } from '@azure/keyvault-secrets';
import crypto from 'crypto';

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
// Prefer env PORT; default to 80 in production and 3000 otherwise
const isProd = process.env.NODE_ENV === 'production';
const PORT = Number(
  process.env.PORT ??
  (isProd ? 80 : 3000)
);
const HOST = '0.0.0.0'; // listen on all interfaces

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const app = express();

// Use Express’ built-in parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Views & static files
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ---- Helmet CSP (switch by environment) ----
app.use((req, res, next) => {
  res.locals.nonce = crypto.randomBytes(16).toString('base64'); // 128-bit nonce
  next();
});


app.use(
  helmet.contentSecurityPolicy({
    useDefaults: true,
    directives: {
      // Base restrictions
      "default-src": ["'self'"],
      "base-uri": ["'self'"],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],

      // Scripts: self + jsDelivr + per-request nonce
      "script-src": [
        "'self'",
        "https://cdn.jsdelivr.net", // Bootstrap/JS libraries
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],

      // Styles: self + jsDelivr + Google Fonts + nonce
      "style-src": [
        "'self'",
        "https://cdn.jsdelivr.net", // Bootstrap CSS
        "https://fonts.googleapis.com", // Google Fonts
        (req, res) => `'nonce-${res.locals.nonce}'`
      ],

      // Images: self + data URLs
      "img-src": ["'self'", "data:"],

      // Fonts: self + Google Fonts static
      "font-src": ["'self'", "https://fonts.gstatic.com"],

      // XHR/fetch/websockets: prod vs dev + Kickbox if needed
      "connect-src": isProd
        ? [
            "'self'",
            "https:",
            "https://*.azurewebsites.net",
            "https://albanyjwparking.org",
            "https://api.kickbox.com" // only if client-side Kickbox calls happen
          ]
        : [
            "'self'",
            "http://localhost:3000",
            "https://api.kickbox.com",
            "https://cdn.jsdelivr.net" // same note as above
          ],
    },
    // reportOnly: false,
  })
);

// ---- Azure Key Vault ----
const vaultName = 'ApiStorage'; // your Key Vault name
const vaultUrl  = `https://${vaultName}.vault.azure.net`;
const credential    = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);

// Secret names (exactly as they exist in KV)
const secretNameKickbox = 'kickboxBrowser';
const secretNameTwiSid  = 'TwilioSID';
const secretNameTwiTok  = 'TwilioAuthToken'


// Load API keys and data

async function delay(ms) {
  return new Promise(res => setTimeout(res, ms));
}

async function loadSecrets(retries = 5) {
  let attempt = 0;
  while (true) {
    try {
      const [kb, sid, tok] = await Promise.all([
        secretClient.getSecret(secretNameKickbox),
        secretClient.getSecret(secretNameTwiSid),
        secretClient.getSecret(secretNameTwiTok),
      ]);

      process.env.KICKBOX_API_KEY       = kb.value;
      process.env.TWILIO_ACCOUNT_SID    = sid.value;
      process.env.TWILIO_AUTH_TOKEN     = tok.value;

      console.log('✅ All secrets loaded from Key Vault.');
      return;
    } catch (err) {
      attempt++;
      console.error(`❌ Failed to load secrets (attempt ${attempt}): ${err.message}`);
      if (attempt >= retries) throw err;
      await delay(Math.min(2000 * attempt, 10000)); // simple backoff
    }
  }
}

// ---- Twilio init (ESM/CJS-safe init) ----


let twClient;

async function initTwilio() {
  if (!twClient) {
    // Works for both CommonJS and ESM builds of the package
    const mod    = await import('twilio');
    const twRoot = mod.default ?? mod;
    twClient     = twRoot(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
    console.log('✅ Twilio client initialized.');
  }
  return twClient;
};

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

    const data = await resp.json(); // { result, reason, ... }
    return data;
  } catch (err) {
    // If aborted, Node throws DOMException: AbortError
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
})
app.get('/volunteerIn', (req, res) => res.render('volunteerIn'));


// Requires initTwilio() and TWILIO_* secrets already loaded
app.get('/validate-phone', async (req, res) => {
  try {
    const raw = (req.query.phone || '').toString();
    const digits = raw.replace(/\D+/g, '');
    if (!digits) {
      return res.status(400).json({ error: 'Phone number required' });
    }
    const e164 = digits.length === 10 ? `+1${digits}` : `+${digits}`;

    const tw = await initTwilio();
    // Twilio Lookup v2 – request carrier data
    const lookup = await tw.lookups.v2
      .phoneNumbers(e164)
      .fetch({ type: ['carrier'] });

    const carrierType = lookup?.carrier?.type || ''; // 'mobile' | 'landline' | 'voip' | ''
    const smsCapable = carrierType === 'mobile' || carrierType === 'voip';

    return res.status(200).json({
      valid: true,
      normalized: e164,
      smsCapable,
      carrierType,
      validation_errors: ''
    });
  } catch (err) {
    // Twilio returns 404 for invalid numbers
    if (err.status === 404) {
      return res.status(200).json({
        valid: false,
        validation_errors: 'Invalid or unrecognized phone number.'
      });
    }
    console.error('Twilio Lookup error:', err);
    return res.status(500).json({ error: 'Lookup failed' });
  }
});

app.get('/validate-email', async (req, res) => {
  const email = (req.query.email || '').toString().trim();
  if (!email) return res.status(400).json({ valid: false, reason: 'Please enter an email address' });

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
    await loadSecrets();
    await initTwilio();

    server.on('error', (err) => {
      // Make bind errors crystal-clear in dev
      if (err.code === 'EACCES') {
        console.error(`❌ Permission denied binding to ${HOST}:${PORT}. On Windows, port 80 is often reserved by HTTP.sys/IIS. Set PORT=3000 or free port 80.`);
      } else if (err.code === 'EADDRINUSE') {
        console.error(`❌ Address in use: ${HOST}:${PORT}. Another process is listening already.`);
      } else {
        console.error('❌ Server listen error:', err);
      }
      process.exit(1);
    });

    server.listen(PORT, HOST, () => {
      console.log(`✅ Server running on http://${HOST}:${PORT}`);
    });
  } catch (err) {
    console.error('❌ Failed to start server:', err);
    process.exit(1);
  }
})();
