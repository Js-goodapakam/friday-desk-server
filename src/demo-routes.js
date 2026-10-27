const {randomUUID}=require('node:crypto');
const store=require('./demo-store'),model=require('./demo-data'),{canAccess}=require('./properties');
function routes(db){
 async function eligible(req,res){
  if(process.env.FRIDAY_LOCAL_DEV!=='1'||!db.file)return res.status(404).json({error:'Sample data workspaces are available only in isolated local development.'}),null;
  const id=Number(req.params.id);if(!Number.isSafeInteger(id)||id<1)return res.status(400).json({error:'Invalid property.'}),null;
  if(!await canAccess(db,{...req.user,propertyId:req.user.homePropertyId||req.user.propertyId},id))return res.status(403).json({error:'Property access denied.'}),null;
  return id;
 }
 async function get(req,res){try{const id=await eligible(req,res);if(!id)return;const result=await store.read(db,id);res.json(result||{state:null,version:0});}catch(error){res.status(503).json({error:'Unable to load database-backed workspace.'});}}
 async function put(req,res){try{
  const id=await eligible(req,res);if(!id)return;
  const current=await store.read(db,id);if(!current)return res.status(404).json({error:'No sample workspace exists for this property.'});
  const {state,version}=req.body||{};if(!state||Number(state.property?.id)!==id||state.demo?.seed!==model.SEED)return res.status(400).json({error:'Invalid property workspace.'});
  const allowed={HOUSEKEEPING:['housekeeping','rooms','requests','tasks'],FINANCE:['payments','folios','invoices','invoiceSettings','reservations'],REVENUE:['inventoryOverrides','inventoryAudit','ratePlans','channelManager'],FRONT_DESK:['guests','reservations','rooms','requests','tasks','communications','roomChanges','enquiries','groups'],RESERVATIONS:['guests','reservations','requests','tasks','communications','enquiries','groups']};
  if(!['ADMIN','MANAGER'].includes(req.user.role)){
   const keys=allowed[req.user.role];if(!keys)return res.status(403).json({error:'This role cannot edit a property workspace.'});
   for(const key of new Set([...Object.keys(current.state),...Object.keys(state)]))if(!keys.includes(key)&&JSON.stringify(state[key])!==JSON.stringify(current.state[key]))return res.status(403).json({error:'Your role cannot change '+key+'.'});
  }
  if(JSON.stringify(state.users)!==JSON.stringify(current.state.users))return res.status(400).json({error:'Sample data staff access is managed by the secure seed, not browser profile edits.'});
  if(Object.values(state).some(value=>value===undefined))return res.status(400).json({error:'Incomplete workspace.'});
  for(const r of state.reservations){
   const old=current.state.reservations.find(x=>x.id===r.id);
   if(!state.folios.some(f=>f.reservationId===r.id))state.folios.push({id:'DEMO-F-'+r.id,reservationId:r.id,guestId:r.guestId,charges:[{description:'Room nights',quantity:model.nights(r),rate:r.rate,kind:'Room'}],discount:0,currency:'INR',simulated:true});
   const difference=Math.round(((r.paid||0)-(old?.paid||0))*100)/100;
   if(difference&&JSON.stringify(state.payments)===JSON.stringify(current.state.payments))state.payments.push({id:'DEMO-PAY-'+randomUUID(),reservationId:r.id,amount:Math.abs(difference),type:difference<0?'Refund':'Payment',method:'Simulated manual entry',status:'Simulated',paidAt:new Date().toISOString(),simulated:true});
  }
  model.financials(state);
  require('./reservation-transitions').validateTransitions(current.state,state);
  state.property.status='Active';
  const result=await store.save(db,id,state,version,req.user.id);res.json(result);
 }catch(error){res.status(error.status||400).json({error:error.message});}}
 async function simulate(req,res){try{
  const id=await eligible(req,res);if(!id)return;
  if(!['ADMIN','MANAGER','REVENUE'].includes(req.user.role))return res.status(403).json({error:'Revenue or administrator permission required.'});
  const current=await store.read(db,id);if(!current)return res.status(404).json({error:'Sample data workspace missing.'});
  const state=current.state,{scenario,channelId}=req.body||{},channel=state.channelManager.channels.find(c=>c.id===channelId);
  if(!channel?.simulated)return res.status(400).json({error:'Choose a simulated channel.'});
  const event={id:'DEMO-SYNC-'+randomUUID(),channel:channel.provider,action:scenario,status:'Simulated success',at:new Date().toISOString(),simulated:true};
  const target=scenario==='new_booking'?state.reservations.find(r=>r.status==='Pending'):state.reservations.find(r=>['Confirmed','Modified'].includes(r.status)&&r.arrival>model.START);
  if(['new_booking','modification','cancellation'].includes(scenario)&&!target)return res.status(409).json({error:'No eligible future sample booking remains. Reset the seed to replay.'});
  if(scenario==='new_booking'){target.status='Confirmed';target.source=channel.provider;state.folios.find(f=>f.reservationId===target.id).charges=[{description:'Room nights',quantity:model.nights(target),rate:target.rate,kind:'Room'}];event.details='Confirmed an existing pending sample booking; inventory reduced.';}
  else if(scenario==='modification'){target.arrival=model.day(1,target.arrival);target.departure=model.day(1,target.departure);target.status='Modified';event.details='Moved a demo stay by one day; availability revalidated.';}
  else if(scenario==='cancellation'){
   target.status='Cancelled';const folio=state.folios.find(f=>f.reservationId===target.id);folio.charges=[];folio.discount=0;
   if(target.paid)state.payments.push({id:'DEMO-REF-'+randomUUID(),reservationId:target.id,amount:target.paid,type:'Refund',method:'Simulated reversal',status:'Simulated',simulated:true,paidAt:event.at});
   event.details='Cancelled a sample booking, simulated a refund and restored inventory.';
  }else if(['rate_update','stop_sell'].includes(scenario)){
   const type=state.roomTypes[0],key=`${type.name}|${model.START}`,previous=state.inventoryOverrides[key]||{};
   state.inventoryOverrides[key]={...previous,...(scenario==='rate_update'?{rate:(previous.rate||type.baseRate)+500}:{stopSell:!previous.stopSell})};
   event.details='Updated local demonstration rate/restriction only.';
  }else if(scenario==='failure'){event.status='Failed';event.error='Injected demo timeout';}
  else if(scenario==='retry'){const failed=state.channelManager.syncEvents.find(e=>e.channel===channel.provider&&e.status==='Failed');if(!failed)return res.status(409).json({error:'No failed event available for retry.'});event.retryOf=failed.id;event.details='Local retry succeeded.';}
  else return res.status(400).json({error:'Unsupported mock scenario.'});
  if(target&&['new_booking','modification','cancellation'].includes(scenario)){target.statusHistory.push({at:event.at,status:target.status,by:'Local mock simulator'});event.reservationId=target.id;}
  state.channelManager.syncEvents.unshift(event);channel.lastSync=event.status==='Failed'?channel.lastSync:event.at;
  const result=await store.save(db,id,state,current.version,req.user.id);res.json(result);
 }catch(error){res.status(error.status||400).json({error:error.message});}}
 async function audit(req,res){try{const id=await eligible(req,res);if(!id)return;if(!['ADMIN','MANAGER'].includes(req.user.role))return res.status(403).json({error:'Manager access required.'});const rows=(await db.query('SELECT id,actor_id,action,at,payload FROM friday_demo_audit WHERE property_id=$1 ORDER BY id DESC LIMIT 200',[id])).rows;res.json({records:require('./sample-labels').normalizeLabels(rows)});}catch{res.status(503).json({error:'Unable to load audit history.'});}}
 return{get,put,simulate,audit};
}
module.exports={routes};
