const {hashPassword}=require('./auth');
const {canAccess}=require('./properties');
const roles=['ADMIN','MANAGER','FRONT_DESK','HOUSEKEEPING','REVENUE','FINANCE','RESERVATIONS'];
function ownerRoutes(db){
 async function allowed(req,res){if(process.env.FRIDAY_LOCAL_DEV!=='1'&&(db.file||process.env.NODE_ENV!=='production')){res.status(503).json({error:'Owner administration storage requires deployment configuration.'});return false;}if(!['ADMIN','MANAGER'].includes(req.user.role)){res.status(403).json({error:'Owner or manager access required.'});return false;}return true;}
 async function schema(){if(process.env.FRIDAY_LOCAL_DEV!=='1'){const existing=await db.query("SELECT to_regclass('public.friday_staff_profile') AS staff, to_regclass('public.friday_owner_settings') AS settings");if(!existing.rows[0]?.staff||!existing.rows[0]?.settings)throw Error('Owner administration migration required.');return;}await db.query('CREATE TABLE IF NOT EXISTS friday_staff_profile(user_id INTEGER PRIMARY KEY REFERENCES "user"(id),payload TEXT NOT NULL)');await db.query('CREATE TABLE IF NOT EXISTS friday_owner_settings(user_id INTEGER PRIMARY KEY REFERENCES "user"(id),payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)');}
 async function properties(req){const rows=(await db.query('SELECT * FROM property')).rows;const result=[];for(const p of rows)if(require('./demo-data').hotels.some(h=>h[0]===p.code)&&await canAccess(db,{...req.user,propertyId:req.user.homePropertyId||req.user.propertyId},p.id)){const saved=await require('./demo-store').read(db,p.id).catch(()=>null);if(saved)Object.assign(p,require('./demo-store').stats(saved.state));result.push(p);}return result;}
 async function get(req,res){try{if(!await allowed(req,res))return;if(process.env.FRIDAY_LOCAL_DEV==='1')await schema();const props=await properties(req),ids=new Set(props.map(p=>p.id));
  const all=(await db.query('SELECT id,"propertyId",name,email,phone,role,"isActive" FROM "user" ORDER BY name')).rows;
  let profiles=[];try{profiles=(await db.query('SELECT user_id,payload FROM friday_staff_profile')).rows;}catch(e){if(e.code!=='42P01')throw e;}
  const users=require('./sample-labels').normalizeLabels(all.filter(u=>ids.has(u.propertyId)||u.id===req.user.id)).map(u=>({...u,...JSON.parse(profiles.find(p=>p.user_id===u.id)?.payload||'{}')}));
  let row;try{row=(await db.query('SELECT payload,version FROM friday_owner_settings WHERE user_id=$1',[req.user.id])).rows[0];}catch(e){if(e.code!=='42P01')throw e;}
  res.json({properties:props,users,settings:row?JSON.parse(row.payload):{organizationName:'Taj Hospitality Workspace',timezone:'Asia/Kolkata',balanceAlerts:true,maintenanceAlerts:true,requestAlerts:true,planRequest:''},version:row?.version||0,subscription:{status:'Not configured',paymentProviderConnected:false},roles});
 }catch(e){console.error(JSON.stringify({event:'owner_load_failed',code:/^[A-Z0-9_]{2,32}$/.test(e.code||'')?e.code:'UNKNOWN'}));res.status(503).json({error:'Unable to load owner administration.'});}}
 async function save(req,res){try{if(!await allowed(req,res))return;if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});await schema();const {settings,version}=req.body||{};
  if(!settings||typeof settings.organizationName!=='string'||settings.organizationName.trim().length<2||settings.organizationName.length>100)return res.status(400).json({error:'Enter an organization name between 2 and 100 characters.'});
  try{new Intl.DateTimeFormat('en',{timeZone:settings.timezone});}catch{return res.status(400).json({error:'Choose a valid timezone.'});}
  const clean={organizationName:settings.organizationName.trim(),timezone:settings.timezone,balanceAlerts:settings.balanceAlerts===true,maintenanceAlerts:settings.maintenanceAlerts===true,requestAlerts:settings.requestAlerts===true,planRequest:String(settings.planRequest||'').slice(0,500)};
  const next=await db.withTransaction(async client=>{const row=(await client.query('SELECT version FROM friday_owner_settings WHERE user_id=$1',[req.user.id])).rows[0];if((row?.version||0)!==version){const e=Error('Settings changed. Reload before saving.');e.status=409;throw e;}if(row)await client.query('UPDATE friday_owner_settings SET payload=$1,version=version+1 WHERE user_id=$2',[JSON.stringify(clean),req.user.id]);else await client.query('INSERT INTO friday_owner_settings(user_id,payload,version) VALUES($1,$2,1)',[req.user.id,JSON.stringify(clean)]);return version+1;});
  res.json({settings:clean,version:next});
 }catch(e){res.status(e.status||503).json({error:e.message||'Unable to save settings.'});}}
 async function staff(req,res){return writeStaff(req,res,false);}
 async function editStaff(req,res){return writeStaff(req,res,true);}
 async function writeStaff(req,res,editing){try{
  if(!await allowed(req,res))return;if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});
  let p;try{p=require('./staff-profile').staffProfile(req.body);}catch(e){return res.status(400).json({error:e.message});}
  const permitted=await properties(req),ids=new Set(permitted.map(p=>Number(p.id)));
  if(!ids.has(p.propertyId))return res.status(403).json({error:'Branch access denied.'});
  const targetId=Number(req.params?.id);let existing;
  if(editing){if(!Number.isSafeInteger(targetId)||targetId<1)return res.status(400).json({error:'Invalid user.'});existing=(await db.query('SELECT id,"propertyId",role FROM "user" WHERE id=$1',[targetId])).rows[0];if(!existing||!ids.has(Number(existing.propertyId)))return res.status(403).json({error:'User access denied.'});if(targetId===req.user.id&&(p.role!==existing.role||p.propertyId!==existing.propertyId))return res.status(400).json({error:'You cannot change your own role or branch.'});}
  const password=req.body.password;if(!editing&&(typeof password!=='string'||password.length<12||password.length>128))return res.status(400).json({error:'Use a temporary password of 12–128 characters.'});
  await schema();
  const user=await db.withTransaction(async client=>{
   let u;if(editing){u=(await client.query('UPDATE "user" SET name=$1,email=$2,phone=$3,role=$4,"propertyId"=$5,"updatedAt"=NOW() WHERE id=$6 RETURNING id,"propertyId",name,email,phone,role,"isActive"',[p.name,p.email,p.phone,p.role,p.propertyId,targetId])).rows[0];await client.query('DELETE FROM friday_sessions WHERE user_id=$1',[targetId]);if(existing.propertyId!==p.propertyId){await client.query('DELETE FROM friday_property_access WHERE user_id=$1 AND property_id=$2',[targetId,existing.propertyId]);await client.query('INSERT INTO friday_property_access(user_id,property_id) VALUES($1,$2) ON CONFLICT DO NOTHING',[targetId,p.propertyId]);}}
   else{u=(await client.query('INSERT INTO "user"("propertyId",name,email,phone,role,"isActive","createdAt","updatedAt") VALUES($1,$2,$3,$4,$5,true,NOW(),NOW()) RETURNING id,"propertyId",name,email,phone,role,"isActive"',[p.propertyId,p.name,p.email,p.phone,p.role])).rows[0];await client.query('INSERT INTO friday_credentials(user_id,password_hash) VALUES($1,$2)',[u.id,hashPassword(password)]);await client.query('INSERT INTO friday_property_access(user_id,property_id) VALUES($1,$2)',[u.id,p.propertyId]);}
   const profile={firstName:p.firstName,lastName:p.lastName,voiceAccess:p.voiceAccess,whatsappAccess:p.whatsappAccess};await client.query('INSERT INTO friday_staff_profile(user_id,payload) VALUES($1,$2) ON CONFLICT(user_id) DO UPDATE SET payload=EXCLUDED.payload',[u.id,JSON.stringify(profile)]);
   await client.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[p.propertyId,req.user.id,editing?'Staff account updated':'Staff account created',JSON.stringify({userId:u.id,role:p.role})]);return {...u,...profile};
  });res.status(editing?200:201).json({user});
 }catch(e){res.status(/UNIQUE|unique/.test(e.message)?409:503).json({error:/UNIQUE|unique/.test(e.message)?'This email already has an account.':'Unable to save staff account.'});}}
 async function deleteStaff(req,res){try{
 if(!await allowed(req,res))return;if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid user.'});if(id===req.user.id)return res.status(400).json({error:'You cannot delete your own account.'});
 const target=(await db.query('SELECT id,"propertyId" FROM "user" WHERE id=$1',[id])).rows[0];if(!target||!(await properties(req)).some(p=>Number(p.id)===Number(target.propertyId)))return res.status(403).json({error:'User access denied.'});
 await db.withTransaction(async client=>{await client.query('UPDATE "user" SET "isActive"=false,"updatedAt"=NOW() WHERE id=$1',[id]);await client.query('DELETE FROM friday_sessions WHERE user_id=$1',[id]);await client.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[target.propertyId,req.user.id,'Staff account deactivated',JSON.stringify({userId:id})]);});res.json({success:true});
 }catch{res.status(503).json({error:'Unable to delete staff account.'});}}
 return{get,save,staff,editStaff,deleteStaff};
}
module.exports={ownerRoutes,roles};
