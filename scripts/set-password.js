// Run locally with FRIDAY_ACCOUNT_EMAIL and FRIDAY_ACCOUNT_PASSWORD in the process environment.
require('dotenv').config();
const db=require('../src/db');
const {hashPassword}=require('../src/auth');
(async()=>{
 try {
  const email=process.env.FRIDAY_ACCOUNT_EMAIL?.trim().toLowerCase();
  const password=process.env.FRIDAY_ACCOUNT_PASSWORD;
  if (!email || !password || password.length<12 || password.length>256) throw new Error('Provide an existing staff email and a password between 12 and 256 characters.');
  const found=await db.query('SELECT id FROM "user" WHERE LOWER(email)=$1 AND "isActive"=true',[email]);
  if (found.rows.length!==1) throw new Error('Exactly one active staff account must already exist.');
  const client=await db.pool.connect();
  try {
   await client.query('BEGIN');
   await client.query('INSERT INTO friday_credentials (user_id,password_hash) VALUES ($1,$2) ON CONFLICT (user_id) DO UPDATE SET password_hash=EXCLUDED.password_hash,updated_at=NOW()',[found.rows[0].id,hashPassword(password)]);
   await client.query('DELETE FROM friday_sessions WHERE user_id=$1',[found.rows[0].id]);
   await client.query('COMMIT');
  } catch(error) { await client.query('ROLLBACK');throw error; } finally {client.release();}
  console.log('Password provisioned. Existing sessions revoked.');
 } catch(error){console.error(error.message);process.exitCode=1;} finally {await db.closeDatabase();}
})();
