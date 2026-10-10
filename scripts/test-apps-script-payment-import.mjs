// Offline only: executes the versioned Supabase.gs with synthetic payment rows.
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const source=readFileSync(new URL('../Supabase.gs',import.meta.url),'utf8');
let count=0;
function run({id='',admin=false,lost=false,fail=false}={}) {
 const rows=[['Fecha','ID Crédito','Importe cobrado','Medios de pago','Observaciones','ID PAGO'],[new Date('2026-10-10T12:00:00Z'),admin?'CR-0048':'CR-0001',100,'EFECTIVO','',id]];
 let locked=false,retired=false;const refs=[],remote=new Set();
 const sheet={getDataRange:()=>({getValues:()=>rows.map(r=>r.slice())}),getRange:(r,c)=>({setValue:v=>{rows[r-1][c-1]=v;}})};
 const ctx=vm.createContext({Date,JSON,Number,String,Error,Math,Set,Logger:{log(){}},
 SpreadsheetApp:{getActiveSpreadsheet:()=>({getSheetByName:n=>{assert.equal(n,'Registro de cobros');return sheet;}})},
 LockService:{getScriptLock:()=>({waitLock(){assert(!locked);locked=true;},releaseLock(){locked=false;}})},
 Session:{getScriptTimeZone:()=> 'America/Argentina/Mendoza'},Utilities:{formatDate:()=> '2026-10-10',sleep(){}},
 UrlFetchApp:{fetch(url,opts){assert(locked&&retired);assert(url.endsWith('/importar_pago_hugella'));const ref=JSON.parse(opts.payload).p_referencia_importacion;refs.push(ref);if(fail)throw Error('before HTTP');if(!admin)remote.add(ref);if(lost){lost=false;throw Error('response lost');}return {getResponseCode:()=>admin?403:200,getContentText:()=> 'fixture'};}}});
 vm.runInContext(source,ctx);ctx.procesarEventosRetirarSheets_=()=>{assert(locked);retired=true;};ctx.obtenerConexionSupabase_=()=>({url:'https://fixture.invalid',headers:{}});
 let error;try{ctx.sincronizarPagosSheetsASupabase();}catch(e){error=e;}
 assert(!locked);if(fail){assert(error);const saved=rows[1][5];fail=false;ctx.sincronizarPagosSheetsASupabase();assert.equal(rows[1][5],saved);}
 if(id.startsWith('ADM-'))assert.equal(refs.length,0);else {assert(refs.every(r=>r==='SHEETS-'+rows[1][5]));if(!admin)assert.equal(remote.size,1);else assert.equal(remote.size,0);}
 count++;
}
run();run({id:'PG-000005'});run({id:'ADM-FIXTURE'});run({fail:true});run({lost:true});run({admin:true});
console.log(`${count} payment import cases passed; offline only.`);
