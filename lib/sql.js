
import sql from 'mssql';
import { DefaultAzureCredential } from '@azure/identity';

function log(...args) {
  console.log(`[${new Date().toISOString()}] [lib/sql.js]`, ...args);
}
function logError(...args) {
  console.error(`[${new Date().toISOString()}] [lib/sql.js]`, ...args);
}

const credential = new DefaultAzureCredential();

const SQL_SERVER   = process.env.AZSQLServer;
const SQL_DATABASE = process.env.AZSQLDB;
const SQL_PORT     = Number(process.env.AZSQLPort ?? 1433);

log('Loaded SQL config:', {
  server: SQL_SERVER,
  database: SQL_DATABASE,
  port: SQL_PORT,
  user: process.env.AZSQLUser,
  authType: process.env.AZSQL_AUTH_TYPE
});

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

async function getSqlAccessToken() {
  log('Requesting Azure SQL access token...');
  const { token } = await credential.getToken('https://database.windows.net/.default');
  log('Received Azure SQL access token.');
  return token;
}

let _pool;
export async function getSqlPool() {
  log('getSqlPool called...');
  if (_pool && _pool.connected) {
    log('SQL pool already connected.');
    return _pool;
  }
  try {
    const token = await getSqlAccessToken();
    log('Connecting to SQL with config:', { server: SQL_SERVER, database: SQL_DATABASE, port: SQL_PORT });

    const config = {
      server: SQL_SERVER,
      database: SQL_DATABASE,
      port: SQL_PORT,
      options: { encrypt: true, trustServerCertificate: false },
      authentication: { type: 'azure-active-directory-access-token', options: { token } }
    };

    _pool = await new sql.ConnectionPool(config).connect();
    log('SQL pool connected.');
    return _pool;
  } catch (err) {
    logError('Error connecting to SQL:', err);
    throw err;
  }
}

export async function healthProbe() {
  log('Running healthProbe...');
  const pool = await getSqlPool();
  const result = await pool.request().query('SELECT TOP (1) name FROM sys.database_principals ORDER BY principal_id;');
  log('healthProbe result:', result.recordset);
  return result.recordset}

export async function whoAmI() {
  log('Running whoAmI...');
  const pool = await getSqlPool();
  const result = await pool.request().query('SELECT SUSER_SNAME() AS whoami;');
  log('whoAmI result:', result.recordset?.[0]?.whoami);
  return result.recordset?.[0]?.whoami}
