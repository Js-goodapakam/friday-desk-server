const {test}=require('node:test'),assert=require('node:assert/strict'),{DatabaseSync}=require('node:sqlite');
const {accessRepository}=require('./access-repository'),{authorize}=require('./access-policy');
function fixture(){
 const db=new DatabaseSync(':memory:');
 db.exec(`CREATE TABLE user(id INTEGER PRIMARY KEY,isActive INTEGER);
 CREATE TABLE engage_organization(id TEXT,active INTEGER);
 CREATE TABLE engage_membership(user_id INTEGER,organization_id TEXT,active INTEGER);
 CREATE TABLE engage_property_access(user_id INTEGER,organization_id TEXT,property_id INTEGER,active INTEGER);
 CREATE TABLE engage_role_assignment(user_id INTEGER,organization_id TEXT,property_id INTEGER,scope TEXT,role_key TEXT,active INTEGER,expires_at TEXT);
 CREATE TABLE engage_custom_role(role_key TEXT,organization_id TEXT,active INTEGER,features_json TEXT);
 CREATE TABLE engage_permission_override(user_id INTEGER,organization_id TEXT,property_id INTEGER,scope TEXT,feature_key TEXT,actions_json TEXT,effect TEXT,active INTEGER,expires_at TEXT);
 CREATE TABLE engage_subscription(organization_id TEXT,plan TEXT,status TEXT,starts_at TEXT,ends_at TEXT,entitlements_json TEXT);
 INSERT INTO user VALUES(1,1);INSERT INTO engage_organization VALUES('a',1),('b',1);
 INSERT INTO engage_membership VALUES(1,'a',1);
 INSERT INTO engage_property_access VALUES(1,'a',10,1);
 INSERT INTO engage_role_assignment VALUES(1,'a',10,'property','front_desk',1,NULL);
 INSERT INTO engage_subscription VALUES('a','premium','active','2026-01-01','2027-01-01','{"reservations":true,"internal_chat":true}');`);
 const calls=[];const client={async query(sql,args){calls.push({sql,args});const values=[];sql=sql.replace(/\$(\d+)/g,(_,n)=>{values.push(args[Number(n)-1]);return '?';});return {rows:db.prepare(sql).all(...values)};}};
 return {db,calls,repo:accessRepository(client)};
}
const request={organizationId:'a',propertyId:10,feature:'reservations.direct_reservations',action:'create',resourceAllowed:true};
const now=Date.parse('2026-11-06T00:00:00Z');
test('access loads from persisted local rows and sees revocation without restart',async()=>{
 const f=fixture();try{assert.equal(authorize(await f.repo.load(1,request),request,now).allowed,true);f.db.exec("UPDATE engage_role_assignment SET active=0");assert.equal(authorize(await f.repo.load(1,request),request,now).allowed,false);}finally{f.db.close();}
});
test('foreign tenant denial happens before tenant data is read',async()=>{
 const f=fixture();try{const result=await f.repo.load(1,{organizationId:'b'});assert.equal(authorize(result,{...request,organizationId:'b'},now).allowed,false);assert.equal(f.calls.length,2);assert.ok(!f.calls.some(x=>/FROM engage_subscription/.test(x.sql)));}finally{f.db.close();}
});
test('database entitlement changes are read again and Basic blocks Connect',async()=>{
 const f=fixture();try{f.db.exec("UPDATE engage_subscription SET plan='basic'");const result=authorize(await f.repo.load(1,request),{...request,feature:'internal_chat.one_to_one_direct_messaging'},now);assert.equal(result.reason,'upgrade_required');}finally{f.db.close();}
});
test('inactive identity does not load permissions',async()=>{
 const f=fixture();try{f.db.exec('UPDATE user SET isActive=0');const result=await f.repo.load(1,request);assert.equal(result.principal.authenticated,false);assert.equal(f.calls.length,1);}finally{f.db.close();}
});
test('malformed permission JSON fails closed rather than using a permissive default',async()=>{
 const f=fixture();try{f.db.exec("INSERT INTO engage_custom_role VALUES('x','a',1,'invalid')");await assert.rejects(()=>f.repo.load(1,request));}finally{f.db.close();}
});
