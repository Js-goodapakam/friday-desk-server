// Only the explicitly isolated local SQLite development database is eligible.
if(!process.argv.includes('--local')||process.env.NODE_ENV==='production')throw Error('Use --local in development. Production seeding is forbidden.');
process.env.FRIDAY_LOCAL_DEV='1';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const db=require('../src/local-db'),model=require('../src/demo-data'),store=require('../src/demo-store'),{hashPassword}=require('../src/auth');
const credentialsFile=path.join(path.dirname(db.file),'demo-credentials.json');
async function cleanup(){
 const ids=(await db.query('SELECT property_id FROM friday_demo_workspace WHERE seed=$1',[model.SEED])).rows.map(r=>r.property_id);
 await db.withTransaction(async client=>{
  const staff=(await client.query('SELECT user_id FROM friday_demo_user WHERE seed=$1',[model.SEED])).rows;
  for(const row of staff){for(const table of ['friday_sessions','friday_credentials','friday_property_access','friday_demo_user'])await client.query(`DELETE FROM ${table} WHERE user_id=$1`,[row.user_id]);await client.query('DELETE FROM user WHERE id=$1',[row.user_id]);}
  for(const id of ids){for(const table of ['friday_demo_audit','friday_demo_record','friday_demo_reservation','friday_demo_room','friday_demo_guest','friday_demo_room_type','friday_demo_workspace'])await client.query(`DELETE FROM ${table} WHERE property_id=$1`,[id]);await client.query('DELETE FROM friday_property_access WHERE property_id=$1',[id]);await client.query('DELETE FROM property WHERE id=$1',[id]);}
 });
 if(fs.existsSync(credentialsFile))fs.renameSync(credentialsFile,credentialsFile+'.revoked-'+Date.now());
 console.log(`Cleaned only ${ids.length} ${model.SEED} demo properties and their tagged staff. Unrelated records retained.`);
}
async function seed(){
 let credentials=[];
 await db.withTransaction(async client=>{
  const propertyIds=[];
  for(const [code,name,city,state]of model.hotels){
   let row=(await client.query('SELECT id FROM property WHERE code=$1',[code])).rows[0];
   if(row){const tagged=(await client.query('SELECT seed FROM friday_demo_workspace WHERE property_id=$1',[row.id])).rows[0];if(tagged?.seed!==model.SEED)throw Error('Refusing to overwrite untagged property '+code);}
   else row=(await client.query('INSERT INTO property(name,code,city,state,country,timezone,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING id',[name,code,city,state,'India','Asia/Kolkata'])).rows[0];
   propertyIds.push(row.id);
  }
  async function staff(email,name,role,demoRole,propertyId){
   const found=(await client.query('SELECT id FROM user WHERE email=$1',[email])).rows[0];
   if(found){if(!(await client.query('SELECT seed FROM friday_demo_user WHERE user_id=$1',[found.id])).rows.length)throw Error('Refusing to overwrite untagged staff');return{...found,email,name,role,demoRole};}
   const row=(await client.query('INSERT INTO user(propertyId,name,email,role,isActive,"createdAt","updatedAt") VALUES($1,$2,$3,$4,true,NOW(),NOW()) RETURNING id',[propertyId,name,email,role])).rows[0];
   const password='Demo-'+crypto.randomBytes(12).toString('base64url')+'!';
   await client.query('INSERT INTO friday_credentials(user_id,password_hash) VALUES($1,$2)',[row.id,hashPassword(password)]);
   await client.query('INSERT INTO friday_demo_user(user_id,seed) VALUES($1,$2)',[row.id,model.SEED]);
   credentials.push({email,password,role:demoRole,propertyId});return{...row,email,name,role,demoRole};
  }
  const superAdmin=await staff('portfolio-admin@example.test','Demo Portfolio Admin','ADMIN','Super Admin',propertyIds[0]);
  const roleMap={'Property Admin':'ADMIN','General Manager':'MANAGER','Front Desk Manager':'FRONT_DESK','Front Desk Executive':'FRONT_DESK','Housekeeping Manager':'HOUSEKEEPING','Housekeeping Staff':'HOUSEKEEPING','Revenue Manager':'REVENUE','Finance Manager':'FINANCE','Reservation Executive':'RESERVATIONS'};
  for(const [index,id]of propertyIds.entries()){
   for(const uid of [1,superAdmin.id])await client.query('INSERT OR IGNORE INTO friday_property_access(user_id,property_id) VALUES($1,$2)',[uid,id]);
   const staffRows=[superAdmin];
   for(const [position,demoRole]of model.roles.slice(1).entries())staffRows.push(await staff(`demo-${index+1}-${position+1}@example.test`,`Demo ${model.hotels[index][2]} ${demoRole}`,roleMap[demoRole],demoRole,id));
   const existing=(await client.query('SELECT seed FROM friday_demo_workspace WHERE property_id=$1',[id])).rows[0];
   if(existing)continue;
   const generated=model.generateHotel(index,id,staffRows);
   try{const media=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../../Client/public/demo-hotels/attribution.json'),'utf8'));const cover=media.find(item=>item.code===model.hotels[index][0]&&item.url&&item.license?.startsWith('CC BY'));if(cover)generated.property.cover=cover;}catch{/* Photos may be imported separately after seeding. */}
   const state=store.validate(generated);
   await store.project(client,id,state);
   await client.query('INSERT INTO friday_demo_workspace(property_id,seed,state_json,version) VALUES($1,$2,$3,1)',[id,model.SEED,JSON.stringify(state)]);
   await client.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[id,1,'Demo seed created',JSON.stringify({seed:model.SEED})]);
  }
 });
 if(credentials.length){let previous=[];try{previous=JSON.parse(fs.readFileSync(credentialsFile,'utf8'));}catch{}fs.writeFileSync(credentialsFile,JSON.stringify([...previous,...credentials],null,2),{mode:0o600});}
}
async function validate(){
 const saved=(await db.query('SELECT property_id,state_json FROM friday_demo_workspace WHERE seed=$1',[model.SEED])).rows;
 const count={properties:saved.length,rooms:0,roomTypes:0,guests:0,reservations:0,ratePlans:0,inventory:0,folios:0,payments:0,invoices:0,channels:0,syncEvents:0,housekeeping:0,tasks:0};
 for(const row of saved){const state=store.validate(JSON.parse(row.state_json));for(const key of ['rooms','roomTypes','guests','reservations','ratePlans','folios','payments','invoices','housekeeping','tasks'])count[key]+=state[key].length;count.inventory+=state.dailyInventory.length;count.channels+=state.channelManager.channels.length;count.syncEvents+=state.channelManager.syncEvents.length;}
 for(const [key,value]of Object.entries({properties:5,rooms:500,roomTypes:20,guests:200,reservations:250,ratePlans:20,inventory:7300,channels:30}))if(count[key]!==value)throw Error(`Expected ${value} ${key}, found ${count[key]}`);
 const errors=(await db.query('PRAGMA foreign_key_check')).rows;if(errors.length)throw Error('Foreign key violations');
 console.log(JSON.stringify({seed:model.SEED,referenceDate:model.START,counts:count,foreignKeys:'PASS',credentials:credentialsFile},null,2));return count;
}
(async()=>{try{await store.schema(db);if(process.argv.includes('--cleanup')){await cleanup();return;}if(process.argv.includes('--reset'))await cleanup();if(!process.argv.includes('--validate-only'))await seed();await validate();}catch(error){console.error(error.stack);process.exitCode=1;}finally{await db.closeDatabase();}})();
