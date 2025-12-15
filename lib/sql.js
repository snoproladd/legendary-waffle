
// lib/sql.js (ESM) — handles both local and App Service using driver-supported auth types
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

function log(...args) { console.log(`[${new Date().toISOString()}] [lib/sql.js]`, ...args); }
function logError(...args) { console.error(`[${new Date().toISOString()}] [lib/sql.js]`, ...args); }

const credential = new DefaultAzureCredential();

const SQL_SERVER   = process.env.AZSQLServer;
const SQL_DATABASE = process.env.AZSQLDB;
const SQL_PORT     = Number(process.env.AZSQLPort ?? 1433);

const IS_APP_SERVICE = !!process.env.WEBSITE_SITE_NAME;
const USER_ASSIGNED_CLIENT_ID = process.env.AZURE_CLIENT_ID;
const SQL_DEBUG = process.env.SQL_DEBUG === '1';
const SQL_FORCE_ACCESS_TOKEN = process.env.SQL_FORCE_ACCESS_TOKEN === '1';

log('Loaded SQL config:', {
  server: SQL_SERVER, database: SQL_DATABASE, port: SQL_PORT,
  isAppService: IS_APP_SERVICE, websiteSiteName: process.env.WEBSITE_SITE_NAME || '',
  azureClientId: USER_ASSIGNED_CLIENT_ID || ''
});

// ---- Sanity checks ----
if (!SQL_SERVER || typeof SQL_SERVER !== 'string' || !SQL_SERVER.includes('.database.windows.net')) {
  logError('Invalid AZSQLServer:', SQL_SERVER);
  throw new Error(`Invalid AZSQLServer; expected FQDN like 'albanyregional.database.windows.net', got '${SQL_SERVER ?? ''}'`);
}
if (!SQL_DATABASE || typeof SQL_DATABASE !== 'string') {
  logError('Invalid AZSQLDB:', SQL_DATABASE);
  throw new Error(`Invalid AZSQLDB; got '${SQL_DATABASE ?? ''}'`);
}
if (!Number.isFinite(SQL_PORT) || SQL_PORT <= 0) {
  logError('Invalid AZSQLPort:', SQL_PORT);
  throw new Error(`Invalid AZSQLPort; got '${process.env.AZSQLPort ?? ''}'`);
}

// ---- Optional access token (fallback) ----
async function getSqlAccessToken() {
  log('Requesting Azure SQL access token (DefaultAzureCredential)...');
  const tok = await credential.getToken('https://database.windows.net/.default');
  const token = tok?.token;
  if (!token) throw new Error('No access token returned for https://database.windows.net/.default');
  log('Received Azure SQL access token.');
  return token;
}

// ---- Build config: App Service MSI vs local token-credential (fixed) ----
async function buildConfig() {
  let authentication; let authExplain;

  if (IS_APP_SERVICE) {
    // App Service: use MSI mode recognized by your driver (system- or user-assigned)
    authentication = {
      type: 'azure-active-directory-msi-app-service',
      options: USER_ASSIGNED_CLIENT_ID ? { clientId: USER_ASSIGNED_CLIENT_ID } : {}
    };
    authExplain = USER_ASSIGNED_CLIENT_ID
      ? 'Using App Service user-assigned MSI (clientId supplied).'
      : 'Using App Service system-assigned MSI.';
  } else if (!SQL_FORCE_ACCESS_TOKEN) {
    // Local: use token-credential with a proper TokenCredential instance
    authentication = {
      type: 'token-credential',
      options: { credential }           // <-- FIX: use "credential", not "tokenCredential"
    };
    authExplain = 'Using token-credential (DefaultAzureCredential) locally.';
  } else {
    // Fallback: explicit access-token if you want strict token passing
    const token = await getSqlAccessToken();
    authentication = {
      type: 'azure-active-directory-access-token',
      options: { token }
    };
    authExplain = 'Using explicit azure-active-directory-access-token fallback.';
  }

  const options = {
    encrypt: true,
    trustServerCertificate: false,
    connectTimeout: 30000,
    requestTimeout: 30000,
    enableArithAbort: true,
    ...(SQL_DEBUG ? { debug: { packet: true, data: false, payload: false, token: false } } : {})
  };

  log('Auth mode selected:', { type: authentication.type, optionKeys: Object.keys(authentication.options || {}) });
  log('Auth rationale:', authExplain);

  return {
    server: SQL_SERVER,
    database: SQL_DATABASE,
    port: SQL_PORT,
    options,
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000, acquireTimeoutMillis: 30000 },
    authentication
  };
}

const TRANSIENT_CODES = new Set(['ESOCKET', 'ECONNRESET', 'ETIMEDOUT', 'ETIME']);
let _pool = null; let _connectingPromise = null;

async function connectWithRetry(maxAttempts = 4) {
  let attempt = 0; let lastErr = null;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const config = await buildConfig();
      log(`Connecting to SQL (attempt ${attempt}) with:`, { server: SQL_SERVER, database: SQL_DATABASE, port: SQL_PORT, authType: config.authentication?.type });
      const pool = new sql.ConnectionPool(config);
      const connected = await pool.connect();
      connected.on('error', (err) => {
        const code = err?.code || err?.originalError?.code;
        logError('SQL pool error:', code, err?.message || err);
      });
      log('SQL pool connected.');
      return connected;
    } catch (err) {
      lastErr = err;
      const code = err?.code || err?.originalError?.code;
      const message = err?.message || String(err);
      logError(`Connect attempt ${attempt} failed:`, code, message);
      const isTransient = TRANSIENT_CODES.has(code) || /socket hang up/i.test(message);
      if (!isTransient) break;
      const delay = Math.min(5000 * attempt, 15000);
      log(`Backoff ${delay}ms before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr;
}

export async function getSqlPool() {
  log('getSqlPool called...');
  if (_pool && _pool.connected) { log('SQL pool already connected.'); return _pool; }
  if (_connectingPromise) { log('Awaiting existing connection attempt...'); return _connectingPromise; }
  _connectingPromise = connectWithRetry(4)
    .then((pool) => { _pool = pool; _connectingPromise = null; return _pool; })
    .catch((err) => { _connectingPromise = null; logError('Error connecting to SQL:', err); throw err; });
  return _connectingPromise;
}

export async function closeSqlPool() {
  if (_pool) {
    try { await _pool.close(); log('SQL pool closed.'); }
    catch (err) { logError('Error closing SQL pool:', err); }
    finally { _pool = null; }
  }
}

export async function healthProbe() {
  log('Running healthProbe...');
  const pool = await getSqlPool();
  const result = await pool.request().query('SELECT TOP (1) name FROM sys.database_principals ORDER BY principal_id;');
  log('healthProbe result:', result.recordset);
  return result.recordset;
}

export async function whoAmI() {
  log('Running whoAmI...');
  const pool = await getSqlPool();
  const result = await pool.request().query('SELECT SUSER_SNAME() AS login, USER_NAME() AS dbuser;');
  const row = result.recordset?.[0] || {};
  log('whoAmI result:', row);
  return row;
}

export async function query(sqlText, bindParamsFn) {
  const pool = await getSqlPool();
  const req = pool.request();
  if (typeof bindParamsFn === 'function') { try { bindParamsFn(req); } catch (err) { logError('Error applying bindParamsFn:', err); throw err; } }
  const res = await req.query(sqlText);
  return res;
}
