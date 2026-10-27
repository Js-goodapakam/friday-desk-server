require('dotenv').config();
const fs=require('node:fs');
const path=require('node:path');
const db=require('../src/db');
(async()=>{try{await db.query(fs.readFileSync(path.join(__dirname,'../sql/auth.sql'),'utf8'));console.log('Authentication tables are ready.');}catch(error){console.error('Authentication migration failed:',error.message);process.exitCode=1;}finally{await db.closeDatabase();}})();
