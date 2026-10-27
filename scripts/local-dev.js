// Explicit local launch: do not load or use the existing PostgreSQL connection.
process.env.FRIDAY_LOCAL_DEV = '1';
process.env.NODE_ENV = 'development';
process.env.PORT = '3001';
process.env.CLIENT_ORIGIN = 'http://localhost:5174';
delete process.env.DATABASE_URL;
const app = require('../server');
const db = require('../src/db');
const server = app.listen(3001, '127.0.0.1', () => {
  console.log(`Friday local API: http://127.0.0.1:3001\nLocal database: ${db.file}`);
});
async function close() { server.close(async()=>{await db.closeDatabase();process.exit(0);}); }
process.on('SIGINT',close);
process.on('SIGTERM',close);
