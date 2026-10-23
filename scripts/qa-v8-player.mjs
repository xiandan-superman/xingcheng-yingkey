import {app,BrowserWindow,dialog,Menu} from 'electron';
import {pathToFileURL} from 'node:url';
import {promises as fs,appendFileSync} from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createEngine} from '../src/core/engine.mjs';
const root=path.resolve(import.meta.dirname,'..'),out=path.join(root,'artifacts','desktop-quality-player-policies-'+Date.now());
await fs.mkdir(out,{recursive:true});process.env.VIDEOKEY_PLAYER_DATA_DIR=path.join(out,'profile');process.env.LOCALAPPDATA=path.join(out,'local-appdata');
const trace=x=>appendFileSync(path.join(out,'log.txt'),String(x)+'\n');let selected;
dialog.showSaveDialog=async()=>({canceled:false,filePath:path.join(out,'request.vdevice')});dialog.showOpenDialog=async()=>({canceled:false,filePaths:Array.isArray(selected)?selected:[selected]});dialog.showErrorBox=(a,b)=>{trace(a+':'+b);app.exit(1);};
const resources=path.join(path.resolve(process.env.YINGKEY_QA_RELEASE||'../星橙·映钥-v0.8.1-测试优化版'),'星橙·映钥播放器-win32-x64','resources');Object.defineProperty(app,'isPackaged',{value:true});Object.defineProperty(process,'resourcesPath',{value:resources});await import(pathToFileURL(path.join(resources,'app.asar','src/player/main.mjs')).href);const delay=ms=>new Promise(r=>setTimeout(r,ms));
app.whenReady().then(async()=>{let merchant;try{
 let win;for(let i=0;i<100;i++){win=BrowserWindow.getAllWindows()[0];if(win&&!win.webContents.isLoading()&&await win.webContents.executeJavaScript('Boolean(window.viewer && document.querySelector("#preview"))'))break;await delay(100);}if(!win)throw Error('no viewer');
 const run=code=>Promise.race([win.webContents.executeJavaScript(code),delay(8000).then(()=>{throw Error('script timeout: '+code.slice(0,100));})]),capture=async file=>fs.writeFile(path.join(out,file),(await win.webContents.capturePage()).toPNG());
 assert.equal(win.isContentProtected(),true);assert.equal(Menu.getApplicationMenu().items[0].label,'文件');assert.equal(await run('document.title'),'星橙·映钥播放器');
 await run('window.viewer.exportRequest()');const request=JSON.parse(await fs.readFile(path.join(out,'request.vdevice')));
 merchant=await createEngine({storageDir:path.join(out,'merchant'),deviceId:'qa-merchant',seal:b=>b,unseal:b=>b});
 const clip=path.join(out,'trial.mp4');execFileSync(path.join(root,'node_modules','ffmpeg-static','ffmpeg.exe'),['-hide_banner','-loglevel','error','-i',path.join(root,'assets','demo.mp4'),'-t','2','-c:v','libx264','-preset','fast','-c:a','aac',clip],{windowsHide:true});
 const file=path.join(out,'video.vdrm'),video=await merchant.encryptVideo({inputPath:path.join(root,'assets','demo.mp4'),outputPath:file,courseId:'保护功能验证',title:'星橙·映钥演示',previewPath:clip,previewSeconds:2});const second=path.join(out,'second.vdrm');await merchant.encryptVideo({inputPath:path.join(root,'assets','demo.mp4'),outputPath:second,courseId:'保护功能验证',title:'第二课'});const corrupt=path.join(out,'broken.vdrm');await fs.writeFile(corrupt,'broken');selected=[file,second,corrupt];await run('document.querySelector("#add-videos").onclick()');assert.equal(await run('playlist.length'),2);assert.equal(await run('playback'),null);assert.match(await run('document.querySelector("#message").textContent'),/1 个文件无法读取/);await run('document.querySelector("#playlist button").onclick()');assert.equal(await run('playback'),null);selected=file;await run('open()');await run('preview()');await delay(450);
 assert.ok(Math.abs(await run('document.querySelector("video").duration')-2)<.15);assert.equal(await run('data.licenses.length'),0);await capture('trial.png');await run('stop()');await assert.rejects(run('play()'),/许可/);trace('preview passed');
 async function load(policy,expiresAt=null){const l=await merchant.issueLicense({deviceRequest:request,videoIds:[video.videoId],maxPlays:3,expiresAt,policy});selected=path.join(out,'license-'+l.payload.id+'.vlicense');await fs.writeFile(selected,JSON.stringify(l));await run('window.viewer.importLicense()');await run('refresh()');await run(`document.querySelector('#license').value=${JSON.stringify(l.payload.id)}`);return l;}
 await load({watermark:true,watermarkText:'测试学员',allowSeek:false,allowRate:false});await run('play()');await delay(450);await run('document.querySelector("video").pause()');
 assert.equal(await run('document.querySelector("#seek").disabled'),true);assert.equal(await run('document.querySelector("#rate").disabled'),true);
 await run('document.querySelector("video").playbackRate=2');await delay(150);assert.equal(await run('document.querySelector("video").playbackRate'),1);
 await run('document.querySelector("video").currentTime=4');await delay(200);assert.ok(await run('document.querySelector("video").currentTime<1.5'));
 const wm=await run('document.querySelector("#watermark").className');assert.match(await run('document.querySelector("#watermark").textContent'),/测试学员/);await delay(6200);assert.notEqual(await run('document.querySelector("#watermark").className'),wm);
 trace('before fullscreen');await Promise.race([win.webContents.executeJavaScript('document.querySelector("#stage").requestFullscreen()',true),delay(5000).then(()=>{throw Error('fullscreen timeout');})]);await delay(200);assert.equal(await run('document.fullscreenElement.id'),'stage');assert.equal(await run('document.fullscreenElement.contains(document.querySelector("#watermark"))'),true);await run('document.exitFullscreen()');await delay(500);await capture('protected.png');await run('stop()');trace('watermark seek rate fullscreen passed');
 await load({watermark:false,allowSeek:true,allowRate:true});await run('play()');await delay(300);await run('document.querySelector("video").pause();document.querySelector("video").currentTime=3;document.querySelector("video").playbackRate=1.5;void 0');await delay(250);assert.ok(await run('document.querySelector("video").currentTime>=3'));assert.equal(await run('document.querySelector("video").playbackRate'),1.5);assert.equal(await run('document.querySelector("#watermark").hidden'),true);await run('stop()');trace('allowed policy passed');
 await load({watermark:true,allowSeek:false,allowRate:false},Date.now()+2000);await run('play()');await delay(2600);assert.equal(await run('playback'),null);assert.match(await run('document.querySelector("#message").textContent'),/过期/);trace('expiry passed');
 await fs.writeFile(path.join(out,'result.json'),JSON.stringify({passed:true,multipleVideoPlaylist:true,corruptFileSkipped:true,selectionDoesNotConsumePlay:true,previewSeconds:2,watermarkMoved:true,fullscreenWatermark:true,forbiddenSeek:true,forbiddenRate:true,allowedSeekAndRate:true,captureProtectionFlag:win.isContentProtected(),expiryStopped:true,out},null,2));await merchant.close();app.quit();
 }catch(e){trace(e.stack);await merchant?.close();app.exit(1);}});



