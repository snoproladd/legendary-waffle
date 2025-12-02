import express from 'express';
import bodyParser from 'body-parser';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import helmet from 'helmet';
import { DefaultAzureCredential } from "@azure/identity";
import { SecretClient } from "@azure/keyvault-secrets";

const vaultName = 'ApiStorage';
const vaultUrl = `https://${vaultName}.vault.azure.net`;
const credential = new DefaultAzureCredential();
const secretClient = new SecretClient(vaultUrl, credential);
const secretName = 'kickboxBrowser';


// ✅ Load secret from Azure Key Vault
async function loadSecretToEnv(secretName) {
  const latestSecret = await secretClient.getSecret(secretName);
  process.env.KICKBOX_API_KEY = latestSecret.value;
  console.log("✅ Kickbox API key loaded.");
}

let kickbox;

async function initKickbox() {
  if (!kickbox) {
    const kickboxModule = await import('kickbox');
    // kickbox = kickboxModule.kickbox(process.env.KICKBOX_API_KEY); // ✅ Correct usage
    console.log("✅ Kickbox client initialized.");
  }
  return kickbox;
}

async function checkEmail(email) {
  const kb = await initKickbox();
  return new Promise((resolve, reject) => {
    kb.verify(email, (err, response) => {
      if (err) return reject(err);
      resolve(response.body);
    });
  });
}

const app = express();
const port = 3001;

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ✅ Helmet CSP updated for Bootstrap and custom scripts
app.use(
  helmet.contentSecurityPolicy({
    directives: {
      defaultSrc: ["'self'"],
      connectSrc: ["'self'", "http://localhost:3000"],
      scriptSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://cdn.jsdelivr.net/npm/bootstrap",
        "'unsafe-inline'"
      ],
      styleSrc: [
        "'self'",
        "https://cdn.jsdelivr.net",
        "https://fonts.googleapis.com",
        "'unsafe-inline'"
      ],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:"],
      frameSrc: ["'self'"]
    }
  })
);

app.use(bodyParser.urlencoded({ extended: true }));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.static(path.join(__dirname, 'public')));

// ✅ Routes
app.get('/', (req, res) => res.render('index'));
app.get('/email-pass', (req, res) => res.render('emailPass'));
app.get('/enter-info', (req, res) => res.render('volunteerinfo'));
app.get('/nonProfile', (req, res) => res.render('nonProfile'));

app.post('/submit-info', async (req, res) => {
  const { email } = req.body;
  try {
    const response = await checkEmail(email);
    res.json(response);
  } catch {
    res.status(500).send("Email verification failed.");
  }
});

app.get('/validate-email', async (req, res) => {
  const email = req.query.email;
  if (!email) return res.status(400).json({ error: "Email required" });

  // ✅ Block jwpub.org domain
  if (email.toLowerCase().endsWith('@jwpub.org')) {
    return res.json({ result: 'invalid', reason: 'Domain not allowed' });
  }

  try {
    const response = await checkEmail(email);
    res.json({ result: response.result, reason: response.reason });
  } catch {
    res.status(500).json({ error: "Verification failed" });
  }
});

// ✅ Async startup: load secret, init Kickbox, start server
(async () => {
  try {
    await loadSecretToEnv(secretName);
    await initKickbox();
    app.listen(port, () => {
      console.log(`✅ Server running on http://localhost:${port}`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
  }
})();