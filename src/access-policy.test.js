const {test}=require('node:test'),assert=require('node:assert/strict');
const {authorize,canDelegate,createAccessGuard,labelActions}=require('./access-policy');
const {modules,features,roles}=require('./access-matrix');
const now=Date.parse('2026-11-06T06:00:00Z');
const request={organizationId:'hotel-a',propertyId:1,feature:'reservations.direct_reservations',action:'create',resourceAllowed:true};
const snapshot=()=>({principal:{id:1,authenticated:true,active:true},organizations:[{id:'hotel-a',active:true}],memberships:[{userId:1,organizationId:'hotel-a',active:true}],properties:[{id:1,organizationId:'hotel-a',active:true},{id:2,organizationId:'hotel-a',active:true}],assignments:[{userId:1,organizationId:'hotel-a',propertyId:1,scope:'property',role:'front_desk',active:true}],subscriptions:[{organizationId:'hotel-a',plan:'premium',status:'active',startsAt:'2026-11-01',endsAt:'2026-12-01',entitlements:{reservations:true,internal_chat:true}}]});
const check=(s=snapshot(),r=request)=>authorize(s,r,now);
test('matrix imports 311 unique features, 20 modules and the five specified roles',()=>{
 assert.equal(modules.length,20);assert.equal(features.length,311);assert.equal(new Set(features.map(f=>f.key)).size,311);assert.equal(roles.length,5);
 for(const f of features)assert.equal(Object.keys(f.labels).length,5);
 assert.equal(features.find(f=>f.key==='billing.refund_processing').labels.finance_manager,'Approval Access');
 assert.equal(features.find(f=>f.key==='internal_chat.group_owner_announcements').labels.super_admin,'Create & Edit');
});
test('assigned Front Desk can create a reservation with an active entitlement',()=>assert.equal(check().allowed,true));
test('default denial without authenticated identity, membership, property assignment or known permission',()=>{
 for(const mutate of [s=>s.principal.authenticated=false,s=>s.principal.active=false,s=>s.memberships=[],s=>s.organizations=[],s=>s.assignments=[],s=>s.properties[0].organizationId='hotel-b']){const s=snapshot();mutate(s);assert.equal(check(s).allowed,false);}
 assert.equal(check(snapshot(),{...request,feature:'made.up'}).reason,'unknown_permission');
 assert.equal(check(snapshot(),{...request,action:'invented'}).reason,'unknown_permission');
});
test('property role never applies to another property or organisation',()=>{
 assert.equal(check(snapshot(),{...request,propertyId:2}).allowed,false);
 assert.equal(check(snapshot(),{...request,organizationId:'hotel-b'}).allowed,false);
 assert.equal(check(snapshot(),{...request,propertyId:null}).allowed,false);
});
test('organisation role must be explicit and does not replace property assignment',()=>{
 const s=snapshot();s.assignments=[{userId:1,organizationId:'hotel-a',role:'property_owner',scope:'organization',active:true}];
 assert.equal(check(s,{...request,propertyId:null}).allowed,true);assert.equal(check(s).reason,'property_assignment_required');
});
test('restricted labels deny until an explicit approved scoped override exists',()=>{
 const r={...request,feature:'reservations.booking_modification',action:'update'};assert.equal(check(snapshot(),r).reason,'restricted_policy_required');
 const s=snapshot();s.overrides=[{userId:1,organizationId:'hotel-a',propertyId:1,scope:'property',feature:r.feature,actions:['update'],effect:'allow',active:true}];assert.equal(check(s,r).allowed,true);
 assert.equal(check(s,{...r,propertyId:2}).allowed,false);
});
test('deny overrides allow, including broader role grants',()=>{
 const s=snapshot();s.overrides=['allow','deny'].map(effect=>({userId:1,organizationId:'hotel-a',propertyId:1,scope:'property',feature:request.feature,actions:['create'],effect,active:true}));assert.equal(check(s).reason,'explicit_deny');
});
test('approval independently grants approve, never view/create/update',()=>{
 const s=snapshot();s.assignments[0].role='finance_manager';s.subscriptions[0].entitlements.billing=true;
 for(const action of ['create','update','view'])assert.equal(check(s,{...request,feature:'billing.refund_processing',action}).allowed,false);
 assert.equal(check(s,{...request,feature:'billing.refund_processing',action:'approve'}).allowed,true);
 assert.equal(labelActions['Full Access'].includes('approve'),false);
});
test('customer platform role and foreign custom roles confer no authority',()=>{
 const s=snapshot();s.assignments[0].role='platform_administrator';assert.equal(check(s).allowed,false);
 s.assignments[0].role='custom';s.customRoles=[{key:'custom',organizationId:'hotel-b',active:true,features:{[request.feature]:'Full Access'}}];assert.equal(check(s).allowed,false);
});
test('Basic cannot read or send Connect messages even with an explicit role grant',()=>{
 const r={...request,feature:'internal_chat.one_to_one_direct_messaging'};
 const s=snapshot();s.subscriptions[0].plan='basic';assert.equal(check(s,r).reason,'upgrade_required');
 s.subscriptions[0].plan='premium';assert.equal(check(s,r).allowed,true);s.subscriptions[0].plan='enterprise';assert.equal(check(s,r).allowed,true);
});
test('entitlements and role permissions are independently required',()=>{
 const s=snapshot();s.subscriptions[0].entitlements.reservations=false;assert.equal(check(s).reason,'entitlement_required');
 s.subscriptions[0].entitlements.revenue=true;assert.equal(check(s,{...request,feature:'revenue.dynamic_pricing_rules',action:'view'}).allowed,false);
});
test('suspension, downgrade and membership revocation take effect on next decision',()=>{
 const s=snapshot();assert.equal(check(s).allowed,true);s.memberships[0].active=false;assert.equal(check(s).allowed,false);
 s.memberships[0].active=true;for(const status of ['past_due','expired','cancelled','suspended','unconfigured']){s.subscriptions[0].status=status;assert.equal(check(s).reason,'subscription_inactive');}
});
test('subscription start/expiry and malformed dates fail closed',()=>{
 for(const [field,value]of [['startsAt','2027-01-01'],['endsAt','2026-11-06T06:00:00Z'],['endsAt','invalid'],['startsAt',null]]){const s=snapshot();s.subscriptions[0][field]=value;assert.equal(check(s).allowed,false);}
});
test('administrative feature grant does not bypass private object membership',()=>{
 const s=snapshot();s.assignments[0].role='property_owner';assert.equal(check(s,{...request,resourceAllowed:false}).reason,'resource_policy_required');
 assert.equal(check(s,{...request,resourceAllowed:undefined}).reason,'resource_policy_required');
});
test('scoped overrides expire and custom role cannot grant unknown action',()=>{
 const s=snapshot();s.overrides=[{userId:1,organizationId:'hotel-a',propertyId:1,scope:'property',feature:request.feature,actions:['approve'],effect:'allow',active:true,expiresAt:'2020-01-01'}];assert.equal(check(s,{...request,action:'approve'}).allowed,false);
});
test('delegation cannot exceed acting authority or invent restricted policies',()=>{
 assert.equal(canDelegate(snapshot(),request,'Full Access',now),false);assert.equal(canDelegate(snapshot(),request,'Approval Access',now),false);assert.equal(canDelegate(snapshot(),request,'Restricted Access',now),false);assert.equal(canDelegate(snapshot(),request,'Create & Edit',now),true);
});
test('guard resolves trusted resource, ignores body roles and reloads access each time',async()=>{
 const s=snapshot();let loads=0,next=0;const guard=createAccessGuard(async id=>{assert.equal(id,1);loads++;return s;},async()=>({organizationId:'hotel-a',propertyId:1,resourceAllowed:true}))({feature:request.feature,action:'create'});
 const req={user:{id:1},body:{role:'property_owner',organizationId:'hotel-b',entitlements:{reservations:true}}},res={status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
 await guard(req,res,()=>next++);assert.equal(next,1);s.memberships[0].active=false;await guard(req,res,()=>next++);assert.equal(next,1);assert.equal(res.code,403);assert.equal(loads,2);
});
test('guard fails closed on storage outages',async()=>{
 let next=false;const res={status(code){this.code=code;return this;},json(){return this;}};
 await createAccessGuard(async()=>{throw Error('database secret must not be returned');},async()=>({}))({feature:request.feature,action:'view'})({user:{id:1}},res,()=>next=true);assert.equal(res.code,503);assert.equal(next,false);
});
test('malformed action lists and truthy authentication values never grant access',()=>{
 const s=snapshot();s.principal.authenticated='yes';assert.equal(check(s).allowed,false);s.principal.authenticated=true;
 s.assignments[0].role='front_desk';s.overrides=[{userId:1,organizationId:'hotel-a',propertyId:1,scope:'property',feature:'reservations.booking_modification',actions:'not_update',effect:'allow',active:true}];
 assert.equal(check(s,{...request,feature:'reservations.booking_modification',action:'update'}).allowed,false);
});
test('custom roles cannot shadow the system owner and invalid labels deny safely',()=>{
 const s=snapshot();s.assignments[0].role='custom:desk';s.customRoles=[{key:'custom:desk',organizationId:'hotel-a',active:true,features:{[request.feature]:'toString'}}];assert.equal(check(s).allowed,false);
 s.assignments[0].role='front_desk';s.customRoles=[{key:'front_desk',organizationId:'hotel-a',active:true,features:{'revenue.dynamic_pricing_rules':'Full Access'}}];s.subscriptions[0].entitlements.revenue=true;assert.equal(check(s,{...request,feature:'revenue.dynamic_pricing_rules',action:'update'}).allowed,false);
});
