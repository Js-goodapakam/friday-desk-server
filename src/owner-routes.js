const {hashPassword}=require('./auth');
const {canAccess}=require('./properties');
const roles=['ADMIN','MANAGER','FRONT_DESK','HOUSEKEEPING','REVENUE','FINANCE','RESERVATIONS'];
function ownerRoutes(db){
 async function allowed(req,res){if(process.env.FRIDAY_LOCAL_DEV!=='1'||!db.file){res.status(503).json({error:'Owner administration storage requires deployment configuration.'});return false;}if(!['ADMIN','MANAGER'].includes(req.user.role)){res.status(403).json({error:'Owner or manager access required.'});return false;}return true;}
 async function schema(){await db.query('CREATE TABLE IF NOT EXISTS friday_owner_settings(user_id INTEGER PRIMARY KEY REFERENCES user(id),payload TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1)');}
 async function properties(req){const rows=(await db.query('SELECT * FROM property')).rows;const result=[];for(const p of rows)if(require('./demo-data').hotels.some(h=>h[0]===p.code)&&await canAccess(db,{...req.user,propertyId:req.user.homePropertyId||req.user.propertyId},p.id))result.push(p);return result;}
 async function get(req,res){try{if(!await allowed(req,res))return;await schema();const props=await properties(req),ids=new Set(props.map(p=>p.id));
  const all=(await db.query('SELECT id,propertyId,name,email,phone,role,isActive FROM user ORDER BY name')).rows;
  const users=require('./sample-labels').normalizeLabels(all.filter(u=>ids.has(u.propertyId)||u.id===req.user.id));
  const row=(await db.query('SELECT payload,version FROM friday_owner_settings WHERE user_id=$1',[req.user.id])).rows[0];
  res.json({properties:props,users,settings:row?JSON.parse(row.payload):{organizationName:'Taj Hospitality Workspace',timezone:'Asia/Kolkata',balanceAlerts:true,maintenanceAlerts:true,requestAlerts:true,planRequest:''},version:row?.version||0,subscription:{status:'Not configured',paymentProviderConnected:false},roles});
 }catch{res.status(503).json({error:'Unable to load owner administration.'});}}
 async function save(req,res){try{if(!await allowed(req,res))return;if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});await schema();const {settings,version}=req.body||{};
  if(!settings||typeof settings.organizationName!=='string'||settings.organizationName.trim().length<2||settings.organizationName.length>100)return res.status(400).json({error:'Enter an organization name between 2 and 100 characters.'});
  try{new Intl.DateTimeFormat('en',{timeZone:settings.timezone});}catch{return res.status(400).json({error:'Choose a valid timezone.'});}
  const clean={organizationName:settings.organizationName.trim(),timezone:settings.timezone,balanceAlerts:settings.balanceAlerts===true,maintenanceAlerts:settings.maintenanceAlerts===true,requestAlerts:settings.requestAlerts===true,planRequest:String(settings.planRequest||'').slice(0,500)};
  const next=await db.withTransaction(async client=>{const row=(await client.query('SELECT version FROM friday_owner_settings WHERE user_id=$1',[req.user.id])).rows[0];if((row?.version||0)!==version){const e=Error('Settings changed. Reload before saving.');e.status=409;throw e;}if(row)await client.query('UPDATE friday_owner_settings SET payload=$1,version=version+1 WHERE user_id=$2',[JSON.stringify(clean),req.user.id]);else await client.query('INSERT INTO friday_owner_settings(user_id,payload,version) VALUES($1,$2,1)',[req.user.id,JSON.stringify(clean)]);return version+1;});
  res.json({settings:clean,version:next});
 }catch(e){res.status(e.status||503).json({error:e.message||'Unable to save settings.'});}}
 async function staff(req,res){try{if(!await allowed(req,res))return;if(req.user.role!=='ADMIN')return res.status(403).json({error:'Administrator access required.'});
  const {name,email,role,propertyId,password}=req.body||{},id=Number(propertyId);
  if(typeof name!=='string'||name.trim().length<2||name.length>100||typeof email!=='string'||!/^\S+@\S+\.\S+$/.test(email)||email.length>254||!roles.includes(role))return res.status(400).json({error:'Enter a valid name, email and role.'});
  if(typeof password!=='string'||password.length<12||password.length>128)return res.status(400).json({error:'Use a unique temporary password of 12–128 characters.'});
  if(!(await properties(req)).some(p=>p.id===id))return res.status(403).json({error:'Property access denied.'});
  const user=await db.withTransaction(async client=>{const r=await client.query('INSERT INTO user(propertyId,name,email,role,isActive,"createdAt","updatedAt") VALUES($1,$2,$3,$4,true,NOW(),NOW()) RETURNING id,propertyId,name,email,role,isActive',[id,name.trim(),email.trim().toLowerCase(),role]);const u=r.rows[0];await client.query('INSERT INTO friday_credentials(user_id,password_hash) VALUES($1,$2)',[u.id,hashPassword(password)]);await client.query('INSERT INTO friday_property_access(user_id,property_id) VALUES($1,$2)',[u.id,id]);await client.query('INSERT INTO friday_demo_audit(property_id,actor_id,action,at,payload) VALUES($1,$2,$3,NOW(),$4)',[id,req.user.id,'Staff account created',JSON.stringify({userId:u.id,role})]);return u;});res.status(201).json({user});
 }catch(e){res.status(/UNIQUE|unique/.test(e.message)?409:503).json({error:/UNIQUE|unique/.test(e.message)?'This email already has an account.':'Unable to create staff account.'});}}
 return{get,save,staff};
}
module.exports={ownerRoutes,roles};
