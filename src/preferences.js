const languages=new Set(['en','kn']);
function preferenceRoutes(db){
 async function get(req,res){try{const result=await db.query('SELECT preferred_language FROM "user" WHERE id=$1',[req.user.id]);if(!result.rows[0])return res.status(404).json({error:'User not found.'});res.setHeader('Cache-Control','no-store');res.json({preferred_language:languages.has(result.rows[0].preferred_language)?result.rows[0].preferred_language:'en'});}catch{res.status(503).json({error:'Language preferences unavailable. Check database migration.'});}}
 async function put(req,res){const body=req.body||{};if(Object.keys(body).some(k=>k!=='preferred_language')||!languages.has(body.preferred_language))return res.status(400).json({error:'Choose English or Kannada.'});try{const result=await db.query('UPDATE "user" SET preferred_language=$1 WHERE id=$2 RETURNING preferred_language',[body.preferred_language,req.user.id]);if(!result.rows[0])return res.status(404).json({error:'User not found.'});res.setHeader('Cache-Control','no-store');res.json({preferred_language:result.rows[0].preferred_language});}catch{res.status(503).json({error:'Language preference was not saved. Please try again.'});}}
 return {get,put};
}
module.exports={preferenceRoutes};
