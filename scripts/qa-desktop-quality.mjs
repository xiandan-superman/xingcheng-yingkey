// Isolated native end-to-end acceptance. Run with Electron, optionally --player.
// YINGKEY_QA_RELEASE points to a release root containing both packaged apps.
import {app,BrowserWindow,dialog,Menu} from 'electron';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createAuthorizationServer} from '../server/server.mjs';
import {createEngine} from '../src/core/engine.mjs';
import {postJson} from '../src/core/online.mjs';
const root=path.resolve(import.meta.dirname,'..'),mode=process.argv.includes('--player')?'player':'manager';
const singleClick=process.env.YINGKEY_QA_SINGLE_CLICK==='1'; // Diagnostic only; acceptance must leave this unset.
const out=path.join(root,'artifacts',`desktop-quality-${mode}-${Date.now()}`);
await fs.mkdir(out,{recursive:true});
process.env[mode==='player'?'VIDEOKEY_PLAYER_DATA_DIR':'VIDEOKEY_DATA_DIR']=path.join(out,'profile');
process.env.LOCALAPPDATA=path.join(out,'local-appdata');
if(mode==='manager'){await fs.mkdir(path.join(out,'profile'));await fs.writeFile(path.join(out,'profile','online-admin.sealed'),'isolated unreadable old connection');}
const errors=[],checks=[],layouts=[];let selected=[],savePath=path.join(out,'output.vdrm'),server,peer;
app.on('web-contents-created',(_event,contents)=>{contents.on('console-message',(_event,details)=>{if(details.level==='error')errors.push(details.message);});contents.on('render-process-gone',(_event,d)=>errors.push('renderer exited: '+d.reason));});
dialog.showOpenDialog=async()=>({canceled:!selected.length,filePaths:selected});
dialog.showSaveDialog=async()=>({canceled:!savePath,filePath:savePath});
dialog.showErrorBox=(title,message)=>{fs.writeFile(path.join(out,'boot-error.txt'),title+'\n'+message);app.exit(1);};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
function check(name){checks.push(name);}
const release=process.env.YINGKEY_QA_RELEASE;
let entry=path.join(root,mode==='player'?'src/player/main.mjs':'src/main.mjs');
if(release){let dir=path.resolve(release);if(!path.basename(dir).endsWith('win32-x64'))dir=path.join(dir,mode==='player'?'星橙·映钥播放器-win32-x64':'星橙·映钥管理端-win32-x64');const resources=path.join(dir,'resources');Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});entry=path.join(resources,'app.asar',mode==='player'?'src/player/main.mjs':'src/main.mjs');}
await import(pathToFileURL(entry).href);
app.whenReady().then(async()=>{try{
 let win;for(let n=0;n<150;n++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript(`Boolean(window.${mode==='player'?'viewer':'desktop'}&&document.querySelector('${mode==='player'?'#message':'#main h1'}'))`))break;await sleep(100);}assert.ok(win,'window initialized');
 const run=code=>win.webContents.executeJavaScript(code);
 const wait=async(code,timeout=15000)=>{const start=Date.now();while(Date.now()-start<timeout){if(await run(code))return;await sleep(75);}throw Error('UI timeout: '+code);};
 const click=async(text)=>{await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(text)});if(!b)throw Error('Button missing');if(b.disabled)throw Error('Button disabled');b.click();})()`);await sleep(100);};
 async function capture(name,width,height=900){win.setContentSize(width,height);await sleep(200);const layout=await run(`(()=>{const vw=document.documentElement.clientWidth;return {width:vw,documentOverflow:document.documentElement.scrollWidth>vw+2,controls:[...document.querySelectorAll('button,input,select')].filter(e=>!e.hidden&&e.getClientRects().length).filter(e=>{const r=e.getBoundingClientRect();return r.width<1||r.left<-2||r.right>vw+2;}).map(e=>({tag:e.tagName,text:(e.textContent||e.getAttribute('aria-label')||'').trim().slice(0,30)}))};})()`);layouts.push({name,...layout});await fs.writeFile(path.join(out,name+'.png'),(await win.webContents.capturePage()).toPNG());assert.equal(layout.documentOverflow,false,name+' page overflow');assert.deepEqual(layout.controls,[],name+' controls outside viewport');}
 assert.equal(Menu.getApplicationMenu().items[0].label,'文件');assert.equal(win.isContentProtected(),true);check('Chinese menus and capture protection');
 if(mode==='manager'){
  server=await createAuthorizationServer({dataDir:path.join(out,'server')});const url='http://127.0.0.1:'+server.port,token=server.adminToken;
  assert.equal((await postJson(url+'/admin/status',{},token)).publicKey,server.publicKey);
  assert.ok((await run('window.desktop.getDashboard()')).onlineRecoveryMessage);check('Unreadable old connection does not prevent startup');
  const connection=path.join(out,'connection.yingserver');await fs.writeFile(connection,JSON.stringify({url,publicKey:server.publicKey,adminToken:token}));selected=[connection];await run('window.desktop.connectOnline()');await run('refresh()');assert.equal((await run('window.desktop.getDashboard()')).onlineRecoveryMessage,null);check('Connection reimport clears recovery state');
  peer=await createEngine({storageDir:path.join(out,'peer'),role:'player',deviceId:'desktop-quality-viewer',seal:b=>b,unseal:b=>b});
  for(const width of [1440,1280,1080]){for(const page of ['overview','encrypt','groups','licenses']){await run(`document.querySelector('[data-page="${page}"]').click()`);await capture(`manager-${page}-${width}`,width);}}
  await run('document.querySelector(\'[data-page="encrypt"]\').click()');await click('批量 / 目录');for(const width of [1440,1080])await capture(`manager-batch-${width}`,width);await click('单个视频');
  await run('document.querySelector(\'[data-page="encrypt"]\').click()');selected=[path.join(root,'assets','demo.mp4')];await click('选择本地视频');
  await run(`(()=>{const fields=[...document.querySelectorAll('.field')];for(const f of fields){const l=f.querySelector('label')?.textContent||'',i=f.querySelector('input');if(/视频标题/.test(l))i.value='验收课程一';if(/课程名称|课程.*标识/.test(l)||l.includes('课程 / 项目'))i.value='验收项目';i?.dispatchEvent(new Event('input',{bubbles:true}));}})()`);
  // Business function is kept as a fallback when copy is polished, while actual native IPC writes output.
  const submit=await run(`[...document.querySelectorAll('button')].find(b=>/生成加密文件/.test(b.textContent))?.textContent.trim()`);assert.ok(submit);await click(submit);
  await wait('!state.busy&&state.dashboard.catalog.length===1');assert.ok((await fs.stat(savePath)).size>100);assert.equal(await run('Boolean(document.querySelector(".cloud-dialog"))'),false);assert.equal((await postJson(url+'/admin/file-info',{},token)).files.length,0);check('Real video file encryption and no premature upload');
  const request=path.join(out,'viewer.vdevice');await fs.writeFile(request,JSON.stringify(peer.getDeviceRequest()));selected=[request];await run('document.querySelector(\'[data-page="licenses"]\').click()');await click('导入其他设备请求');
  await run(`(()=>{for(const f of document.querySelectorAll('.field')){const text=f.querySelector('label')?.textContent||'',input=f.querySelector('input');if(text==='最大播放次数')input.value='7';if(text.includes('截止'))input.value='2099-01-01T12:00';input?.dispatchEvent(new Event('input',{bubbles:true}));}})()`);await run('document.querySelector(\'[data-page="groups"]\').click()');await run('document.querySelector(\'[data-page="licenses"]\').click()');const restored=await run(`[...document.querySelectorAll('.field')].filter(f=>{const t=f.querySelector('label')?.textContent||'';return t==='最大播放次数'||t.includes('截止');}).map(f=>f.querySelector('input').value)`);assert.deepEqual(restored,['7','2099-01-01T12:00']);check('License count and expiry survive navigation');
  await click('导入其他设备请求');await click('选中整组');assert.deepEqual(await run(`[...document.querySelectorAll('.field')].filter(f=>{const t=f.querySelector('label')?.textContent||'';return t==='最大播放次数'||t.includes('截止');}).map(f=>f.querySelector('input').value)`),['7','2099-01-01T12:00']);check('Count and expiry survive device import and whole-group selection');
  await click('清空勾选');assert.equal(await run('document.querySelector("#issue-submit").disabled'),true);await run('document.querySelector(".selected-check input[type=checkbox]").click()');assert.equal(await run('document.querySelector("#issue-submit").disabled'),false);check('Selecting one video enables issue immediately after clearing selection');
  await run(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>/签发许可/.test(b.textContent));b.click();${singleClick?'':'b.click();'}})()`);
  await wait('Boolean(document.querySelector(".cloud-dialog[open]"))');await sleep(350);assert.equal((await run('window.desktop.getDashboard()')).licenses.length,1);assert.equal(await run('document.querySelectorAll(".cloud-dialog").length'),1);assert.equal((await postJson(url+'/admin/status',{},token)).licenses.length,0);await capture('manager-upload-confirmation-1080',1080);check(singleClick?'Single click license issue':'Double-click signs exactly one license');
  // Intentionally stop local backend: upload must stay retryable and not report success.
  await server.close();await run('document.querySelector(".cloud-dialog .primary").click()');await wait('document.querySelector(".cloud-dialog .primary")&&!document.querySelector(".cloud-dialog .primary").disabled');assert.equal(await run('Boolean(document.querySelector(".cloud-dialog[open]"))'),true);check('Upload failure preserves confirmation and enables retry');
  // Same state and port, so the signed online configuration continues to target this isolated instance.
  server=await createAuthorizationServer({dataDir:path.join(out,'server'),port:Number(new URL(url).port)});
  await run(`(()=>{const d=document.querySelector('.cloud-dialog'),i=d.querySelectorAll('input');i[0].value='验收文件';i[1].value='验收设备';i[2].value='验收备注';d.querySelector('.primary').click();})()`);await wait('!document.querySelector(".cloud-dialog")');
  const info=await postJson(url+'/admin/file-info',{},token),status=await postJson(url+'/admin/status',{},token);assert.equal(info.files.length,1);assert.equal(info.files[0].fileLabel,'验收文件');assert.equal(status.licenses.length,1);assert.equal(JSON.parse(await fs.readFile(path.join(out,'server','authority.json'),'utf8')).licenses[status.licenses[0].id].deviceRemark,'验收设备');check('Retry stores one file record and one device license');
  for(const width of [1440,1280,1080])for(const page of ['encrypt','groups','licenses']){await run(`document.querySelector('[data-page="${page}"]').click()`);await capture(`manager-populated-${page}-${width}`,width);}
  const native=JSON.parse(await fs.readFile(path.join(out,'profile','vault','state.json'),'utf8')),license=native.licenses[0];await peer.importLicense(license);const playback=await peer.openPlayback({filePath:savePath,licenseId:license.payload.id});assert.deepEqual(await peer.readPlayback({sessionId:playback.sessionId}),await fs.readFile(path.join(root,'assets','demo.mp4')));check('Uploaded online license decrypts exact original bytes');
  await postJson(url+'/admin/toggle',{id:license.payload.id,enabled:false},token);await peer.refreshOnlineSessions();assert.equal(peer.getSessionStatus(playback.sessionId).valid,false);check('Remote disable invalidates active isolated online session');
 }else{
  peer=await createEngine({storageDir:path.join(out,'merchant'),deviceId:'desktop-quality-merchant',seal:b=>b,unseal:b=>b});
  savePath=path.join(out,'request.vdevice');await click('导出设备请求');await wait('Boolean(document.querySelector("#message").textContent)');const request=JSON.parse(await fs.readFile(savePath));
  const videoFile=path.join(out,'video.vdrm'),video=await peer.encryptVideo({inputPath:path.join(root,'assets','demo.mp4'),outputPath:videoFile,courseId:'验收项目',title:'验收视频'});
  const broken=path.join(out,'broken.vdrm');await fs.writeFile(broken,'broken');selected=[videoFile,broken];await click('添加多个视频');await wait('playlist.length===1');assert.equal(await run('playback'),null);check('Multi-file picker skips invalid files without consuming plays');
  const license=await peer.issueLicense({deviceRequest:request,videoIds:[video.videoId],maxPlays:3,policy:{watermark:true,watermarkText:'验收水印',allowSeek:false,allowRate:false}});const licenseFile=path.join(out,'license.vlicense');await fs.writeFile(licenseFile,JSON.stringify(license));selected=[licenseFile];await click('导入许可');await wait('data.licenses.length===1');selected=[videoFile];await click('打开视频');await wait('Boolean(current)');assert.equal(await run('data.licenses[0].playsUsed'),0);check('Import and selecting video do not consume plays');
  await run(`document.querySelector("#play").click();${singleClick?'':'document.querySelector("#play").click();'}`);await wait('Boolean(playback)');await sleep(400);assert.equal(await run('data.licenses[0].playsUsed'),1);check(singleClick?'Single click playback':'Double-click playback consumes exactly one play');
  await run('document.querySelector("video").pause()');assert.equal(await run('document.querySelector("#seek").disabled'),true);assert.equal(await run('document.querySelector("#rate").disabled'),true);assert.match(await run('document.querySelector("#watermark").textContent'),/验收水印/);await run('document.querySelector("video").playbackRate=2');await sleep(120);assert.equal(await run('document.querySelector("video").playbackRate'),1);check('Seek, rate and visible watermark restrictions');
  for(const width of [1080,800])await capture('player-playing-'+width,width,800);
  await click('关闭');await wait('playback===null');assert.equal(await run('data.licenses[0].playsUsed'),1);check('Closing does not consume another play');
  const expiry=await peer.issueLicense({deviceRequest:request,videoIds:[video.videoId],maxPlays:2,expiresAt:Date.now()+3000,policy:{watermark:false,allowSeek:true,allowRate:true}});await fs.writeFile(licenseFile,JSON.stringify(expiry));selected=[licenseFile];await click('导入许可');selected=[videoFile];await click('打开视频');await run(`document.querySelector('#license').value=${JSON.stringify(expiry.payload.id)};document.querySelector('#play').click()`);await wait('Boolean(playback)');await wait('playback===null',6000);assert.match(await run('document.querySelector("#message").textContent'),/过期|到期/);check('Expiry stops active playback');
  server=await createAuthorizationServer({dataDir:path.join(out,'server')});const url='http://127.0.0.1:'+server.port,token=server.adminToken;
  const online=await peer.issueLicense({deviceRequest:request,videoIds:[video.videoId],maxPlays:3,policy:{watermark:true,allowSeek:false,allowRate:false},online:{url,publicKey:server.publicKey}});await postJson(url+'/admin/register',{license:online,deviceRequest:request,deviceRemark:'隔离播放器验收'},token);await fs.writeFile(licenseFile,JSON.stringify(online));selected=[licenseFile];await click('导入许可');await run(`document.querySelector('#license').value=${JSON.stringify(online.payload.id)};document.querySelector('#play').click()`);await wait('Boolean(playback?.online)');await run('document.querySelector("video").pause()');const oldSession=await run('playback.sessionId');
  await postJson(url+'/admin/toggle',{id:online.payload.id,enabled:false},token);await wait('playback===null',26000);assert.match(await run('document.querySelector("#message").textContent'),/停用|失效/);check('Native online player stops after real 20-second background recheck');
  await postJson(url+'/admin/toggle',{id:online.payload.id,enabled:true},token);await sleep(700);assert.equal(await run('playback'),null);check('Restoring authorization does not revive revoked session');await click('验证并播放');await wait('Boolean(playback?.online)');assert.notEqual(await run('playback.sessionId'),oldSession);assert.equal((await postJson(url+'/admin/status',{},token)).licenses[0].playsUsed,2);await click('关闭');check('Manual revalidation creates new online session and accurate count');
 }
 assert.deepEqual(errors,[],'No renderer errors');await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:true,acceptance:!singleClick,mode,packaged:Boolean(release),checks,layouts,rendererErrors:errors},null,2));await peer?.close();await server?.close();app.quit();
 }catch(e){await fs.writeFile(path.join(out,'error.txt'),e.stack);await fs.writeFile(path.join(out,'report.json'),JSON.stringify({passed:false,mode,packaged:Boolean(release),checks,layouts,rendererErrors:errors,error:e.message},null,2));await peer?.close().catch(()=>{});await server?.close().catch(()=>{});app.exit(1);}});



