const visibleKeys=new Set(['name','title','description','text','notes','disclaimer','terms','reason','status','method','reference','number','by','action','details','error','managerName','assignedTo','taxLabel','cancellationPolicy','cancellation','phone']);
function sampleText(text){return text.replace(/\bdemo(?=-)/gi,'SAMPLE').replace(/\bdemo\b/gi,'Sample data').replace(/LOCAL TEST DATA/gi,'SAMPLE DATA').replace(/LOCAL — NOT AFFILIATED WITH TAJ/gi,'SAMPLE DATA — NOT AFFILIATED WITH TAJ').replace(/demonstration/gi,'sample');}
function normalizeLabels(value,key=''){
 if(typeof value==='string')return visibleKeys.has(key)?sampleText(value):value;
 if(Array.isArray(value))return value.map(item=>normalizeLabels(item,key));
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,normalizeLabels(v,k)]));
 return value;
}
module.exports={normalizeLabels,sampleText};
