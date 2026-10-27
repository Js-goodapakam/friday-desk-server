if (process.env.FRIDAY_LOCAL_DEV === '1') {
  module.exports = require('./local-db');
} else {
const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  ssl: {
    rejectUnauthorized: false,
  },
});

pool.on("error", (err) => {
  console.error("Unexpected PostgreSQL pool error:", err);
});

async function query(text, params = []) {
  return pool.query(text, params);
}

async function closeDatabase() {
  await pool.end();
}

async function withTransaction(callback) {
 const client=await pool.connect();
 try {await client.query('BEGIN');const result=await callback(client);await client.query('COMMIT');return result;}
 catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}

module.exports = {
  pool,
  withTransaction,
  query,
  closeDatabase,
};
}
