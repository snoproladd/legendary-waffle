
// lib/sql.js (ESM)
// Hardened Azure SQL connector using Azure AD access token auth with retries and detailed logging.

import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

function log(...args) {
  console.log(`[${new Date().toISOString()}] [lib/sql.js]`, ...args);
}
function logError(...args) {
  console.error(`[${new Date().toISOString()}] [lib/sql.js]`, ...args);
}

const credential = new DefaultAzureCredential();

const SQL_SERVER   = process.env.AZSQLServer;         // e.g., "albanyregional.database.windows.net"
const SQL_DATABASE = process.env.AZSQLDB;             // e.g., "albanyregional"
const SQL_PORT     = Number(process.env.AZSQLPort ?? 1433);

log('Loaded SQL config:', {
  server: SQL_SERVER,
  database: SQL_DATABASE,
  port: SQL_PORT,
  user: process.env.AZSQLUser,
  authType: process.env.AZSQL_AUTH_TYPE
});

// ---- Sanity checks on environment ----
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

// ---- Token acquisition ----
async function getSqlAccessToken() {
  log('Requesting Azure SQL access token...');
  const tok = await credential.getToken('https://database.windows.net/.default');
  const token = tok?.token;
  if (!token) {
    throw new Error('No access token returned for https://database.windows.net/.default');
  }
  log('Received Azure SQL access token.');
  return token;
}

// ---- Build mssql config ----
function buildConfig(token) {
  return {
    server: SQL_SERVER,
    database: SQL_DATABASE,
    port: SQL_PORT,
    options: {
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 30000,   // ms; initial TCP/TLS handshake
      requestTimeout: 30000,   // ms; individual query timeout
      enableArithAbort: true,
      debug: { packet: true, data: false, payload: false, token: false }
    },
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
      acquireTimeoutMillis: 30000
    },
    authentication: {
      type: 'azure-active-directory-msi-v2',
      options: { token }
    }, 
  };
}

const TRANSIENT_CODES = new Set(['ESOCKET', 'ECONNRESET', 'ETIMEDOUT', 'ETIME']);

let _pool = null;
let _connectingPromise = null;

// ---- Connect with retries ----
async function connectWithRetry(maxAttempts = 4) {
  let attempt = 0;
  let lastErr = null;

  while (attempt < maxAttempts) {
    attempt++;
    try {
      const token = await getSqlAccessToken();
      const config = buildConfig(token);
      log(`Connecting to SQL (attempt ${attempt}) with:`, { server: SQL_SERVER, database: SQL_DATABASE, port: SQL_PORT });

      const pool = new sql.ConnectionPool(config);
      const connected = await pool.connect();

      // Attach a pool-level error listener for diagnostics
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

      const isTransient =
        TRANSIENT_CODES.has(code) ||
        /socket hang up/i.test(message);

      if (!isTransient) {
        // Non-transient or auth/permission error; do not retry further
        break;
      }

      const delay = Math.min(5000 * attempt, 15000); // 5s, 10s, 15s
      log(`Backoff ${delay}ms before retry...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }

  throw lastErr;
}

// ---- Public: acquire or reuse pool ----
export async function getSqlPool() {
  log('getSqlPool called...');
  if (_pool && _pool.connected) {
    log('SQL pool already connected.');
    return _pool;
  }
  if (_connectingPromise) {
    log('Awaiting existing connection attempt...');
    return _connectingPromise;
  }

  _connectingPromise = connectWithRetry(4)
    .then((pool) => {
      _pool = pool;
      _connectingPromise = null;
      return _pool;
    })
    .catch((err) => {
      _connectingPromise = null;
      logError('Error connecting to SQL:', err);
      throw err;
    });

  return _connectingPromise;
}

// ---- Public: close pool (graceful shutdown) ----
export async function closeSqlPool() {
  if (_pool) {
    try {
      await _pool.close();
      log('SQL pool closed.');
    } catch (err) {
      logError('Error closing SQL pool:', err);
    } finally {
      _pool = null;
    }
  }
}

// ---- Health probe: light-weight query ----
export async function healthProbe() {
  log('Running healthProbe...');
  const pool = await getSqlPool();
  const result = await pool.request().query(
    'SELECT TOP (1) name FROM sys.database_principals ORDER BY principal_id;'
  );
  log('healthProbe result:', result.recordset);
  return result.recordset;
}

// ---- Who am I inside SQL ----
export async function whoAmI() {
  log('Running whoAmI...');
  const pool = await getSqlPool();
  const result = await pool.request().query(
    'SELECT SUSER_SNAME() AS login, USER_NAME() AS dbuser;'
  );
  const row = result.recordset?.[0] || {};
  log('whoAmI result:', row);
  return row;
}

// ---- Helper: generic query wrapper (optional export) ----
export async function query(sqlText, bindParamsFn) {
  const pool = await getSqlPool();
  const req = pool.request();
  if (typeof bindParamsFn === 'function') {
    try {
      bindParamsFn(req); // e.g., (r) => r.input('id', sql.Int, 123)
    } catch (err) {
      logError('Error applying bindParamsFn:', err);
      throw err;
    }
   }
  const res = await req.query(sqlText);
  return res};
