function provider(connectionString){try{const host=new URL(connectionString).hostname;return /(^|\.)supabase\.(com|co)$/.test(host)?'supabase':'postgresql';}catch{return 'unconfigured';}}
async function health(db,connectionString){
 const result=await db.query("SELECT to_regclass('public.friday_demo_workspace') IS NOT NULL AS workspace_ready,to_regclass('public.friday_credentials') IS NOT NULL AS credentials_ready,to_regclass('public.friday_sessions') IS NOT NULL AS sessions_ready");
 const row=result.rows[0]||{};
 return {provider:provider(connectionString),connected:true,ready:Boolean(row.workspace_ready&&row.credentials_ready&&row.sessions_ready)};
}
function handler(db,connectionString){return async(_req,res)=>{res.setHeader('Cache-Control','no-store');try{const storage=await health(db,connectionString);res.status(storage.ready?200:503).json({success:storage.ready,message:storage.ready?'Friday API and storage are ready.':'Friday storage setup is incomplete.',storage});}catch{res.status(503).json({success:false,message:'Friday storage is unavailable.',storage:{provider:provider(connectionString),connected:false,ready:false}});}};}
module.exports={provider,health,handler};
