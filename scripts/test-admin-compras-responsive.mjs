// Layout offline con componentes reales. Sin servidor, sesión ni llamadas Supabase.
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, mkdtempSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
const require=createRequire(import.meta.url);const React=require('react');const ts=require('typescript');
const {renderToStaticMarkup}=require('react-dom/server');const postcss=require('postcss');const tailwind=require('@tailwindcss/postcss');
const cache=new Map();
function load(file){file=path.resolve(file);if(cache.has(file))return cache.get(file);const mod={exports:{}};
vm.runInNewContext(ts.transpileModule(readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true,target:ts.ScriptTarget.ES2020}}).outputText,{module:mod,exports:mod.exports,require(name){
if(name==='next/link')return {__esModule:true,default:props=>React.createElement('a',props)};
if(name.startsWith('.')){const target=path.resolve(path.dirname(file),name);return load(target+(existsSync(target+'.ts')?'.ts':'.tsx'));}
return require(name);}});cache.set(file,mod.exports);return mod.exports;}
const Form=load('app/admin/compras/new-purchase-form.tsx').default;
const css=(await postcss([tailwind({base:process.cwd()})]).process(readFileSync('app/globals.css','utf8'),{from:path.resolve('app/globals.css')})).css+readFileSync('app/admin/admin.module.css','utf8').replaceAll('.root','.purchase-root');
const rendered=renderToStaticMarkup(React.createElement(Form));
const temp=mkdtempSync('/private/tmp/hugella-purchases-layout-');
const child=`<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><main class="purchase-root"><div class="mx-auto max-w-5xl px-5 py-8">${rendered}</div></main></body></html>`;
const widths=[320,375,390,430,768,1024,1280];
const html=`<!doctype html><html><body>${widths.map(w=>`<iframe data-width="${w}" style="width:${w}px;height:1200px;border:0" srcdoc="${child.replaceAll('&','&amp;').replaceAll('"','&quot;')}"></iframe>`).join('')}<output id="metrics"></output><script>window.addEventListener('load',()=>{document.getElementById('metrics').textContent=JSON.stringify([...document.querySelectorAll('iframe')].map(f=>({width:Number(f.dataset.width),scroll:f.contentDocument.documentElement.scrollWidth,inputs:[...f.contentDocument.querySelectorAll('input,select,button')].every(e=>e.getBoundingClientRect().height>=44)})));});</script></body></html>`;
writeFileSync(path.join(temp,'test.html'),html);
const output=await new Promise((resolve,reject)=>{
  const child=spawn('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',['--headless','--disable-gpu','--disable-background-networking','--disable-component-update','--disable-sync','--no-first-run','--no-default-browser-check',`--user-data-dir=${temp}/profile`,'--virtual-time-budget=1500','--dump-dom',`file://${temp}/test.html`],{stdio:['ignore','pipe','ignore']});
  let html='';
  const timeout=setTimeout(()=>{child.kill();reject(new Error('Chrome did not return layout metrics within 30 seconds'));},30000);
  child.stdout.on('data',data=>{
    html+=data.toString();
    if (/<output id="metrics">\[[^<]+\]<\/output>/.test(html)) {
      clearTimeout(timeout); child.kill(); resolve(html);
    }
  });
  child.on('error',error=>{clearTimeout(timeout);reject(error);});
  child.on('close',()=>{clearTimeout(timeout);if(!/<output id="metrics">\[[^<]+\]<\/output>/.test(html))reject(new Error('Chrome exited without layout metrics'));});
});
const match=output.match(/<output id="metrics">([^<]+)<\/output>/);assert.ok(match,'Chrome layout metrics missing');
for(const row of JSON.parse(match[1])){assert.ok(row.scroll<=row.width,`Overflow ${JSON.stringify(row)}`);assert.ok(row.inputs,`Touch targets ${row.width}`);console.log(`PASS: ${row.width}px no horizontal overflow, controls >=44px`);}
