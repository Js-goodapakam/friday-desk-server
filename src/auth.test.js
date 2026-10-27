const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createAuth,hashPassword,verifyPassword}=require('./auth');
const password='test-only-long-password';
const encoded=hashPassword(password);
const user={id:1,propertyId:9,name:'Test operator',email:'operator@example.test',role:'ADMIN',isActive:true,password_hash:encoded};
function response(){return {statusCode:200,headers:{},setHeader(k,v){this.headers[k]=v;},status(code){this.statusCode=code;return this;},json(value){this.body=value;return this;}};}
function fixture(){const tokens=new Set();const db={async query(sql,args){if(sql.startsWith('SELECT u.*, c.'))return {rows:args[0]===user.email?[user]:[]};if(sql.startsWith('INSERT INTO friday_sessions')){tokens.add(args[0]);return {rows:[]};}if(sql.startsWith('SELECT u.* FROM friday_sessions'))return {rows:tokens.has(args[0])?[user]:[]};if(sql.startsWith('DELETE')){tokens.delete(args[0]);return {rows:[]};}throw Error('Unexpected query');}};return createAuth(db,{secure:false,origin:'http://localhost:5173'});}
test('password hashes use unique salts and reject incorrect passwords',()=>{assert.notEqual(encoded,hashPassword(password));assert.equal(verifyPassword(password,encoded),true);assert.equal(verifyPassword('wrong',encoded),false);assert.equal(verifyPassword(password,'corrupt'),false);});
test('arbitrary credentials never receive a session',async()=>{const auth=fixture();for(const body of [{email:user.email,password:'wrong'},{email:'unknown@example.test',password}]){const res=response();await auth.login({body,ip:'test'},res);assert.equal(res.statusCode,401);assert.equal(res.headers['Set-Cookie'],undefined);}});
test('valid credentials receive an HttpOnly session; logout revokes it',async()=>{const auth=fixture(),res=response();await auth.login({body:{email:user.email,password},ip:'test'},res);assert.equal(res.statusCode,200);assert.equal(res.body.user.propertyId,9);assert.equal(res.body.user.password_hash,undefined);assert.match(res.headers['Set-Cookie'],/HttpOnly; SameSite=Lax/);const cookie=res.headers['Set-Cookie'].split(';')[0];const req={headers:{cookie}};let accepted=false;await auth.requireSession(req,response(),()=>{accepted=true;});assert.equal(accepted,true);await auth.logout(req,response());const denied=response();await auth.requireSession(req,denied,()=>assert.fail('revoked session accepted'));assert.equal(denied.statusCode,401);});
test('forged or missing sessions fail closed',async()=>{const auth=fixture();for(const cookie of ['',`friday_session=${'a'.repeat(64)}`]){const res=response();await auth.requireSession({headers:{cookie}},res,()=>assert.fail('forged session accepted'));assert.equal(res.statusCode,401);}});
test('database failures do not authenticate users',async()=>{const auth=createAuth({query(){throw Error('offline');}});const res=response();await auth.login({body:{email:user.email,password},ip:'test'},res);assert.equal(res.statusCode,503);assert.equal(res.headers['Set-Cookie'],undefined);});
test('login limits repeated incorrect attempts',async()=>{const auth=fixture();for(let n=0;n<5;n++)await auth.login({body:{email:user.email,password:'wrong'},ip:'test'},response());const res=response();await auth.login({body:{email:user.email,password},ip:'test'},res);assert.equal(res.statusCode,429);});
test('cross-origin mutations are denied',()=>{const auth=fixture(),res=response();auth.checkOrigin({headers:{origin:'https://untrusted.example'}},res,()=>assert.fail('untrusted origin accepted'));assert.equal(res.statusCode,403);});
test('isolated local mode accepts both loopback addresses on 5174 only outside secure mode',()=>{
 const previous=process.env.FRIDAY_LOCAL_DEV;process.env.FRIDAY_LOCAL_DEV='1';
 try{for(const secure of [false,true])for(const origin of ['http://localhost:5174','http://127.0.0.1:5174','http://untrusted.example:5174']){
  const auth=createAuth({}, {secure,origin:'https://app.example'}),res=response();let accepted=false;
  auth.checkOrigin({headers:{origin}},res,()=>{accepted=true;});
  assert.equal(accepted,!secure&&origin!=='http://untrusted.example:5174');
 }}finally{if(previous===undefined)delete process.env.FRIDAY_LOCAL_DEV;else process.env.FRIDAY_LOCAL_DEV=previous;}
});
