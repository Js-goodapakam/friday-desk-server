// Adapter contract for the new tenant structures. It is intentionally not wired
// into legacy routes before additive schema/identity provisioning is reviewed.
// Pass the command's transaction client so access and the mutation share a unit
// of work; mutation handlers must hold the organisation access-version lock.
function accessRepository(client){
 const query=(sql,args)=>client.query(sql,args).then(r=>r.rows);
 const parse=(value,fallback)=>{if(value==null)return fallback;const result=typeof value==='string'?JSON.parse(value):value;if(!result||typeof result!=='object')throw Error('Invalid access configuration.');return result;};
 async function load(userId,resource){
  if(!Number.isSafeInteger(Number(userId))||Number(userId)<1||typeof resource?.organizationId!=='string')throw Error('Invalid access context.');
  const organizationId=resource.organizationId;
  const [principal]=await query('SELECT id,"isActive" AS active FROM "user" WHERE id=$1',[userId]);
  if(!principal||![true,1].includes(principal.active))return {principal:{id:userId,authenticated:false,active:false}};
  const memberships=await query('SELECT user_id AS "userId",organization_id AS "organizationId",active FROM engage_membership WHERE user_id=$1 AND organization_id=$2',[userId,organizationId]);
  // Stop before loading another tenant's roles, plan, properties or overrides.
  if(!memberships.some(m=>[true,1].includes(m.active)))return {principal:{...principal,authenticated:true,active:true},memberships:[]};
  const organizations=await query('SELECT id,active FROM engage_organization WHERE id=$1',[organizationId]);
  const properties=await query('SELECT property_id AS id,organization_id AS "organizationId",active FROM engage_property_access WHERE organization_id=$1 AND user_id=$2',[organizationId,userId]);
  const assignments=await query('SELECT user_id AS "userId",organization_id AS "organizationId",property_id AS "propertyId",scope,role_key AS role,active,expires_at AS "expiresAt" FROM engage_role_assignment WHERE organization_id=$1 AND user_id=$2',[organizationId,userId]);
  const customRoles=await query('SELECT role_key AS key,organization_id AS "organizationId",active,features_json AS features FROM engage_custom_role WHERE organization_id=$1',[organizationId]);
  const overrides=await query('SELECT user_id AS "userId",organization_id AS "organizationId",property_id AS "propertyId",scope,feature_key AS feature,actions_json AS actions,effect,active,expires_at AS "expiresAt" FROM engage_permission_override WHERE organization_id=$1 AND user_id=$2',[organizationId,userId]);
  const subscriptions=await query('SELECT organization_id AS "organizationId",plan,status,starts_at AS "startsAt",ends_at AS "endsAt",entitlements_json AS entitlements FROM engage_subscription WHERE organization_id=$1',[organizationId]);
  const normalize=rows=>rows.map(r=>({...r,active:[true,1].includes(r.active)}));
  return {principal:{...principal,active:true,authenticated:true},organizations:normalize(organizations),memberships:normalize(memberships),properties:normalize(properties),assignments:normalize(assignments),customRoles:normalize(customRoles).map(r=>({...r,features:parse(r.features,{})})),overrides:normalize(overrides).map(r=>({...r,actions:parse(r.actions,[])})),subscriptions:subscriptions.map(r=>({...r,entitlements:parse(r.entitlements,{})}))};
 }
 return {load};
}
module.exports={accessRepository};
