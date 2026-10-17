import { createServer } from 'node:http';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { fileURLToPath,pathToFileURL } from 'node:url';
import path from 'node:path';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const directory=path.dirname(fileURLToPath(import.meta.url));
const docs=path.resolve(directory,'../../../..');
const argument=name=>{const at=process.argv.indexOf(`--${name}`);if(at<0||!process.argv[at+1])throw new Error(`--${name} is required`);return process.argv[at+1];};
const {chromium}=await import(pathToFileURL(argument('playwright')).href);
const scenes=['login','mfa','enrollment','recovery-code','password','zero','spaces','directory','create','join','applications','approval','create-approval','members','role-edit','space-info','owner-transfer','delete-space','interventions','all-spaces','accounts','account-create','account-recovery','admins','programs','security','account-menu','reauth','change-password','denied','secret-unavailable','expired','uninitialized','recovering','disabled','errors','review-role','admin-intervene','resources'];
const matrix=scenes.map((scene,i)=>({id:String(i+1).padStart(2,'0'),scene,theme:'light',viewport:{width:1440,height:900}}));
for(const scene of ['login','approval','members','accounts','expired'])matrix.push({id:String(scenes.indexOf(scene)+1).padStart(2,'0'),scene,theme:'dark',viewport:{width:1440,height:900}});
matrix.push({id:'14',scene:'members',theme:'light',viewport:{width:2560,height:1440}},{id:'01',scene:'login',theme:'light',viewport:{width:1280,height:800}},{id:'12',scene:'approval',theme:'light',viewport:{width:1280,height:800}});
const server=createServer(async(req,res)=>{
 try{
  const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
  const filename=path.resolve(docs,'.'+pathname);
  if(!filename.startsWith(docs+path.sep))throw new Error('Outside docs');
  const bytes=await readFile(filename);const mime={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.png':'image/png'}[path.extname(filename)]??'application/octet-stream';
  res.writeHead(200,{'content-type':mime,'cache-control':'no-store'});res.end(bytes);
 }catch{res.writeHead(404);res.end('Not found');}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/design/F008-unified-login-space-permissions/ux-v1.0/assets/index.html`;
let browser;const checks=[],captures=[],pageErrors=[];
try{
 browser=await chromium.launch({executablePath:argument('browser'),headless:true});
 const context=await browser.newContext({deviceScaleFactor:1,locale:'zh-CN',reducedMotion:'reduce'}),page=await context.newPage();
 page.on('pageerror',e=>pageErrors.push(String(e)));
 await mkdir(path.join(directory,'previews'),{recursive:true});
 for(const item of matrix){
  await page.setViewportSize(item.viewport);
  await page.goto(base+'?'+new URLSearchParams({scene:item.scene,theme:item.theme,capture:'1'}));
  await page.evaluate(()=>document.fonts.ready);
  const geometry=await page.evaluate(()=>{
   const app=document.querySelector('#app'),scale=Number(app.dataset.scale),bounds=app.getBoundingClientRect(),side=document.querySelector('.sidebar'),main=document.querySelector('main'),heading=document.querySelector('main h1'),dialog=document.querySelector('.design-dialog');
   const normalized=el=>{if(!el)return null;const r=el.getBoundingClientRect();return {x:(r.x-bounds.x)/scale,y:(r.y-bounds.y)/scale,width:r.width/scale,height:r.height/scale};};
   const issues=[...document.querySelectorAll('.auth-card,.detail,.page-head,.design-dialog')].filter(el=>el.scrollWidth>el.clientWidth+3).map(el=>({class:el.className,client:el.clientWidth,scroll:el.scrollWidth}));
   return {scale,canvas:{width:app.offsetWidth,height:app.offsetHeight},sidebar:normalized(side),main:normalized(main),heading:normalized(heading),dialog:normalized(dialog),h1:document.querySelectorAll('h1').length,overflow:issues,hasDesignLabel:document.body.textContent.includes('设计样稿'),theme:document.documentElement.dataset.theme};
  });
  assert.equal(geometry.h1,1,`${item.scene} has one page h1`);
  assert.equal(geometry.theme,item.theme);
  assert.equal(geometry.hasDesignLabel,true);
  assert.deepEqual(geometry.overflow,[],`${item.scene} content stays in its surface`);
  if(geometry.sidebar)assert.ok(Math.abs(geometry.sidebar.width-224)<0.01);
  const suffix=item.viewport.width===1440?'':`-${item.viewport.width}`;
  const file=`${item.id}-${item.scene}-${item.theme}${suffix}.png`;
  await page.screenshot({path:path.join(directory,'previews',file),fullPage:false});
  const bytes=await readFile(path.join(directory,'previews',file));
  captures.push({...item,file,logicalCanvas:geometry.canvas,scale:geometry.scale,browserZoom:1,deviceScaleFactor:1,sha256:createHash('sha256').update(bytes).digest('hex'),geometry});
  checks.push({scene:item.scene,theme:item.theme,viewport:item.viewport,check:'single-heading/theme/fixture-label/no-surface-overflow/sidebar-width',pass:true});
 }
 const regular=captures.find(c=>c.scene==='members'&&c.viewport.width===1440&&c.theme==='light');
 const large=captures.find(c=>c.scene==='members'&&c.viewport.width===2560);
 for(const key of ['sidebar','main','heading'])for(const axis of ['x','y','width','height'])assert.ok(Math.abs(regular.geometry[key][axis]-large.geometry[key][axis])<0.15,`normalized ${key}.${axis}`);
 checks.push({check:'members normalized layout 1440 / 2560 identical',pass:true});
 await page.setViewportSize({width:1440,height:900});
 await page.goto(base+'?scene=login&theme=light&capture=1');
 await page.locator('#username').fill('DESIGN-SENTINEL-ACCOUNT');
 await page.getByRole('link',{name:'切换到石墨深色',exact:true}).click();
 assert.equal(await page.locator('#username').inputValue(),'DESIGN-SENTINEL-ACCOUNT');
 assert.equal(await page.locator('html').getAttribute('data-theme'),'dark');
 checks.push({check:'theme switch preserves unsent form input in the same document',pass:true});
 assert.equal(pageErrors.length,0);
 const sourceFiles={};for(const relative of ['index.html','style.css','app.js','render.mjs','../../../../design-reviews/F005/business-workbench-v0.1/assets/style.css'])sourceFiles[relative]=createHash('sha256').update(await readFile(path.resolve(directory,relative))).digest('hex');
 const output={feature:'F008',kind:'design-fixture-rendering',generatedAt:new Date().toISOString(),baseCommit:'c04cf83d5747e011b5c0af1528d3cc334bb3d937',layoutBaseline:'F005 V1.1',browser:browser.version(),sourceFiles,fixtureBoundary:'Static design scenes. No authentication, permissions, approvals or backend execution is verified.',captures,checks,pageErrors};
 await writeFile(path.join(directory,'verification.json'),JSON.stringify(output,null,2)+'\n');
 await writeFile(path.join(directory,'previews','SHA256SUMS'),captures.map(c=>`${c.sha256}  ${c.file}`).join('\n')+'\n');
 process.stdout.write(JSON.stringify({captures:captures.length,checks:checks.length,pageErrors:pageErrors.length})+'\n');
}finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
