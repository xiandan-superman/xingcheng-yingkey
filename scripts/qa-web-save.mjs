import {app,BrowserWindow} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createAuthorizationServer} from '../server/server.mjs';
const out=path.resolve('artifacts','web-save-'+Date.now());await fs.mkdir(out,{recursive:true});
let server;
app.whenReady().then(async()=>{try{
 server=await createAuthorizationServer({dataDir:path.join(out,'server')});
 const password=(await fs.readFile(path.join(out,'server','console-login.txt'),'utf8')).match(/初始密码：(.+)/)[1];
 const win=new BrowserWindow({show:false,webPreferences:{sandbox:true,contextIsolation:true,partition:'save-'+Date.now()}});
 await win.loadURL('http://127.0.0.1:'+server.port);const run=s=>win.webContents.executeJavaScript(s);
 const wait=async()=>{for(let i=0;i<200;i++){if(await run('typeof busy!=="undefined"&&!busy'))return;await new Promise(r=>setTimeout(r,100));}throw Error('UI timeout');};
 await wait();await run(`document.querySelector('#login-form').elements.password.value=${JSON.stringify(password)};document.querySelector('#login-form').requestSubmit();void 0`);await wait();
 await run(`document.querySelector('[data-view="crypto"]').click();void 0`);await wait();
 // A real Chromium filesystem stream writes to this isolated origin's disk storage.
 await run(`(async()=>{const dir=await navigator.storage.getDirectory();window.diskHandle=await dir.getFileHandle('actual.vdrm',{create:true});window.showSaveFilePicker=async()=>diskHandle;const d=new DataTransfer();d.items.add(new File([new Uint8Array(3*1048576+19).fill(71)],'own.mp4',{type:'video/mp4'}));const f=document.querySelector('#web-encrypt-form').elements;f.video.files=d.files;f.course.value='真实磁盘保存测试';f.saveMode.value='direct';document.querySelector('#web-encrypt-form').requestSubmit();})()`);await wait();
 assert.match(await run('document.querySelector("#web-progress").textContent'),/已保存文件/);
 const disk=await run('(async()=>{const f=await diskHandle.getFile();return {size:f.size,magic:await f.slice(0,8).text()};})()');assert.equal(disk.magic,'VDRM001\n');assert.ok(disk.size>3*1048576+19);
 // Inject the reported exception mid-stream; partial records must not become issuable.
 await run(`window.realPicker=window.showSaveFilePicker;window.failedWrites=0;window.showSaveFilePicker=async()=>({name:'failure.vdrm',createWritable:async()=>({write:async()=>{if(++failedWrites===5)throw new DOMException('An attempt was made to write to a file or directory which could not be modified due to the state of the underlying filesystem.','NoModificationAllowedError');},close:async()=>{},abort:async()=>{window.aborted=true;}})});document.querySelector('#web-encrypt-form').requestSubmit();void 0`);await wait();
 assert.match(await run('document.querySelector("#notice").textContent'),/写入加密文件失败/);assert.match(await run('document.querySelector("#web-progress").textContent'),/操作失败/);assert.equal(await run('window.aborted'),true);
 assert.equal(await run('cryptoInfo.files.filter(f=>f.status==="complete").length'),1);
 // A failure at close is different from a failed backend registration.
 await run(`window.showSaveFilePicker=async()=>({name:'close.vdrm',createWritable:async()=>({write:async()=>{},close:async()=>{throw new DOMException('locked','NoModificationAllowedError');},abort:async()=>{}})});document.querySelector('#web-encrypt-form').requestSubmit();void 0`);await wait();assert.match(await run('document.querySelector("#notice").textContent'),/保存加密文件失败/);
 await run(`window.showSaveFilePicker=realPicker;window.realApi=api;api=async(name,...args)=>{if(name==='crypto-complete')throw Error('network interrupted');return realApi(name,...args);};document.querySelector('#web-encrypt-form').requestSubmit();void 0`);await wait();assert.match(await run('document.querySelector("#notice").textContent'),/后台登记失败/);assert.equal(await run('document.querySelector("#web-retry-registration").hidden'),false);
 await run(`api=realApi;document.querySelector('#web-retry-registration').click();void 0`);await wait();assert.match(await run('document.querySelector("#web-progress").textContent'),/已补登记/);
 const state=JSON.parse(await fs.readFile(path.join(out,'server','authority.json'),'utf8'));const entries=Object.values(state.files);assert.equal(entries.filter(f=>f.status==='draft').length,2);assert.equal(entries.filter(f=>f.status==='complete').length,2);
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,actualChromiumFilesystemWrite:disk,midWriteFailureChinese:true,closeFailureChinese:true,failedRecordsNotComplete:true,registrationRecovery:true},null,2));
 await server.close();app.quit();
}catch(e){await fs.writeFile(path.join(out,'error.txt'),e.stack);await server?.close();app.exit(1);}});
