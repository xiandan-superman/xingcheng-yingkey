import {app,BrowserWindow} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAuthorizationServer} from '../server/server.mjs';
import {createEngine} from '../src/core/engine.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts','web-quality-'+Date.now());
await fs.mkdir(out,{recursive:true});
let server,win,player;const errors=[],checks=[];const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{try{
server=await createAuthorizationServer({dataDir:path.join(out,'server')});
const password=(await fs.readFile(path.join(out,'server','console-login.txt'),'utf8')).match(/初始密码：(.+)/)[1];
win=new BrowserWindow({width:1440,height:1100,show:false,webPreferences:{backgroundThrottling:false,sandbox:true,nodeIntegration:false,contextIsolation:true,partition:'web-quality-'+Date.now()}});
win.webContents.on('console-message',(_e,level,message)=>{if(level>=3)errors.push(message);});
win.webContents.on('render-process-gone',(_e,detail)=>errors.push(detail.reason));
const run=code=>win.webContents.executeJavaScript(code);const wait=async code=>{for(let i=0;i<200;i++){if(await run(code))return;await delay(50);}throw Error('UI timeout '+code);};
await win.loadURL('http://127.0.0.1:'+server.port);await wait('typeof busy!=="undefined"&&!busy');
for(const width of [1440,1024,800,390]){win.setContentSize(width,1000);await delay(100);assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true,'Login overflow '+width);await fs.writeFile(path.join(out,`${width}-login.png`),(await win.webContents.capturePage()).toPNG());}
await run(`document.querySelector('#login-form').elements.password.value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();void 0`);await wait('!busy&&!document.querySelector("#workspace").hidden');
await run('navigate("crypto");void 0');await wait('!busy&&Boolean(cryptoInfo)');
await run(`(async()=>{const blob=new File([new Uint8Array(100)],'第一节-测试视频.mp4',{type:'video/mp4'});await encryptBrowserFile(blob,{info:cryptoInfo,courseId:'体验课程',title:'第一节',output:{write:async()=>{},close:async()=>{},abort:async()=>{}},prepare:b=>api('crypto-start',b),complete:id=>api('crypto-complete',{id,confirmation:{saved:true,method:'direct'}})});await api('group-edit',{name:'体验课程-分组',note:'测试分组备注'});await refresh();await loadCrypto();})()`);
player=await createEngine({storageDir:path.join(out,'player'),deviceId:'web-quality-viewer',role:'player',seal:b=>b,unseal:b=>b});
const request=player.getDeviceRequest();
await run(`(async()=>{await api('crypto-issue',{videoIds:cryptoInfo.files.filter(f=>f.status==='complete').map(f=>f.id),deviceRequest:${JSON.stringify(request)},deviceRemark:'体验设备',maxPlays:10,expiresAt:null,policy:{watermark:true,watermarkText:'体验课程',allowSeek:false,allowRate:false}});await refresh();})()`);
for(const width of [1440,1024,800,390]){win.setContentSize(width,1000);for(const view of ['crypto','files','licenses','activity','security']){await run(`navigate(${JSON.stringify(view)});void 0`);await wait('!busy');await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');await delay(250);await run('document.getAnimations().forEach(a=>a.finish());void 0');await run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');assert.equal(await run('document.querySelectorAll(".nav.active").length'),1);assert.equal(await run(`document.querySelector(".nav.active").dataset.view`),view);assert.equal(await run('getComputedStyle(document.querySelector(".nav.active")).backgroundColor'), 'rgb(255, 241, 231)');assert.equal(await run('document.documentElement.scrollWidth<=innerWidth'),true,'Workspace overflow '+width+' '+view);assert.equal(await run(`document.querySelector('#${view}-view').hidden`),false);await fs.writeFile(path.join(out,`${width}-${view}.png`),(await win.webContents.capturePage()).toPNG());checks.push({width,view,pageOverflow:false});}}
await run('navigate("files");document.querySelector("#file-search").value="不存在的文件";renderFiles();void 0');assert.match(await run('document.querySelector("#file-rows").textContent'),/没有匹配/);
await run('document.querySelector("#file-search").value="";renderFiles();document.querySelector("#file-select-all").click();void 0');assert.match(await run('document.querySelector("#file-selection-status").textContent'),/已选1个/);
await run('document.querySelector("#group-list button").click();void 0');assert.equal(await run('document.querySelector("#group-tools").open'),true);await run('document.querySelector("#group-reset").click();void 0');assert.equal(await run('document.querySelector("#group-form").elements.id.value'),'');
await run('navigate("licenses");document.querySelector("#open-import").click();notify("一次测试错误",true);void 0');assert.equal(await run('document.querySelector("#import-dialog").open'),true);await fs.writeFile(path.join(out,'390-dialog.png'),(await win.webContents.capturePage()).toPNG());await run('document.querySelector("#import-dialog").close();void 0');await wait('document.querySelectorAll(".dialog-error").length===0');
assert.deepEqual(errors,[]);await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,screens:checks,consoleErrors:errors,isolatedServer:true,realAccountUsed:false,checks:['all views responsive','file search empty state','selection count','group edit/reset','dialog error clearing'],scope:'UI checks; encryption and playback verified by separate existing suites'},null,2));await player.close();await server.close();win.destroy();app.quit();
}catch(e){await fs.writeFile(path.join(out,'error.txt'),e.stack);await player?.close();await server?.close();app.exit(1);}});
