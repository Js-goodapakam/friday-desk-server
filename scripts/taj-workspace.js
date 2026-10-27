// Explicit isolated-development maintenance. Never loads Server/.env or PostgreSQL.
if(!process.argv.includes('--local')||process.env.NODE_ENV==='production')throw Error('Use --local outside production.');
process.env.FRIDAY_LOCAL_DEV='1';
const fs=require('node:fs'),path=require('node:path');
const db=require('../src/local-db'),store=require('../src/demo-store'),{normalizeLabels}=require('../src/sample-labels');
async function main(){
 const backup=db.file.replace('.sqlite',`-before-taj-${Date.now()}.sqlite`);await db.query('VACUUM INTO $1',[backup]);
 const saved=(await db.query('SELECT property_id FROM friday_demo_workspace')).rows;
 for(const row of saved){const current=await store.read(db,row.property_id);const state=normalizeLabels(current.state);state.demo.disclaimer='SAMPLE DATA — NOT AFFILIATED WITH TAJ. Operational records are fictional.';state.property.status='Active';state.enquiries=state.enquiries||[];state.groups=state.groups||[];for(const u of state.users){u.email=u.email?.replace(/^demo-/,'staff-');if(u.name==='Sample data Portfolio Admin')u.name='Taj Portfolio Admin (Sample data)';}await store.save(db,row.property_id,state,current.version,1);}
 const users=(await db.query('SELECT id,name,email FROM user')).rows;
 const primary=(await db.query('SELECT id FROM property WHERE code=$1',['TAJ-MUM-001'])).rows[0];if(primary)await db.query('UPDATE user SET propertyId=$1 WHERE id=1',[primary.id]);
 await db.withTransaction(async client=>{for(const u of users){const name=u.id===1?'Taj Portfolio Admin':normalizeLabels({name:u.name}).name;const email=u.email.replace(/^demo-/,'staff-');await client.query('UPDATE user SET name=$1,email=$2 WHERE id=$3',[name,email,u.id]);}});
 const credentials=path.join(path.dirname(db.file),'demo-credentials.json');if(fs.existsSync(credentials)){const rows=JSON.parse(fs.readFileSync(credentials,'utf8'));for(const row of rows)row.email=row.email.replace(/^demo-/,'staff-');fs.writeFileSync(credentials,JSON.stringify(rows,null,2));}
 console.log(JSON.stringify({propertiesUpdated:saved.length,backup,unrelatedRecords:'Retained in the isolated database, excluded from the Taj workspace.'},null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>db.closeDatabase());
