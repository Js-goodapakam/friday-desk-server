const {features}=require('./access-matrix');
const registry=new Map(features.map(f=>[f.key,f]));
const actions=Object.freeze(['view','create','update','delete','approve','export','configure','assign','manage_users','manage_integrations','manage_members']);
const labelActions=Object.freeze({
 'Full Access':actions.filter(a=>a!=='approve'),
 'Create & Edit':['view','create','update'],
 'View Only':['view'],
 'Approval Access':['approve'],
 'Restricted Access':[],
 'No Access':[],
});
const deny=reason=>({allowed:false,reason});
const same=(a,b)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&String(a)===String(b);
const live=(row,now)=>row?.active===true&&(!row.expiresAt||Number.isFinite(Date.parse(row.expiresAt))&&Date.parse(row.expiresAt)>now);

// `snapshot` is server-loaded, never request JSON/JWT user_metadata. The caller
// must reload it for each protected operation; no user/role decision cache.
function authorize(snapshot,request,now=Date.now()){
 if(!Number.isFinite(now))return deny('invalid_clock');
 const {principal,organizations=[],memberships=[],properties=[],assignments=[],customRoles=[],overrides=[],subscriptions=[]}=snapshot||{};
 const {organizationId,propertyId,feature,action}=request||{};
 if(!principal||principal.authenticated!==true||!live(principal,now))return deny('authentication_required');
 const definition=registry.get(feature);
 if(!definition||!actions.includes(action))return deny('unknown_permission');
 if(!organizations.some(o=>same(o.id,organizationId)&&live(o,now)))return deny('organization_unavailable');
 if(!memberships.some(m=>same(m.userId,principal.id)&&same(m.organizationId,organizationId)&&live(m,now)))return deny('organization_membership_required');
 if(propertyId!==undefined&&propertyId!==null){
  if(!properties.some(p=>same(p.id,propertyId)&&same(p.organizationId,organizationId)&&live(p,now)))return deny('property_access_denied');
  if(!assignments.some(a=>a.scope==='property'&&same(a.userId,principal.id)&&same(a.organizationId,organizationId)&&same(a.propertyId,propertyId)&&live(a,now)))return deny('property_assignment_required');
 }
 const applicable=row=>same(row.userId,principal.id)&&same(row.organizationId,organizationId)&&live(row,now)&&(row.scope==='organization'&&row.propertyId==null||row.scope==='property'&&propertyId!=null&&same(row.propertyId,propertyId));
 const relevant=overrides.filter(o=>applicable(o)&&o.feature===feature&&Array.isArray(o.actions)&&o.actions.includes(action));
 if(relevant.some(o=>o.effect==='deny'))return deny('explicit_deny');
 const roles=assignments.filter(applicable);
 let granted=relevant.some(o=>o.effect==='allow');
 let restricted=false;
 for(const assignment of roles){
  if(assignment.role==='platform_administrator')continue;
  const custom=String(assignment.role).startsWith('custom:')?customRoles.find(r=>r.key===assignment.role&&same(r.organizationId,organizationId)&&live(r,now)):null;
  const label=custom?custom.features?.[feature]:definition.labels[assignment.role];
  if(label==='Restricted Access')restricted=true;
  if(Object.hasOwn(labelActions,label)&&labelActions[label].includes(action))granted=true;
 }
 if(!granted)return deny(restricted?'restricted_policy_required':'role_permission_required');
 const subscription=subscriptions.find(s=>same(s.organizationId,organizationId));
 if(!subscription||!['active','trial'].includes(subscription.status))return deny('subscription_inactive');
 if(!['basic','premium','enterprise'].includes(subscription.plan))return deny('subscription_unconfigured');
 if(!subscription.startsAt||!Number.isFinite(Date.parse(subscription.startsAt))||Date.parse(subscription.startsAt)>now)return deny('subscription_not_started');
 if(!subscription.endsAt||!Number.isFinite(Date.parse(subscription.endsAt))||Date.parse(subscription.endsAt)<=now)return deny('subscription_expired');
 if(definition.entitlement==='internal_chat'&&!['premium','enterprise'].includes(subscription.plan))return deny('upgrade_required');
 if(subscription.entitlements?.[definition.entitlement]!==true)return deny('entitlement_required');
 // Row-level visibility (e.g. private DMs, self-only settings) is mandatory
 // separately. Full feature access is never an object membership bypass.
 if(request.resourceAllowed!==true)return deny('resource_policy_required');
 return {allowed:true,reason:'allowed'};
}

function canDelegate(snapshot,request,nextLabel,now){
 if(!Object.hasOwn(labelActions,nextLabel))return false;
 // Restricted policies must be explicitly authored, not selected as a shortcut.
 if(nextLabel==='Restricted Access')return false;
 return labelActions[nextLabel].every(action=>authorize(snapshot,{...request,action},now).allowed);
}

function createAccessGuard(loadSnapshot,resolveResource){
 if(typeof loadSnapshot!=='function'||typeof resolveResource!=='function')throw Error('Server access resolvers are required.');
 return featureAction=>(async(req,res,next)=>{
  try{
   if(!req.user?.id)return res.status(401).json({error:'Sign in to continue.'});
   // Resolver validates route IDs and obtains their organisation from storage.
   // Neither tenant IDs, roles nor entitlements are taken from request.body.
   const resource=await resolveResource(req);
   const snapshot=await loadSnapshot(req.user.id,resource);
   const result=authorize(snapshot,{...resource,...featureAction});
   if(!result.allowed)return res.status(403).json({error:'Access is not available for this action.',reason:result.reason});
   req.access={...resource,...featureAction};return next();
  }catch{return res.status(503).json({error:'Access could not be verified. Please retry.'});}
 });
}

module.exports={authorize,canDelegate,createAccessGuard,actions,labelActions};
