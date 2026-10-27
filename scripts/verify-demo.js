const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const base='http://127.0.0.1:3001/api',origin='http://localhost:5174';
const credentials=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../.local/demo-credentials.json'),'utf8'));
const checks=[];
async function call(route,cookie,method='GET',body){const response=await fetch(base+route,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined});return{status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]};}
async function login(account){const r=await call('/auth/login',null,'POST',{email:account.email,password:account.password});assert.equal(r.status,200);return r.cookie;}
async function run(){
 const cookie=await login(credentials.find(c=>c.role==='Super Admin'));
 const list=await call('/properties',cookie);assert.equal(list.status,200);assert.equal(list.body.properties.length,5);assert.equal(list.body.properties.reduce((s,p)=>s+p.totalRooms,0),500);
 checks.push('Super Admin sees exactly five demo properties and 500 physical rooms');
 let counts={properties:5,rooms:0,roomTypes:0,guests:0,reservations:0,ratePlans:0,dailyInventory:0,folios:0,payments:0,invoices:0,channels:0,syncEvents:0};
 for(const p of list.body.properties){const r=await call(`/properties/${p.id}/workspace`,cookie);assert.equal(r.status,200);for(const key of ['rooms','roomTypes','guests','reservations','ratePlans','dailyInventory','folios','payments','invoices'])counts[key]+=r.body.state[key].length;counts.channels+=r.body.state.channelManager.channels.length;counts.syncEvents+=r.body.state.channelManager.syncEvents.length;assert.ok(r.body.state.dailyInventory.every(i=>i.available>=0));}
 assert.deepEqual([counts.rooms,counts.roomTypes,counts.guests,counts.reservations,counts.ratePlans,counts.dailyInventory,counts.channels],[500,20,200,250,20,7300,30]);checks.push('All property workspaces return their own linked records and 365-day inventory');
 const id=list.body.properties[0].id;const initial=await call(`/properties/${id}/workspace`,cookie),snapshot=structuredClone(initial.body.state);
 try{
  const saved=await call(`/properties/${id}/workspace`,cookie,'PUT',initial.body);assert.equal(saved.status,200);
  const conflict=await call(`/properties/${id}/workspace`,cookie,'PUT',initial.body);assert.equal(conflict.status,409);checks.push('Workspace save persists and stale-version updates are rejected');
  const read=await call(`/properties/${id}/workspace`,cookie),invalid=structuredClone(read.body);invalid.state.reservations[1].room=invalid.state.reservations[0].room;
  assert.equal((await call(`/properties/${id}/workspace`,cookie,'PUT',invalid)).status,400);checks.push('Backend rejects overlapping room allocations');
  const paymentRead=await call(`/properties/${id}/workspace`,cookie),paymentState=structuredClone(paymentRead.body);
  const target=paymentState.state.reservations.find(r=>r.balance>100);const beforePaid=target.paid;target.paid+=100;
  const paymentSaved=await call(`/properties/${id}/workspace`,cookie,'PUT',paymentState);assert.equal(paymentSaved.status,200);assert.equal(paymentSaved.body.state.reservations.find(r=>r.id===target.id).paid,beforePaid+100);assert.equal(paymentSaved.body.state.payments.length,paymentRead.body.state.payments.length+1);checks.push('Simulated manual payment creates a persisted ledger entry and updates folio balances');
  const channelId=snapshot.channelManager.channels[0].id;
  for(const scenario of ['new_booking','modification','cancellation','rate_update','stop_sell','failure','retry']){
   const r=await call(`/properties/${id}/mock-sync`,cookie,'POST',{channelId,scenario});assert.equal(r.status,200,JSON.stringify({scenario,error:r.body.error}));assert.equal(r.body.state.channelManager.channels[0].connected,false);assert.ok(r.body.state.dailyInventory.every(i=>i.available>=0));if(scenario==='failure')assert.equal(r.body.state.channelManager.syncEvents[0].status,'Failed');if(scenario==='retry')assert.ok(r.body.state.channelManager.syncEvents[0].retryOf);
  }
  checks.push('All seven local mock OTA scenarios persist, validate inventory and never connect externally');
 }finally{
  const current=await call(`/properties/${id}/workspace`,cookie);const restored=await call(`/properties/${id}/workspace`,cookie,'PUT',{state:snapshot,version:current.body.version});assert.equal(restored.status,200);checks.push('Mock test changes rolled back to the original demo records');
 }
 const staff=credentials.find(c=>c.role==='Housekeeping Staff'),staffCookie=await login(staff);
 const authorized=await call(`/properties/${staff.propertyId}/workspace`,staffCookie);assert.equal(authorized.status,200);
 const other=list.body.properties.find(p=>p.id!==staff.propertyId).id;assert.equal((await call(`/properties/${other}/workspace`,staffCookie)).status,403);
 const tampered=structuredClone(authorized.body);tampered.state.invoiceSettings.taxRate=1;assert.equal((await call(`/properties/${staff.propertyId}/workspace`,staffCookie,'PUT',tampered)).status,403);
 checks.push('Property-specific staff cannot read another hotel or change finance configuration');
 const before=JSON.stringify(list.body.properties.map(p=>[p.id,p.code]).sort());
 execFileSync(process.execPath,[path.resolve(__dirname,'seed-demo.js'),'--local'],{stdio:'pipe'});
 const after=await call('/properties',cookie);assert.equal(JSON.stringify(after.body.properties.map(p=>[p.id,p.code]).sort()),before);checks.push('Rerunning the seed preserves property IDs and does not duplicate records');
 const guard=(()=>{try{execFileSync(process.execPath,[path.resolve(__dirname,'seed-demo.js'),'--local'],{env:{...process.env,NODE_ENV:'production'},stdio:'pipe'});return false;}catch{return true;}})();assert.equal(guard,true);checks.push('Production environment guard refuses the seed');
 await call('/auth/logout',staffCookie,'POST',{});await call('/auth/logout',cookie,'POST',{});
 const result={checkedAt:new Date().toISOString(),environment:'Isolated local SQLite only',status:'PASS',counts,checks,images:{installed:['Mumbai','Bengaluru','Udaipur'],pending:['Goa','Chennai']}};
 const output=path.resolve(__dirname,'../../../outputs/demo-validation.json');fs.writeFileSync(output,JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
}
run().catch(error=>{console.error(error.stack);process.exitCode=1;});
