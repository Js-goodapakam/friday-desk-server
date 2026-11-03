// Deterministic pricing: no external demand or AI predictions are fabricated.
const round=n=>Math.round(n*100)/100;
const validDay=d=>typeof d==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(d)&&Number.isFinite(Date.parse(d))&&new Date(d+'T12:00:00Z').toISOString().slice(0,10)===d;
const dayAfter=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const indiaToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Kolkata'}).format(new Date());
function categories(state){return state.roomTypes?.length?state.roomTypes:[...new Set(state.rooms.map(r=>r.type))].map(name=>({id:name,name,baseRate:null}));}
function validateConfig(config,state){
 if(!config||!Array.isArray(config.rules)||config.rules.length>100||!Array.isArray(config.limits))throw Error('Invalid pricing configuration.');
 const types=new Set(categories(state).map(t=>t.id)),ids=new Set();
 for(const l of config.limits){if(!types.has(l.roomTypeId)||!Number.isFinite(l.min)||!Number.isFinite(l.max)||l.min<0||l.max<l.min||l.max>10000000)throw Error('Set valid minimum and maximum rates for each category.');}
 if(new Set(config.limits.map(l=>l.roomTypeId)).size!==config.limits.length)throw Error('Duplicate category limits.');
 for(const r of config.rules){
  if(typeof r.id!=='string'||ids.has(r.id)||!r.name?.trim()||r.name.length>100||!['occupancy','leadTime','weekday'].includes(r.kind)||!['percent','fixed'].includes(r.adjustment)||!Number.isFinite(r.value)||r.value < -100000||r.value>100000||typeof r.enabled!=='boolean'||!Number.isInteger(r.priority)||r.priority<0||r.priority>999)throw Error('Invalid pricing rule.');ids.add(r.id);
  if(r.adjustment==='percent'&&(r.value < -100||r.value>500))throw Error('Percentage adjustments must be between -100 and 500.');
  if(r.roomTypeId!=='all'&&!types.has(r.roomTypeId))throw Error('Unknown room category.');
  if(!validDay(r.from)||!validDay(r.to)||r.to<r.from)throw Error('Choose valid rule dates.');
  if(r.kind==='weekday'){if(!Array.isArray(r.days)||!r.days.length||r.days.some(d=>!Number.isInteger(d)||d<0||d>6))throw Error('Choose weekdays.');}
  else if(!Number.isFinite(r.min)||!Number.isFinite(r.max)||r.min<0||r.max<r.min||r.max>(r.kind==='occupancy'?100:365))throw Error('Invalid condition range.');
 }
 return config;
}
function preview(state,config,from,to,today=indiaToday()){
 validateConfig(config,state);
 if(!validDay(from)||!validDay(to)||from<today||to<from||Date.parse(to)-Date.parse(from)>365*86400000)throw Error('Choose a future range of at most 366 dates.');
 const results=[],types=categories(state);
 for(let date=from;date<=to;date=dayAfter(date,1))for(const type of types){
  const rooms=state.rooms.filter(r=>r.roomTypeId===type.id||r.type===type.name),numbers=new Set(rooms.map(r=>String(r.number)));
  const booked=new Set(state.reservations.filter(r=>['Confirmed','Checked In','Modified'].includes(r.status)&&r.arrival<=date&&date<r.departure&&numbers.has(String(r.room))).map(r=>String(r.room)));
  const occupancy=rooms.length?100*booked.size/rooms.length:0,leadTime=Math.round((Date.parse(date)-Date.parse(today))/86400000);
  const match=config.rules.filter(r=>r.enabled&&(r.roomTypeId==='all'||r.roomTypeId===type.id)&&r.from<=date&&date<=r.to&&(r.kind==='weekday'?r.days.includes(new Date(date+'T12:00:00Z').getUTCDay()):r.kind==='occupancy'?occupancy>=r.min&&occupancy<=r.max:leadTime>=r.min&&leadTime<=r.max)).sort((a,b)=>a.priority-b.priority||a.id.localeCompare(b.id))[0];
  const base=type.baseRate,override=state.inventoryOverrides?.[`${type.name}|${date}`],limits=config.limits.find(l=>l.roomTypeId===type.id);
  let reason=!rooms.length?'No rooms':!Number.isFinite(base)||base<=0?'Base rate required':!limits?'Rate limits required':!match?'No matching rule':override?.rate!=null&&override.source!=='revenue-manager'?'Manual rate protected':'';
  let proposed=reason?null:round(Math.max(limits.min,Math.min(limits.max,match.adjustment==='percent'?base*(1+match.value/100):base+match.value)));
  results.push({roomTypeId:type.id,type:type.name,date,base,previous:override?.rate??base,proposed,occupancy:round(occupancy),leadTime,ruleId:match?.id||null,rule:match?.name||null,reason,changed:!reason&&proposed!==(override?.rate??base)});
 }
 return results;
}
function apply(state,config,from,to,actor,today=indiaToday()){
 const rows=preview(state,config,from,to,today),at=new Date().toISOString();
 const overrides={...state.inventoryOverrides},events=[];
 for(const row of rows.filter(r=>r.changed)){const key=`${row.type}|${row.date}`;overrides[key]={...overrides[key],rate:row.proposed,source:'revenue-manager',ruleId:row.ruleId};events.push({id:require('node:crypto').randomUUID(),at,type:row.type,day:row.date,rate:row.proposed,previousRate:row.previous,rule:row.rule,by:String(actor),source:'revenue-manager'});}
 return {...state,revenueManagement:config,inventoryOverrides:overrides,inventoryAudit:[...events,...(state.inventoryAudit||[])].slice(0,1000)};
}
module.exports={validateConfig,preview,apply,categories,indiaToday};
