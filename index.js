
import crypto from 'crypto';
globalThis.crypto = crypto;

import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import helmet from 'helmet';
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";
import kickbox from 'kickbox'

// ✅ Azure Key Vault setup
const vaultName = 'ApiStorage'; // Replace with your Key Vault name
const vaultUrl = `https://${vaultName}.vault.azure.net`;
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);
const secretName = 'kickboxBrowser'; // Replace with your secret name

async function loadKickboxKey() {
  try {
    const secret = await secretClient.getSecret(secretName);
    process.env.KICKBOX_API_KEY = secret.value;
    console.log("✅ Kickbox API key loaded from Key Vault.");
  } catch (err) {
    console.error("❌ Failed to load Kickbox key:", err.message);
    throw err;
  }
}

// ✅ Kickbox initialization (singleton)
let kickboxClient;

async function initKickbox() {
  if (!kickboxClient) {
    kickboxClient = kickbox.kickbox(process.env.KICKBOX_API_KEY);
    console.log("✅ Kickbox client initialized.");
  }
  return kickboxClient;
}

// ✅ Verify email using Kickbox
async function verifyEmail(email) {
  const kb = await initKickbox();
  return new Promise((resolve, reject) => {
    kb.verify(email, (err, response) => {
      if (err) return reject(err);
      resolve(response.body);
    });
  });
}

// ✅ Express setup
const app = express();
const port = process.env.PORT || 80;
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Helmet CSP
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:3000"],
      scriptSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      styleSrc: ["'self'", "https://cdn.jsdelivr.net", "'unsafe-inline'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"]
    }
  })
);

// ✅ Routes
app.get('/', (req, res) => res.render('index'));
app.get('/validate-email', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Email required" });

  // Block jwpub.org domain
  if (email.toLowerCase().endsWith('@jwpub.org')) {
    return res.json({ result: 'invalid', reason: 'Domain not allowed' });
  }

  try {
    const result = await verifyEmail(email);
    res.json({ result: result.result, reason: result.reason });
  } catch (err) {
    console.error("Kickbox verification error:", err);
    res.status(500).json({ error: "Verification failed" });
  }
});

// ✅ Startup
(async () => {
  try {
    await loadKickboxKey();
    await initKickbox();
    app.listen(port, () => console.log(`✅ Server running on http://localhost:${port}`));
  } catch (err) {
    console.error("❌ Failed to start server:", err);
  }
})();
