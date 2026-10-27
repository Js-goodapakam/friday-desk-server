const START='2026-10-26';
const SEED='friday-taj-demo-v1';
const DISCLAIMER='LOCAL TEST DATA — all operational records are fictional.';
const hotels=[
 ['TAJ-MUM-001','The Taj Mahal Palace','Mumbai','Maharashtra','Colaba',[[ 'Luxury Room',50,18000],['Palace View Room',35,24000],['Executive Suite',25,42000],['Presidential Suite',10,95000]]],
 ['TAJ-BLR-002','Taj West End','Bengaluru','Karnataka','Race Course Road',[['Superior Room',40,12000],['Deluxe Room',35,16000],['Luxury Suite',20,28000],['Presidential Suite',5,65000]]],
 ['TAJ-UDR-003','Taj Lake Palace','Udaipur','Rajasthan','Lake Pichola',[['Palace Room',30,35000],['Lake View Room',25,48000],['Royal Suite',20,75000],['Grand Royal Suite',5,120000]]],
 ['TAJ-GOA-004','Taj Exotica Resort & Spa','Benaulim','Goa','Benaulim',[['Garden View Room',35,16000],['Sea View Room',30,22000],['Luxury Villa',20,38000],['Presidential Villa',5,85000]]],
 ['TAJ-MAA-005','Taj Coromandel','Chennai','Tamil Nadu','Nungambakkam',[['Superior Room',45,11000],['Luxury Room',35,15000],['Club Room',20,19000],['Executive Suite',10,32000]]]
];
const providers=['Booking.com','Agoda','Expedia','MakeMyTrip','Goibibo','Direct Booking Engine'];
const roles=['Super Admin','Property Admin','General Manager','Front Desk Manager','Front Desk Executive','Housekeeping Manager','Housekeeping Staff','Revenue Manager','Finance Manager','Reservation Executive'];
const day=(offset,base=START)=>new Date(Date.parse(base+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
const nights=r=>Math.round((Date.parse(r.departure)-Date.parse(r.arrival))/86400000);
const active=r=>['Confirmed','Checked In','Modified'].includes(r.status);
const includesDay=(r,d)=>r.arrival<=d&&d<r.departure;
const round=n=>Math.round(n*100)/100;

function financials(state) {
 for(const r of state.reservations){
  const folio=state.folios.find(f=>f.reservationId===r.id);
  if(!folio)continue;
  for(const charge of folio.charges)if(charge.kind==='Room'){charge.quantity=nights(r);charge.rate=r.rate;}
  const subtotal=round(folio.charges.reduce((sum,x)=>sum+x.quantity*x.rate,0));
  const taxable=round(Math.max(0,subtotal-folio.discount));
  folio.taxRate=folio.taxRate??state.invoiceSettings.taxRate;
  const tax=round(taxable*folio.taxRate/100);
  const total=round(taxable+tax);
  const paid=round(state.payments.filter(p=>p.reservationId===r.id&&p.status==='Simulated').reduce((s,p)=>s+(p.type==='Refund'?-p.amount:p.amount),0));
  Object.assign(folio,{subtotal,taxAmount:tax,total,paid,balance:round(Math.max(0,total-paid))});
  Object.assign(r,{folioTotal:total,paid,totalAmount:total,balance:folio.balance});
  const invoice=state.invoices.find(i=>i.reservationId===r.id);
  if(invoice)Object.assign(invoice,{subtotal,discount:folio.discount,taxRate:folio.taxRate,taxAmount:tax,total,paid,status:r.status==='Cancelled'?'Cancelled':folio.balance?'Outstanding':'Paid',items:folio.charges.map(c=>({...c,amount:round(c.quantity*c.rate)}))});
 }
}

function inventory(state){
 state.dailyInventory=[];
 for(const type of state.roomTypes){
  const rooms=state.rooms.filter(r=>r.type===type.name);
  for(let index=0;index<365;index++){
   const date=day(index),occupied=new Set(state.reservations.filter(r=>active(r)&&includesDay(r,date)&&rooms.some(room=>room.number===r.room)).map(r=>r.room));
   const closures=state.roomBlocks.filter(b=>includesDay(b,date)&&rooms.some(r=>r.number===b.room));
   const closed=new Set(closures.map(b=>b.room)),outOfOrder=closures.filter(b=>b.kind==='Maintenance').length;
   const override=state.inventoryOverrides[`${type.name}|${date}`];
   if(override&&((override.sellable!==undefined&&(!Number.isInteger(override.sellable)||override.sellable<0||override.sellable>rooms.length))||(override.rate!==undefined&&(!Number.isFinite(override.rate)||override.rate<0))))throw Error('Invalid rate or sellable inventory');
   const sellable=Math.min(rooms.length-closed.size,override?.sellable??rooms.length-closed.size);
   if(sellable<occupied.size)throw new Error('Inventory below allocated rooms');
   state.dailyInventory.push({id:`${type.id}:${date}`,roomTypeId:type.id,type:type.name,date,total:rooms.length,sellable,available:override?.stopSell?0:sellable-occupied.size,confirmed:occupied.size,outOfOrder,blocked:closed.size-outOfOrder,stopSell:override?.stopSell??false,minStay:override?.minStay??1,maxStay:override?.maxStay??30,closedToArrival:override?.closedToArrival??false,closedToDeparture:override?.closedToDeparture??false,rate:override?.rate??type.baseRate});
  }
 }
 const today=state.dailyInventory.filter(i=>i.date===START),occupied=new Set(state.reservations.filter(r=>active(r)&&includesDay(r,START)).map(r=>r.room)).size;
 const historical=state.reservations.filter(r=>['Checked In','Checked Out'].includes(r.status));
 let soldNights=0,roomRevenue=0;
 for(const r of historical)for(let d=r.arrival;d<r.departure&&d<day(1);d=day(1,d)){soldNights++;roomRevenue+=r.rate;}
 const bookable=state.reservations.filter(r=>!['Cancelled','No Show','Pending'].includes(r.status));
 state.metrics={asOf:START,totalRooms:state.rooms.length,availableRooms:today.reduce((s,i)=>s+i.available,0),occupiedRooms:occupied,occupancy:round(100*occupied/state.rooms.length),soldNights,roomRevenue,adr:soldNights?round(roomRevenue/soldNights):0,revpar:round(roomRevenue/(state.rooms.length*31)),bookingValue:round(state.reservations.reduce((s,r)=>s+r.totalAmount,0)),cashCollected:round(state.payments.reduce((s,p)=>s+(p.type==='Refund'?-p.amount:p.amount),0)),outstanding:round(state.folios.reduce((s,f)=>s+f.balance,0)),cancelled:state.reservations.filter(r=>r.status==='Cancelled').length,cancellationRate:round(100*state.reservations.filter(r=>r.status==='Cancelled').length/state.reservations.length),averageStay:bookable.length?round(bookable.reduce((s,r)=>s+nights(r),0)/bookable.length):0,arrivals:state.reservations.filter(r=>r.arrival===START&&r.status==='Confirmed').length,departures:state.reservations.filter(r=>r.departure===START&&r.status==='Checked In').length,channelRevenue:providers.map(source=>({source,bookings:state.reservations.filter(r=>r.source===source).length,value:round(state.reservations.filter(r=>r.source===source).reduce((s,r)=>s+r.totalAmount,0))})),definitions:{occupancy:'Allocated room nights / physical rooms on the reference date, including modified confirmed stays.',adr:'Recognized room charges / occupied room nights through the reference date.',revpar:'Recognized room charges for the preceding 31-day window / physical room nights in that window.',bookingValue:'Folio totals, including demonstration taxes and services; distinct from recognized room revenue and cash.',cashCollected:'Simulated receipts minus simulated refunds.',tax:'Configurable demonstration tax only; not production GST compliance.'}};
 return state;
}

function generateHotel(index,propertyId,staff=[]){
 const [code,name,city,region,address,categories]=hotels[index];
 const prefix=`LOCAL-${index+1}`;
 const state={demo:{seed:SEED,referenceDate:START,disclaimer:DISCLAIMER},property:{id:propertyId,name,code,address:`${address}, ${city}, ${region}, India`,city,state:region,country:'India',currency:'INR',timezone:'Asia/Kolkata',language:'English',status:'Active',type:index===3?'Resort':'Luxury Hotel',checkIn:index===3?'15:00':'14:00',checkOut:'12:00',email:`${code.toLowerCase()}@example.test`,phone:'LOCAL-CONTACT-NOT-DIALABLE',gstNumber:'',managerName:'Fictional Property Manager',amenities:['Wi-Fi','Pool','Fitness studio','Restaurant','Spa','Concierge'],policies:{cancellation:'Fictional flexible policy: cancel 48 hours before arrival; first night penalty thereafter.',children:'Children welcome; occupancy limits apply.',services:['Airport transfer','Laundry','Room service']}},properties:[],roomTypes:[],rooms:[],ratePlans:[],guests:[],reservations:[],folios:[],payments:[],invoices:[],requests:[],housekeeping:[],tasks:[],roomBlocks:[],roomChanges:[],communications:[],inventoryOverrides:{},inventoryAudit:[],callActivities:[],users:staff,invoiceSettings:{prefix:'LOCAL',nextNumber:51,taxRate:12,taxLabel:'LOCAL TEST TAX — not compliance advice',terms:DISCLAIMER,template:'classic'},telecmi:{enabled:false,status:'Not connected',agents:[],userMappings:{}},whatsapp:{connected:false,userMappings:{}},meta:{connected:false,userMappings:{}},rcs:{connected:false,userMappings:{}},channelManager:{mock:true,channels:[],syncEvents:[]}};
 for(const [t,[type,quantity,baseRate]]of categories.entries()){
  const suite=/Suite|Villa/.test(type),id=`${prefix}-RT-${t+1}`;
  state.roomTypes.push({id,name:type,quantity,baseRate,maxAdults:suite?3:2,maxChildren:1,bed:suite?'King + sofa bed':'King or twin',size:35+t*18,amenities:['Wi-Fi','Air conditioning','Tea service',...(suite?['Living room']:[])],view:type.includes('View')?type.replace(' Room',''):'Hotel grounds',extraAdult:2500,extraChild:1000,cancellationPolicy:state.property.policies.cancellation,description:`Fictional ${type.toLowerCase()} for a hospitality demonstration.`,inventoryAllocation:quantity});
  for(let n=0;n<quantity;n++){const number=String(100+state.rooms.length+1);state.rooms.push({id:`${prefix}-ROOM-${number}`,number,type,roomTypeId:id,floor:String(Math.floor(Number(number)/100)),capacity:suite?4:3,status:'Available',housekeepingStatus:['Clean','Inspected','Dirty'][n%3]});}
 }
 for(const [p,[code,label,extra]]of [['EP','Room Only',0],['CP','Room + Breakfast',1500],['MAP','Room + Breakfast + One Meal',3500],['AP','Room + Three Meals',5500]].entries())state.ratePlans.push({id:`${prefix}-RP-${p+1}`,code,name:label,supplement:extra,cancellationPolicy:'Flexible 48h (fictional)',nonRefundableDiscount:10,rates:state.roomTypes.map(type=>({roomTypeId:type.id,rate:type.baseRate+extra}))});
 const firstNames=['Aarav','Diya','Kabir','Meera','Rohan','Anaya','Ishaan','Sara'];
 for(let n=0;n<40;n++){const serial=index*40+n+1;state.guests.push({id:`${prefix}-G-${n+1}`,name:`${firstNames[n%8]} ${String(serial).padStart(3,'0')}`,email:`guest-${serial}@example.test`,phone:`LOCAL-PHONE-${String(serial).padStart(4,'0')}`,nationality:n%5?'Indian':'International',category:['Leisure','Business','Family','Corporate'][n%4],vip:n%9===0,preferences:['Non-smoking',n%2?'Quiet room':'High floor'],specialRequests:n%3?'':'Fictional dietary preference',idType:'Not collected',idNumber:'',address:'Fictional test address',visitHistory:[],notes:DISCLAIMER});}
 const statuses=['Checked In','Checked In','Confirmed','Confirmed','Checked Out','Checked Out','Cancelled','No Show','Pending','Modified'];
 for(let n=0;n<50;n++){
  const status=statuses[n%10],room=state.rooms[Math.floor(n*(state.rooms.length-2)/50)],type=state.roomTypes.find(t=>t.id===room.roomTypeId),plan=state.ratePlans[n%4],id=`${prefix}-R-${n+1}`;
  let arrival,departure;
  if(status==='Checked In'){arrival=day(-2);departure=day(n%10===0?0:2);}
  else if(status==='Checked Out'){arrival=day(-22+n%5);departure=day(-19+n%5);}
  else if(status==='No Show'){arrival=day(-3);departure=day(-1);}
  else{arrival=day(n%10===2?0:1+n%12);departure=day(3,arrival);}
  const rate=type.baseRate+plan.supplement,guest=state.guests[n%40];
  const r={id,guestId:guest.id,room:room.number,roomTypeId:type.id,ratePlanId:plan.id,rate,arrival,departure,status,bookingDate:day(-30+n%15),source:providers[n%6],externalReference:`MOCK-${id}`,adults:2,children:n%4===0?1:0,expectedIn:state.property.checkIn,expectedOut:'12:00',actualCheckIn:['Checked In','Checked Out'].includes(status)?`${arrival}T08:30:00Z`:null,actualCheckOut:status==='Checked Out'?`${departure}T06:30:00Z`:null,earlyCheckIn:n%10===1,lateCheckOut:n%10===0,specialRequests:guest.specialRequests,statusHistory:[{at:`${day(-30+n%15)}T05:00:00Z`,status:'Pending',by:'Demo seed'},{at:`${day(-29+n%15)}T05:00:00Z`,status,by:'Mock channel simulator'}],demo:true,paid:0};
  state.reservations.push(r);guest.visitHistory.push(id);
  if(status==='Checked In')room.status='Occupied';
  const charges=['Cancelled','Pending'].includes(status)?[]:status==='No Show'?[{description:'Fictional no-show fee',quantity:1,rate:round(rate*.1),kind:'Fee'}]:[{description:'Room nights',quantity:nights(r),rate,kind:'Room'},{description:'Restaurant',quantity:1,rate:1200+n%4*300,kind:'Restaurant'},{description:n%2?'Laundry':'Spa',quantity:1,rate:n%2?850:3200,kind:n%2?'Laundry':'Spa'},{description:'Airport transfer',quantity:1,rate:1500,kind:'Service'}];
  const folio={id:`${prefix}-F-${n+1}`,reservationId:id,guestId:guest.id,charges,discount:charges.length&&n%5===0?1000:0,currency:'INR',simulated:true};state.folios.push(folio);
  const gross=round(Math.max(0,charges.reduce((s,c)=>s+c.quantity*c.rate,0)-folio.discount)*1.12);
  const receipt=status==='Checked Out'?gross:['Pending','No Show'].includes(status)?0:status==='Cancelled'?rate:round(gross*(n%3===0?1:.5));
  if(receipt)state.payments.push({id:`${prefix}-PAY-${n+1}`,reservationId:id,amount:receipt,type:'Payment',method:n%2?'Simulated UPI':'Simulated cash',status:'Simulated',reference:`DEMO-RECEIPT-${n+1}`,paidAt:`${arrival}T09:00:00Z`,simulated:true});
  if(status==='Cancelled')state.payments.push({id:`${prefix}-REF-${n+1}`,reservationId:id,amount:receipt,type:'Refund',method:'Simulated reversal',status:'Simulated',reference:`DEMO-REFUND-${n+1}`,paidAt:`${day(-1)}T09:00:00Z`,simulated:true});
  if(status!=='Pending')state.invoices.push({id:`${prefix}-INV-${n+1}`,number:`DEMO-${index+1}-${String(n+1).padStart(4,'0')}`,reservationId:id,guestId:guest.id,issueDate:arrival,dueDate:departure,room:room.number,notes:DISCLAIMER,simulated:true,hotelSnapshot:{hotelName:name,address:state.property.address,email:state.property.email}});
 }
 state.roomBlocks=[{id:`${prefix}-BLOCK-1`,room:state.rooms.at(-1).number,arrival:START,departure:day(4),kind:'Maintenance',reason:'Fictional air-conditioning inspection'},{id:`${prefix}-BLOCK-2`,room:state.rooms.at(-2).number,arrival:START,departure:day(6),kind:'Inventory block',reason:'Demo group allotment'}];
 state.rooms.at(-1).status='Maintenance';
 for(const [n,room]of state.rooms.entries())state.housekeeping.push({id:`${prefix}-HK-${room.number}`,room:room.number,status:room.housekeepingStatus,occupancy:room.status,assignedTo:staff.find(s=>s.demoRole==='Housekeeping Staff')?.name||'Demo Housekeeping',priority:n%7?'Normal':'High',completedAt:room.housekeepingStatus==='Dirty'?null:`${START}T05:30:00Z`,maintenance:room.status==='Maintenance'});
 for(let n=0;n<8;n++){const r=state.reservations[n];state.requests.push({id:`${prefix}-REQ-${n+1}`,guestId:r.guestId,reservationId:r.id,text:['Extra towels','Fictional airport transfer request','Late departure request','Restaurant booking enquiry'][n%4],status:n%3?'Open':'Resolved',created:`${START}T04:30:00Z`});state.tasks.push({id:`${prefix}-TASK-${n+1}`,title:'Follow up '+state.requests.at(-1).text,reservationId:r.id,dueDate:day(n%3-1),priority:n%2?'Normal':'High',status:n%3?'Open':'Complete',assignedTo:'Demo Front Desk'});}
 state.roomChanges.push({id:`${prefix}-MOVE-1`,reservationId:state.reservations[1].id,fromRoom:state.rooms.at(-3).number,toRoom:state.reservations[1].room,at:`${day(-1)}T09:00:00Z`,reason:'Fictional guest preference'});
 for(const [c,provider]of providers.entries()){
  state.channelManager.channels.push({id:`${prefix}-CH-${c+1}`,provider,propertyCode:`MOCK-${code}`,status:'Simulated — no live connection',simulated:true,connected:false,pricingMultiplier:1+c*.02,inventoryAllocation:state.rooms.length,restrictions:{minStay:1,stopSell:false},mappings:state.roomTypes.map(t=>({type:t.name,roomTypeId:t.id,externalCode:`MOCK-${c}-${t.id}`})),rateMappings:state.ratePlans.map(p=>({ratePlanId:p.id,externalCode:`MOCK-${c}-${p.code}`})),lastSync:`${START}T10:00:00Z`});
  for(const [s,action]of ['New OTA reservation','Reservation modification','Reservation cancellation','Inventory reduction','Inventory restoration','Rate update','Stop-sell update','Failed synchronization','Retry synchronization'].entries())state.channelManager.syncEvents.push({id:`${prefix}-SYNC-${c}-${s}`,channel:provider,action,status:s===7?'Failed':'Simulated success',at:`${START}T${String(5+Math.floor(s/6)).padStart(2,'0')}:${String((s*6)%60).padStart(2,'0')}:00Z`,error:s===7?'Injected demo timeout':null,retryOf:s===8?`${prefix}-SYNC-${c}-7`:null,simulated:true,details:'Fictional local scenario; no external request.'});
 }
 state.properties=[state.property];financials(state);inventory(state);return state;
}
module.exports={START,SEED,DISCLAIMER,hotels,providers,roles,day,active,includesDay,nights,financials,inventory,generateHotel};
