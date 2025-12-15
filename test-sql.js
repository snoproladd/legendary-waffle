
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

const {
  AZSQLServer,
  AZSQLDB,
  AZSQLPort = '1433',
  AZ_USE_EXPLICIT_TOKEN = '0', // set to "1" to use explicit token path
  DEBUG_TEDIOUS = '0',         // set to "1" to enable low-level driver debug
} = process.env;

// Basic guards to avoid silent hangs
function required(name, val) {
  if (!val || String(val).trim() === '') {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
}
required('AZSQLServer', AZSQLServer);
required('AZSQLDB', AZSQLDB);

if (DEBUG_TEDIOUS === '1') {
  // Enable verbose protocol logs from the underlying driver
  // Run with: DEBUG_TEDIOUS=1 node test-db.js
  process.env.DEBUG = 'tedious:*';
}

// Make timeouts explicit to prevent indefinite waiting
const CONNECT_TIMEOUT_MS = 15000;
const REQUEST_TIMEOUT_MS = 15000;
const ACQUIRE_TOKEN_TIMEOUT_MS = 15000;

// Utility to timebox async operations
async function withTimeout(promise, ms, label) {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId);
    return result;
  } catch (e) {
    clearTimeout(timeoutId);
    throw e;
  }
}

const credential = new DefaultAzureCredential();
let pool; // will hold the connection for cleanup

async function testConnection() {
  console.log('▶️ Starting DB connectivity test at', new Date().toISOString());
  console.log('Env:', {
    AZSQLServer,
    AZSQLDB,
    AZSQLPort: Number(AZSQLPort),
    AZ_USE_EXPLICIT_TOKEN,
    DEBUG_TEDIOUS,
  });

  // Base options for mssql/tedious
  const base = {
    server: AZSQLServer,              // e.g. "albanyregional.database.windows.net"
    database: AZSQLDB,                // e.g. "albanyregional"
    port: Number(AZSQLPort || 1433),
    options: {
      encrypt: true,
      trustServerCertificate: false,
      // Recommended additional flags
      enableArithAbort: true,
      // timeouts are on the top-level in mssql, but we still keep options clean
    },
    // Global timeouts on the mssql client
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
  };

  const useExplicitToken = AZ_USE_EXPLICIT_TOKEN === '1';

  let config;
  if (!useExplicitToken) {
    // Driver-managed token flow (your original approach)
    config = {
      ...base,
      authentication: {
        type: 'token-credential',
        options: { credential }, // IMPORTANT: must be named "credential"
      },
    };
    console.log('Auth mode:', 'token-credential (driver-managed)');
  } else {
    // Explicit token acquisition path (often surfaces issues clearly)
    console.log('Auth mode:', 'azure-active-directory-access-token (explicit)');
    const scope = 'https://database.windows.net/.default';
    let token;
    try {
      const t = await withTimeout(credential.getToken(scope), ACQUIRE_TOKEN_TIMEOUT_MS, 'AAD token acquisition');
      token = t?.token;
      if (!token) throw new Error('No token returned from DefaultAzureCredential().getToken(scope)');
      console.log('✅ Acquired AAD token (truncated):', token.slice(0, 24) + '...');
    } catch (e) {
      console.error('❌ Failed to acquire AAD token:', e.message);
      throw e;
    }

    config = {
      ...base,
      authentication: {
        type: 'azure-active-directory-access-token',
        options: { token },
      },
    };
  }

  console.log('Connecting with config:', {
    server: config.server,
    database: config.database,
    port: config.port,
    connectionTimeout: CONNECT_TIMEOUT_MS,
    requestTimeout: REQUEST_TIMEOUT_MS,
    authType: config.authentication?.type,
  });

  // Surface driver-level errors
  sql.on('error', (driverErr) => {
    console.error('Driver-level error:', driverErr?.message || driverErr);
  });

  try {
    pool = await withTimeout(new sql.ConnectionPool(config).connect(), CONNECT_TIMEOUT_MS, 'Pool.connect');
    console.log('✅ Connected. Running probe query...');
    const probe = 'SELECT SUSER_SNAME() AS login, USER_NAME() AS dbuser;';
    const result = await withTimeout(pool.request().query(probe), REQUEST_TIMEOUT_MS, 'Probe query');

    console.log('✅ Raw result object:', {
      rowsAffected: result.rowsAffected,
      recordsetLength: result.recordset?.length ?? 0,
    });
    console.log('✅ Recordset:', JSON.stringify(result.recordset, null, 2));
  } catch (err) {
    console.error('❌ Connection or query failed:', err?.message || err);
    console.error('Stack:', err?.stack || '(no stack)');
    process.exitCode = 1;
  } finally {
    if (pool) {
      try {
        await pool.close();
        console.log('Pool closed.');
      } catch (closeErr) {
        console.error('Error closing pool:', closeErr?.message || closeErr);
      }
    }
    // Ensure process exits (use exitCode set above)
    if (process.exitCode && process.exitCode !== 0) {
      process.exit(process.exitCode);
    } else {
      process.exit(0);
    }
  }
}

// Top-level safety: catch any async leaks
process.on('unhandledRejection', (reason) => {
  console.error('UnhandledRejection:', reason);
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  console.error('UncaughtException:', err);
  process.exit(1);
});

testConnection().catch((e) => {
   console.error('Top-level failure:', e?.message || e);
  process.exit(1)});
