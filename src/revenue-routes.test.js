const {test}=require('node:test'),assert=require('node:assert/strict'),{routes}=require('./demo-routes'),model=require('./demo-data'),engine=require('./revenue-engine');
function fixture(role='ADMIN',propertyId=1){
 const old=process.env.NODE_ENV;process.env.NODE_ENV='production';
 let state=model.generateHotel(0,1),version=1,writes=0;
 const db={query:async(sql)=>({rows:sql.includes('friday_property_access')?[]:[{code:model.hotels[0][0]}]})};
 const repo={read:async()=>({state,version}),save:async(_db,id,next,v,actor)=>{assert.equal(id,1);assert.equal(actor,9);assert.equal(v,version);state=require('./demo-store').validate(next);writes++;return {state,version:++version};}};
 const req={user:{id:9,role,propertyId},params:{id:'1'},body:{}},res={statusCode:200,status(n){this.statusCode=n;return this;},json(x){this.body=x;return this;}};
 const handler=routes(db,repo).revenue,from=engine.indiaToday();
 req.body={action:'preview',from,to:from,config:{rules:[{id:'x',name:'Occupancy',kind:'occupancy',roomTypeId:'all',min:0,max:100,adjustment:'percent',value:10,priority:1,enabled:true,from,to:from}],limits:state.roomTypes.map(t=>({roomTypeId:t.id,min:0,max:t.baseRate*2}))}};
 return {req,res,run:()=>handler(req,res),writes:()=>writes,restore:()=>{if(old===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=old;}};
}
test('pricing preview is read-only and uses current stored inventory',async()=>{const f=fixture();try{await f.run();assert.equal(f.res.statusCode,200);assert.equal(f.res.body.rows.length,4);assert.equal(f.writes(),0);}finally{f.restore();}});
test('pricing writes reject stale workspace versions',async()=>{const f=fixture();try{f.req.body.action='apply';f.req.body.version=0;await f.run();assert.equal(f.res.statusCode,409);assert.equal(f.writes(),0);}finally{f.restore();}});
test('non-revenue roles and cross-property access cannot apply rules',async()=>{for(const [role,id]of [['FRONT_DESK',1],['ADMIN',2]]){const f=fixture(role,id);try{await f.run();assert.equal(f.res.statusCode,403);assert.equal(f.writes(),0);}finally{f.restore();}}});
test('approved pricing application persists and increments the workspace version',async()=>{const f=fixture('REVENUE');try{f.req.body.action='apply';f.req.body.version=1;await f.run();assert.equal(f.res.statusCode,200);assert.equal(f.writes(),1);assert.equal(f.res.body.version,2);assert.ok(f.res.body.state.inventoryAudit.some(r=>r.source==='revenue-manager'));}finally{f.restore();}});
