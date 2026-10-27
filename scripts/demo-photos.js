// Explicitly licensed Wikimedia photographs only. No official-site scraping.
if(!process.argv.includes('--local')||process.env.NODE_ENV==='production')throw Error('Use --local in development.');
process.env.FRIDAY_LOCAL_DEV='1';
const fs=require('node:fs'),path=require('node:path');
const db=require('../src/local-db'),store=require('../src/demo-store');
const sharp=require(require.resolve('sharp',{paths:[process.env.FRIDAY_IMAGE_MODULES||'C:/Users/CMI_10154/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules']}));
const sources=[
 {code:'TAJ-MUM-001',file:'Taj Mahal Palace Hotel.jpg',author:'Joe Ravi',license:'CC BY-SA 3.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/'},
 {code:'TAJ-BLR-002',file:'Heritage Block, the Taj West End, Bangalore.jpg',author:'Taj Hotels, Resorts and Palaces',license:'CC BY-SA 3.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/3.0/'},
 {code:'TAJ-UDR-003',file:'Taj Lake Palace Udaipur from City Palace.jpg',author:'Navneet Sharma',license:'CC BY-SA 4.0',licenseUrl:'https://creativecommons.org/licenses/by-sa/4.0/'}
];
const target=path.resolve(__dirname,'../../Client/public/demo-hotels');
async function request(url){const result=await fetch(url,{headers:{'User-Agent':'FridayHospitalityLocalDemo/1.0 (licensed media attribution research)'},signal:AbortSignal.timeout(30000)});if(!result.ok)throw Error(`HTTP ${result.status} for ${url}`);return result;}
(async()=>{try{
 store.assertLocal(db);fs.mkdirSync(target,{recursive:true});
 const manifest=[];
 for(const source of sources){
  const priorRow=(await db.query("SELECT id FROM property WHERE code=$1",[source.code])).rows[0];const prior=priorRow?await store.read(db,priorRow.id):null;
  if(prior?.state.property.cover?.sourceUrl&&fs.existsSync(path.join(target,source.code+"-1280.webp"))){manifest.push({code:source.code,...prior.state.property.cover});continue;}
  const sourceUrl='https://commons.wikimedia.org/wiki/File:'+encodeURIComponent(source.file.replaceAll(' ','_'));
  const api='https://commons.wikimedia.org/w/api.php?'+new URLSearchParams({action:'query',format:'json',prop:'imageinfo',iiprop:'url|extmetadata',titles:'File:'+source.file});
  let metadata;
  try{const info=await(await request(api)).json();metadata=Object.values(info.query.pages)[0].imageinfo[0];}catch(error){console.log(source.code+' photo pending: '+error.message);continue;}
  const license=metadata.extmetadata?.LicenseShortName?.value||'';
  if(license!==source.license)throw Error('Unexpected license for '+source.file+': '+license);
  const download=new URL(metadata.url);download.search="";const image=Buffer.from(await(await request(download.href)).arrayBuffer());
  if(image.length>18000000)throw Error('Image too large');
  for(const width of [640,1280])await sharp(image).rotate().resize({width,withoutEnlargement:true}).webp({quality:84}).toFile(path.join(target,`${source.code}-${width}.webp`));
  const cover={url:`/demo-hotels/${source.code}-1280.webp`,smallUrl:`/demo-hotels/${source.code}-640.webp`,sourceUrl,author:source.author,license:source.license,licenseUrl:source.licenseUrl,licenseStatus:'Verified Commons licence',changes:'Resized and converted to WebP; displayed in a 16:9 card with object-fit cover.',alt:source.file};
  const row=(await db.query('SELECT id FROM property WHERE code=$1',[source.code])).rows[0];if(!row)throw Error('Seed demo properties first.');
  const current=await store.read(db,row.id);current.state.property.cover=cover;await store.save(db,row.id,current.state,current.version,1);manifest.push({code:source.code,...cover});
 }
 for(const code of ['TAJ-GOA-004','TAJ-MAA-005'])manifest.push({code,status:'Pending: no suitable exterior photograph with verified reuse permission found.',sourceUrl:code==='TAJ-GOA-004'?'https://www.tajhotels.com/en-in/hotels/taj-exotica-goa/gallery':'https://www.tajhotels.com/en-in/hotels/taj-coromandel-chennai/gallery',licenseStatus:'Permission required; not downloaded'});
 fs.writeFileSync(path.join(target,'attribution.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify(manifest,null,2));
}catch(error){console.error(error.message);process.exitCode=1;}finally{await db.closeDatabase();}})();
