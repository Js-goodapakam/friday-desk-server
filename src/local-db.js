// Local development only. Never opens the configured PostgreSQL database.
const { DatabaseSync } = require('node:sqlite');
const { mkdirSync } = require('node:fs');
const path = require('node:path');
const { randomBytes } = require('node:crypto');
const { hashPassword } = require('./auth');

if (process.env.FRIDAY_LOCAL_DEV !== '1' || process.env.NODE_ENV === 'production') {
  throw new Error('The SQLite development database requires FRIDAY_LOCAL_DEV=1 outside production.');
}
const directory = path.resolve(__dirname, '../.local');
mkdirSync(directory, { recursive: true });
const file = path.join(directory, 'friday-development.sqlite');
const database = new DatabaseSync(file);
database.exec('PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;');
database.function('NOW', () => new Date().toISOString());
database.exec(`
 CREATE TABLE IF NOT EXISTS property (
  id INTEGER PRIMARY KEY, name TEXT NOT NULL, code TEXT NOT NULL UNIQUE,
  brand TEXT, city TEXT, state TEXT, country TEXT DEFAULT 'India',
  timezone TEXT DEFAULT 'Asia/Kolkata', createdAt TEXT, updatedAt TEXT
 );
 CREATE TABLE IF NOT EXISTS user (
  id INTEGER PRIMARY KEY, propertyId INTEGER NOT NULL REFERENCES property(id),
  name TEXT NOT NULL, email TEXT NOT NULL UNIQUE, phone TEXT,
  role TEXT NOT NULL DEFAULT 'FRONT_DESK', isActive INTEGER NOT NULL DEFAULT 1,
  createdAt TEXT, updatedAt TEXT
 );
 CREATE TABLE IF NOT EXISTS friday_property_access (
  user_id INTEGER NOT NULL REFERENCES user(id), property_id INTEGER NOT NULL REFERENCES property(id),
  PRIMARY KEY (user_id,property_id)
 );
 CREATE TABLE IF NOT EXISTS friday_credentials (
  user_id INTEGER PRIMARY KEY REFERENCES user(id), password_hash TEXT NOT NULL,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
 );
 CREATE TABLE IF NOT EXISTS friday_sessions (
  token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES user(id),
  expires_at TEXT NOT NULL
 );
 CREATE INDEX IF NOT EXISTS friday_sessions_expiry ON friday_sessions(expires_at);
`);
database.prepare('INSERT OR IGNORE INTO property(id,name,code,city,state) VALUES (1,?,?,?,?)').run('Friday Test Hotel','FRIDAY-LOCAL','Test City','Test State');
const email = 'admin@friday.local';
database.prepare('INSERT OR IGNORE INTO user(id,propertyId,name,email,role,isActive) VALUES (1,1,?,?,?,1)').run('Friday Test Admin',email,'ADMIN');
if (!database.prepare('SELECT user_id FROM friday_credentials WHERE user_id=1').get()) {
  const password = `Friday-dev-${randomBytes(8).toString('hex')}!`;
  database.prepare('INSERT INTO friday_credentials(user_id,password_hash) VALUES (?,?)').run(1,hashPassword(password));
  console.log(`Local test account created. Email: ${email} Password: ${password}`);
}
database.prepare('DELETE FROM friday_sessions WHERE expires_at < ?').run(new Date().toISOString());

async function query(sql, params = []) {
  const values = [];
  const statement = sql.replace(/\$(\d+)/g, (_, n) => {
    const value = params[Number(n)-1];
    values.push(value instanceof Date ? value.toISOString() : typeof value === 'boolean' ? Number(value) : value ?? null);
    return '?';
  });
  const rows = database.prepare(statement).all(...values);
  return { rows, rowCount: rows.length };
}
let transactionQueue=Promise.resolve();
function withTransaction(callback) {
 const run=transactionQueue.then(async()=>{database.exec('BEGIN');try{const result=await callback({query});database.exec('COMMIT');return result;}catch(error){database.exec('ROLLBACK');throw error;}});
 transactionQueue=run.catch(()=>{});return run;
}
module.exports = {query, withTransaction, closeDatabase:async()=>database.close(), file};
