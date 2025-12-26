
import sql from 'mssql';
import { SecretClient } from "@azure/keyvault-secrets";
import { DefaultAzureCredential, AzureCliCredential } from "@azure/identity";

const IS_APP_SERVICE = !!process.env.WEBSITE_SITE_NAME;
const vaultUrl = process.env.AZURE_KEY_VAULT_URL; // Set in Azure App Service settings

// Use Managed Identity in Azure, Azure CLI locally
const credential = IS_APP_SERVICE ? new DefaultAzureCredential() : new AzureCliCredential();
const client = new SecretClient(vaultUrl, credential);

// In-memory cache for secrets
const secretCache = new Map();
let pool;

// ✅ Retry wrapper for SQL connection
async function connectWithRetry(dbConfig, retries = 3, delay = 2000) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await sql.connect(dbConfig);
    } catch (err) {
      console.warn(`SQL connect attempt ${attempt} failed: ${err.message}`);
      if (attempt === retries) throw err;
      await new Promise(res => setTimeout(res, delay * attempt)); // Exponential backoff
    }
  }
}

// ✅ Get SQL Pool with AAD first, fallback to SQL Auth + retry
export async function getSqlPool() {
  if (pool) return pool;
  const config = await getConfig();

  try {
    // Try AAD Authentication first
    const token = (await credential.getToken('https://database.windows.net/')).token;
    const dbConfigAAD = {
      server: config.AZSQLServer,
      port: config.AZSQLPort,
      database: config.AZSQLDB,
      authentication: {
        type: IS_APP_SERVICE
          ? 'azure-active-directory-msi-app-service'
          : 'azure-active-directory-access-token',
        options: { token }
      },
      options: { encrypt: true }
    };

    pool = await connectWithRetry(dbConfigAAD);
    console.log("✅ Connected using AAD");
  } catch (err) {
    console.warn("⚠️ AAD connection failed, falling back to SQL Auth:", err.message);

    // Fallback to SQL Authentication
    const dbConfigSQLAuth = {
      server: config.AZSQLServer,
      port: config.AZSQLPort,
      database: config.AZSQLDB,
      user: config.SQLUser,
      password: config.SQLPassword,
      options: { encrypt: true }
    };

    pool = await connectWithRetry(dbConfigSQLAuth);
    console.log("✅ Connected using SQL Authentication");
  }

  return pool;
}

// ✅ Health Probe
export async function healthProbe() {
  try {
    const pool = await getSqlPool();
    await pool.request().query('SELECT 1');
    return { status: 'healthy' };
  } catch (err) {
    return { status: 'unhealthy', error: err.message };
  }
}

// ✅ Retry logic for Key Vault calls
async function getSecretWithRetry(name, retries = 3, delay = 1000) {
  if (secretCache.has(name)) return secretCache.get(name);

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const secret = await client.getSecret(name);
      secretCache.set(name, secret.value);
      return secret.value;
    } catch (err) {
      console.warn(`Attempt ${attempt} to fetch secret "${name}" failed: ${err.message}`);
      if (attempt === retries) throw new Error(`Failed to fetch secret "${name}"`);
      await new Promise(res => setTimeout(res, delay * attempt)); // Exponential backoff
    }
  }
}

// ✅ Query helper
export async function query(sqlText, bindParamsFn) {
  const pool = await getSqlPool();
  const req = pool.request();
  if (bindParamsFn) bindParamsFn(req);
  return req.query(sqlText);
}

// ✅ WhoAmI helper
export async function whoAmI() {
  const pool = await getSqlPool();
  const result = await pool.request().query('SELECT SYSTEM_USER AS login, USER AS dbuser;');
  return result.recordset?.[0] ?? null;
}

// ✅ Load all required secrets dynamically
export async function getConfig() {
  return {
    AZSQLServer: await getSecretWithRetry("AZSQLServer"),
    AZSQLDB: await getSecretWithRetry("AZSQLDB"),
    AZSQLPort: parseInt(await getSecretWithRetry("AZSQLPort"), 10),
    SQLUser: await getSecretWithRetry("SQLUser"),       // Added for fallback
    SQLPassword: await getSecretWithRetry("SQLPassword"), // Added for fallback
    TWILIO_ACCOUNT_SID: await getSecretWithRetry("TwilioSID"),
    TWILIO_AUTH_TOKEN: await getSecretWithRetry("TwilioAuthToken"),
    KICKBOX_API_KEY: await getSecretWithRetry("kickboxBrowser"),
    sessionSecret: await getSecretWithRetry("CookieSession")
  }};
