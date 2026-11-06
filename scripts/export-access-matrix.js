const fs=require('node:fs'),path=require('node:path'),{modules,features,roles}=require('../src/access-matrix');
const directory=path.resolve(__dirname,'../docs/engagestay');fs.mkdirSync(directory,{recursive:true});
const cell=value=>'"'+String(value).replaceAll('"','""')+'"';
const rows=[['Module','Feature','Permission key',...roles.map(r=>r[1])],...features.map(f=>[modules.find(m=>m.key===f.module).name,f.name,f.key,...roles.map(([key])=>f.labels[key])])];
fs.writeFileSync(path.join(directory,'APPROVED-MATRIX.csv'),'\ufeff'+rows.map(row=>row.map(cell).join(',')).join('\r\n'));
fs.writeFileSync(path.join(directory,'permission-catalogue.json'),JSON.stringify({version:1,source:'Customer matrix supplied 6 November 2026',modules,roles,features},null,2)+'\n');
console.log(`${features.length} feature definitions exported. No database was opened.`);
