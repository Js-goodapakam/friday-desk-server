// Explicit local launch: do not load or use the existing PostgreSQL connection.
process.env.FRIDAY_LOCAL_DEV = '1';
process.env.NODE_ENV = 'development';
const port=Number(process.env.FRIDAY_LOCAL_PORT||3001);
if(!Number.isSafeInteger(port)||port<1024||port>65535)throw Error('Invalid local port');
process.env.PORT = String(port);
process.env.CLIENT_ORIGIN = process.env.FRIDAY_LOCAL_CLIENT_ORIGIN||'http://localhost:5174';
delete process.env.DATABASE_URL;
const app = require('../server');
const db = require('../src/db');
const server = app.listen(port, '127.0.0.1', () => {
  console.log(`Friday local API: http://127.0.0.1:${port}\nLocal database: ${db.file}`);
});
async function close() { server.close(async()=>{await db.closeDatabase();process.exit(0);}); }
process.on('SIGINT',close);
process.on('SIGTERM',close);
