
// lib/db.js
import { getSqlPool, query as rawQuery, whoAmI, healthProbe } from './sql.js';
import sql from 'mssql'
import crypto from 'crypto'

function log(...args) { console.log(`[${new Date().toISOString()}] [lib/db.js]`, ...args); }
function logError(...args) { console.error(`[${new Date().toISOString()}] [lib/db.js]`, ...args); }

function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('base64');
    const iterations = 310000;
    const hash = crypto.pbkdf2Sync(password, salt, iterations, 32,'sha256').toString('base64');
    return {
        hash,
        salt,
        iterations,
        algorithm: 'pbkdf2-sha256'}
    }


/**
 * Simple wrapper to ensure parameterized execution with helpful logging.
 * @param {string} sqlText - The T-SQL statement
 * @param {(req: import('mssql').Request) => void} [bindParamsFn] - Function to bind params
 * @returns {Promise<import('mssql').IResult<any>>}
 */
export async function exec(sqlText, bindParamsFn) {
  log('exec called');
  return rawQuery(sqlText, bindParamsFn);
}


export async function insertEmailPass(email, password){
    const {hash, salt, iterations, algorithm}=hashPassword(password);

    const sqlText = `
        IF NOT EXISTS (
        SELECT 1 FROM volunteer_in
        WHERE email = @email)
        BEGIN
            INSERT INTO dbo.volunteer_in (email, passwordHash, passwordSalt, passwordAlgo, passwordIter)
            OUTPUT inserted.id, inserted.email
            VALUES (@email, @hash, @salt, @algo, @iter)
        END;
        `;
    
    const result = await exec(sqlText, (req) => {
        req.input('email', sql.NVarChar(255), email);
        req.input('hash', sql.NVarChar(256), hash);
        req.input('salt', sql.NVarChar(64), salt);
        req.input('algo', sql.NVarChar(50), algorithm);
        req.input('iter', sql.Int, iterations);
    });
    return result.recordset?.[0] ?? null;
};

export async function insertNameAndPhone(id, firstName, lastName, phone, suffix, SMSCapable) {
  const sqlText = `
    UPDATE dbo.volunteer_in 
    SET firstName = @firstName,
        lastName = @lastName, 
        phone = @phone, 
        suffix = @suffix
    OUTPUT inserted.*
    WHERE id = @id; 
    `;
  const result = await exec(sqlText, (req) =>{
    req.input('SMSCapable', sql.Bit, SMSCapable)
    req.input('id', sql.Int, id);
    req.input("phone", sql.NVarChar(50), phone);
    req.input('firstName', sql.NVarChar(50), firstName);
    req.input('lastName', sql.NVarChar(50), lastName);
    req.input('suffix', sql.NVarChar(50), suffix);
  
  });
  return result.recordset?.[0] ?? null;
};


export async function emailExists(email) {
  const tsql = `
    SELECT TOP (1) 1 AS exists_flag
    FROM dbo.volunteer_in
    WHERE email = @email;
  `;
  const res = await exec(tsql, (req) => {
    req.input('email', sql.NVarChar(255), email);
  });
  return !!res.recordset?.length; // true if at least one row
};

export async function namePhoneExists(firstName, lastName, phone, suffix){
  const tsql=`
    SELECT TOP (1) 1 AS exists_flag
    FROM dbo.volunteer_in
    WHERE phone = @phone AND 
    firstName = @firstName AND 
    lastName = @lastName AND
    suffix = @suffix;
    `;
    const res = await exec(tsql, (req) =>{
      req.input('phone', sql.NVarChar(50),phone);
      req.input('firstName', sql.NVarChar(50), firstName);
      req.input('lastName', sql.NVarChar(50), lastName);
      req.input('suffix', sql.NVarChar(50), suffix);
    });
    return !!res.recordset?.length;
};



/**
 * Example: read-only list with paging
 */
// export async function listParkingLots({ page = 1, pageSize = 25 } = {}) {
//   const offset = Math.max(0, (page - 1) * pageSize);
//   const sqlText = `
//     SELECT id, name, status, created_at
//     FROM dbo.ParkingLots
//     ORDER BY id
//     OFFSET @offset ROWS FETCH NEXT @pageSize ROWS ONLY;
//   `;
//   const res = await exec(sqlText, (req) => {
//     req.input('offset', require('mssql').Int, offset);
//     req.input('pageSize', require('mssql').Int, pageSize);
//   });
//   return res.recordset || [];
// }

/**
 * Example: fetch one row
 */
// export async function getParkingLotById(id) {
//   const sqlText = `SELECT id, name, status, created_at FROM dbo.ParkingLots WHERE id = @id;`;
//   const res = await exec(sqlText, (req) => {
//     req.input('id', require('mssql').Int, id);
//   });
//   return res.recordset?.[0] ?? null;
// }

/**
 * Example: insert with parameter binding; returns inserted row
 */
// export async function createParkingLot({ name, status = 'active' }) {
//   const sqlText = `
//     INSERT INTO dbo.ParkingLots (name, status)
//     OUTPUT inserted.id, inserted.name, inserted.status, inserted.created_at
//     VALUES (@name, @status);
//   `;
//   const res = await exec(sqlText, (req) => {
//     const sql = require('mssql');
//     req.input('name', sql.NVarChar(200), name);
//     req.input('status', sql.NVarChar(50), status);
//   });
//   return res.recordset?.[0] ?? null;
// }

/**
 * Example: update with OUTPUT; returns updated row (or null if none)
 */
// export async function updateParkingLot({ id, name, status }) {
//   const sqlText = `
//     UPDATE dbo.ParkingLots
//     SET name = COALESCE(@name, name),
//         status = COALESCE(@status, status)
//     OUTPUT inserted.id, inserted.name, inserted.status, inserted.created_at
//     WHERE id = @id;
//   `;
//   const res = await exec(sqlText, (req) => {
//     const sql = require('mssql');
//     req.input('id', sql.Int, id);
//     req.input('name', sql.NVarChar(200), name ?? null);
//     req.input('status', sql.NVarChar(50), status ?? null);
//   });
//   return res.recordset?.[0] ?? null;
// }

// /**
//  * Example: delete returning count
//  */
// export async function deleteParkingLot(id) {
//   const sqlText = `DELETE FROM dbo.ParkingLots WHERE id = @id;`;
//   const res = await exec(sqlText, (req) => {
//     req.input('id', require('mssql').Int, id);
//   });
//   return res.rowsAffected?.[0] ?? 0;
// }

/**
 * Example transaction with two dependent statements
 */
// export async function transferSpots({ fromLotId, toLotId, count }) {
//   const sql = require('mssql');
//   const pool = await getSqlPool();
//   const tx = new sql.Transaction(pool);
//   await tx.begin();
//   try {
//     const req1 = new sql.Request(tx);
//     req1.input('count', sql.Int, count);
//     req1.input('fromLotId', sql.Int, fromLotId);
//     await req1.query(`
//       UPDATE dbo.ParkingLots
//       SET available_spots = available_spots - @count
//       WHERE id = @fromLotId AND available_spots >= @count;
//     `);

//     const req2 = new sql.Request(tx);
//     req2.input('count', sql.Int, count);
//     req2.input('toLotId', sql.Int, toLotId);
//     await req2.query(`
//       UPDATE dbo.ParkingLots
//       SET available_spots = available_spots + @count
//       WHERE id = @toLotId;
//     `);

//     await tx.commit();
//     return { success: true };
//   } catch (err) {
//     logError('transferSpots failed, rolling back:', err?.message || err);
//     try { await tx.rollback(); } catch (rbErr) { logError('rollback error:', rbErr); }
//     throw err;
//   }
// }

/**
 * Diagnostics from your sql.js helpers
 */
export async function dbWhoAmI() {
  return whoAmI(); // { login, dbuser }
}

export async function dbHealth() {
  return healthProbe(); // array of principals
}

