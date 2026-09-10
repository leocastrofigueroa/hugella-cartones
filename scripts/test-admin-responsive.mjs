// Static rendering of the real components with local fixtures; no app server,
// auth session, Supabase calls, or financial writes. Chrome runs headless.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('..', import.meta.url));
const localRequire = createRequire(path.join(root, 'package.json'));
const testRequire = createRequire(path.join(process.env.HUGELLA_TEST_DEPS, 'runner.cjs'));
const { chromium, webkit } = testRequire('playwright');
const ts = localRequire('typescript');
const React = localRequire('react');
const { renderToStaticMarkup } = localRequire('react-dom/server');
const postcss = localRequire('postcss');
const tailwind = localRequire('@tailwindcss/postcss');
const credit = { credito_id:'local', nombre_cliente:'Cliente de prueba ' + 'NombreLargo'.repeat(12), codigo_credito:'HG-'+'1234567890'.repeat(15), producto:'EquipamientoComercial'.repeat(12), importe_cuota:5000, cantidad_cuotas:120, cuotas_pagadas:23, cuotas_pendientes:97, estado:'ADELANTADO' };
function render(before, selected=true) {
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    let sourcePath=filename;
    if (before && filename.startsWith(path.join(root,'app/admin/'))) {
      const old=path.join(before,path.basename(filename)); if(fs.existsSync(old)) sourcePath=old;
    }
    const compiledModule={exports:{}}; cache.set(filename,compiledModule.exports);
    const compiled=ts.transpileModule(fs.readFileSync(sourcePath,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    let index=0;
    const state=['', [credit], selected?credit:null, 'done', false,false,'','','','',0];
    vm.runInNewContext(compiled,{module:compiledModule,exports:compiledModule.exports,require:name=>{
      if(name==='react' && filename.endsWith('/admin-dashboard.tsx'))return {...React,useState:()=>[state[index++],()=>{}],useRef:()=>({current:false})};
      if(name==='next/navigation')return {useRouter:()=>({})};
      if(name==='next/image')return {__esModule:true,default:props=>React.createElement('img',{...props,priority:undefined,src:'data:image/png;base64,'+fs.readFileSync(path.join(root,'public/hugella-logo.png')).toString('base64')})};
      if(name==='@/utils/supabase/client')return {createClient:()=>{throw Error('Remote calls forbidden in layout test');}};
      if(name.endsWith('.module.css'))return {__esModule:true,default:{root:'admin-test-root'}};
      if(name.startsWith('.')){
        let file=path.resolve(path.dirname(filename),name);
        file+=fs.existsSync(file+'.tsx')?'.tsx':'.ts';return load(file);
      }
      return localRequire(name);
    }});
    cache.set(filename,compiledModule.exports);return compiledModule.exports;
  }
  return renderToStaticMarkup(React.createElement(load(path.join(root,'app/admin/admin-dashboard.tsx')).default,{email:'long-email'.repeat(20)+'@example.test'}));
}
(async()=>{
  let css=fs.readFileSync(path.join(root,'app/globals.css'),'utf8');
  if(process.env.HUGELLA_BEFORE)css+='\n@source "'+process.env.HUGELLA_BEFORE+'";';
  const result=await postcss([tailwind({base:root})]).process(css,{from:path.join(root,'app/globals.css')});
  const scoped=fs.readFileSync(path.join(root,'app/admin/admin.module.css'),'utf8').replaceAll('.root','.admin-test-root');
  const browser=await (process.env.HUGELLA_ENGINE === 'webkit' ? webkit.launch({headless:true}) : chromium.launch({executablePath:process.env.HUGELLA_CHROME||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true}));
  try {
    const page=await browser.newPage();
    for(const before of process.env.HUGELLA_BEFORE?[process.env.HUGELLA_BEFORE,null]:[null]){
      for(const width of [320,375,390,430,768,1024,1280]){
        await page.setViewportSize({width,height:1000});
        await page.setContent('<!doctype html><html lang="es"><meta name="viewport" content="width=device-width, initial-scale=1"><style>'+result.css+(before?'':scoped)+'</style><body class="min-h-full flex flex-col">'+render(before)+'</body></html>');
        const metrics=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,overflow:[...document.querySelectorAll('body *')].filter(e=>{const r=e.getBoundingClientRect();return r.width>0&&(r.right>innerWidth+1||r.left< -1)}).slice(0,12).map(e=>({tag:e.tagName,id:e.id,class:e.className,width:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right}))}));
        console.log(before?'BEFORE':'AFTER',width,JSON.stringify(metrics));
        if(!before) {
          assert(metrics.scroll<=width,`Horizontal overflow at ${width}px`);
          const headerLayout=await page.locator('header[aria-label="Cuenta de administración"]').evaluate(header=>{
            const logo=header.querySelector('img').getBoundingClientRect();
            const button=header.querySelector('button').getBoundingClientRect();
            return {logo:{left:logo.left,right:logo.right,top:logo.top,bottom:logo.bottom,width:logo.width,height:logo.height},button:{left:button.left,right:button.right,top:button.top,bottom:button.bottom}};
          });
          assert(headerLayout.logo.left>=0 && headerLayout.logo.right<=width);
          assert(headerLayout.button.left>=0 && headerLayout.button.right<=width);
          assert(Math.abs(headerLayout.logo.width/headerLayout.logo.height-3)<0.05,'Logo aspect ratio must be preserved');
          if(width>=1024){
            assert(headerLayout.logo.right<headerLayout.button.left,'Desktop logo left, logout right');
            assert(headerLayout.logo.top<headerLayout.button.bottom && headerLayout.button.top<headerLayout.logo.bottom,'Desktop header must stay on one row');
          }
          const controlHeights=await page.locator('input, select, textarea, button').evaluateAll(elements=>elements.map(e=>e.getBoundingClientRect().height));
          assert(controlHeights.every(height=>height>=44),`Small touch control at ${width}px: ${controlHeights}`);
        }
        if(!before && width===320)await page.screenshot({path:'/private/tmp/hugella-admin-320.png',fullPage:true});
      }
    }
    console.log('PASS: selected credit, long text/code/email and payment form, 320–1280px without page overflow.');
  } finally {await browser.close();}
})();
