// Intentionally explicit production seeder. Safe to rerun; only adds tagged Taj sample data.
const fs=require('node:fs');
const path=require('node:path');
require('dotenv').config({quiet:true});

const model=require('../src/demo-data');
const store=require('../src/demo-store');
const {Pool}=require('pg');

function connectionProjectRef(url){
 const parsed=new URL(url);
 if(parsed.hostname.endsWith('.supabase.co'))return parsed.hostname.split('.')[0];
 const match=parsed.username.match(/^[^.]+\.([a-z0-9]+)$/i);
 return match?.[1]||null;
}
function connectionString(){
 return process.env.FRIDAY_PRODUCTION_DATABASE_URL||process.env.POSTGRES_URL_NON_POOLING||process.env.POSTGRES_URL||process.env.DATABASE_URL;
}
function requireTarget(){
 const url=connectionString();
 if(!url)throw Error('Set FRIDAY_PRODUCTION_DATABASE_URL or a Vercel/Supabase Postgres URL.');
 const projectRef=connectionProjectRef(url);
 const expected=process.env.FRIDAY_EXPECTED_SUPABASE_REF;
 const confirmed=process.argv.find(a=>a.startsWith('--confirm-production-seed='))?.split('=')[1];
 if(!expected||!projectRef||projectRef!==expected||confirmed!==expected)throw Error('Refusing production seed: connection project reference, FRIDAY_EXPECTED_SUPABASE_REF, and --confirm-production-seed must all match.');
 if(process.env.NODE_ENV!=='production')throw Error('Set NODE_ENV=production explicitly for the approved production run.');
 return{url,projectRef};
}
async function ensureMigration(pool){
 const required=['friday_property_access','friday_demo_workspace','friday_demo_room_type','friday_demo_room','friday_demo_guest','friday_demo_reservation','friday_demo_record','friday_demo_audit'];
 const result=await pool.query('SELECT table_name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name=ANY($1)',[required]);
 const found=new Set(result.rows.map(r=>r.table_name));
 const missing=required.filter(name=>!found.has(name));
 if(missing.length)throw Error(`Apply sql/sample-workspaces.sql first; missing: ${missing.join(', ')}`);
}
async function seed(pool){
 const adminResult=await pool.query('SELECT id, "propertyId" FROM "user" WHERE lower(email)=lower($1) AND role=$2 AND "isActive"=TRUE',[process.env.FRIDAY_SEED_ADMIN_EMAIL||'info@friday.com','ADMIN']);
 if(adminResult.rowCount!==1)throw Error('Expected exactly one active Friday ADMIN account matching FRIDAY_SEED_ADMIN_EMAIL.');
 const admin=adminResult.rows[0];
 const rows=[];
 for(const [code,name,city,stateName] of model.hotels){
  const existing=(await pool.query('SELECT id,name FROM property WHERE code=$1',[code])).rows[0];
  if(existing&&existing.name!==name)throw Error(`Refusing to modify existing property with code ${code}: name does not match the approved sample record.`);
  const property=existing||(await pool.query('INSERT INTO property(name,code,city,state,country,timezone,"createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,$6,NOW(),NOW()) RETURNING id,name,code',[name,code,city,stateName,'India','Asia/Kolkata'])).rows[0];
  rows.push(property);
 }
 for(const property of rows)await pool.query('INSERT INTO friday_property_access(user_id,property_id) VALUES($1,$2) ON CONFLICT(user_id,property_id) DO NOTHING',[admin.id,property.id]);
 const counts={properties:rows.length,createdProperties:0,rooms:0,roomTypes:0,guests:0,reservations:0,ratePlans:0,inventory:0,folios:0,payments:0,invoices:0,channels:0,syncEvents:0,housekeeping:0,tasks:0};
 for(let index=0;index<rows.length;index++){
  const property=rows[index],tag=(await pool.query('SELECT seed FROM friday_demo_workspace WHERE property_id=$1',[property.id])).rows[0];
  if(tag){if(tag.seed!==model.SEED)throw Error(`Refusing to overwrite workspace for property ${property.code}; it has a different seed tag.`);continue;}
  const staff=[];
  const state=store.validate(model.generateHotel(index,property.id,staff));
  try{
   const coverPath=path.resolve(__dirname,'../../Client/public/demo-hotels/attribution.json');
   const media=JSON.parse(fs.readFileSync(coverPath,'utf8'));
   const cover=media.find(item=>item.code===property.code&&item.url&&item.license?.startsWith('CC BY'));
   if(cover)state.property.cover=cover;
  }catch{/* Missing optional licensed imagery stays an explicit placeholder. */}
  await store.validate(state);
  await store.project(pool,property.id,state);
  await pool.query('INSERT INTO friday_demo_workspace(property_id,seed,state_json,version) VALUES($1,$2,$3,1)',[property.id,model.SEED,JSON.stringify(state)]);
  await pool.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[property.id,admin.id,'Sample data workspace created',JSON.stringify({seed:model.SEED,source:'Friday production sample seeder'})]);
  counts.createdProperties++;
  for(const key of ['rooms','roomTypes','guests','reservations','ratePlans','dailyInventory','folios','payments','invoices','housekeeping','tasks'])counts[key==='dailyInventory'?'inventory':key]+=state[key].length;
  counts.channels+=state.channelManager.channels.length;counts.syncEvents+=state.channelManager.syncEvents.length;
 }
 return counts;
}
async function verify(pool){
 const result=await pool.query(`SELECT p.code,w.seed,jsonb_build_object(
  'rooms',(SELECT count(*) FROM friday_demo_room x WHERE x.property_id=p.id),
  'roomTypes',(SELECT count(*) FROM friday_demo_room_type x WHERE x.property_id=p.id),
  'guests',(SELECT count(*) FROM friday_demo_guest x WHERE x.property_id=p.id),
  'reservations',(SELECT count(*) FROM friday_demo_reservation x WHERE x.property_id=p.id),
  'ratePlans',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='ratePlans'),
  'inventory',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='dailyInventory'),
  'folios',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='folios'),
  'payments',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='payments'),
  'invoices',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='invoices'),
  'channels',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='channels'),
  'syncEvents',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='syncEvents'),
  'housekeeping',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='housekeeping'),
  'tasks',(SELECT count(*) FROM friday_demo_record x WHERE x.property_id=p.id AND x.kind='tasks')
 ) AS counts FROM property p JOIN friday_demo_workspace w ON w.property_id=p.id WHERE w.seed=$1 AND p.code=ANY($2) ORDER BY p.code`,[model.SEED,model.hotels.map(h=>h[0])]);
 if(result.rowCount!==5)throw Error(`Expected exactly 5 tagged sample properties, found ${result.rowCount}.`);
 const sums={properties:result.rowCount,rooms:0,roomTypes:0,guests:0,reservations:0,ratePlans:0,inventory:0,folios:0,payments:0,invoices:0,channels:0,syncEvents:0,housekeeping:0,tasks:0};
 for(const row of result.rows)for(const[key,value]of Object.entries(row.counts))sums[key]+=Number(value);
 const expected={properties:5,rooms:500,roomTypes:20,guests:200,reservations:250,ratePlans:20,inventory:7300,folios:250,payments:225,invoices:225,channels:30,syncEvents:270,housekeeping:500,tasks:40};
 for(const[key,value]of Object.entries(expected))if(sums[key]!==value)throw Error(`Verification failed for ${key}: expected ${value}, found ${sums[key]}.`);
 return{sums,properties:result.rows.map(row=>({code:row.code,seed:row.seed}))};
}
(async()=>{
 let pool;
 try{
  const target=requireTarget();
  pool=new Pool({connectionString:target.url,ssl:{rejectUnauthorized:false},max:2,connectionTimeoutMillis:10000});
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await ensureMigration(client);
   const seeded=await seed(client);
   await client.query('COMMIT');
   const verified=await verify(client);
   console.log(JSON.stringify({targetProjectRef:target.projectRef,seed:model.SEED,seeded,verified},null,2));
  }catch(error){await client.query('ROLLBACK').catch(()=>{});throw error;}finally{client.release();}
 }catch(error){console.error(error.message);process.exitCode=1;}finally{await pool?.end();}
})();
