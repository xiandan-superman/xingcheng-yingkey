import {app,BrowserWindow,ipcMain,dialog,safeStorage,session} from 'electron';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {desktopFetch} from '../desktop-network.mjs';
import {configureOnlineTransport} from '../core/online.mjs';
import {createEngine} from '../core/engine.mjs';
import {createMediaServer} from '../media-server.mjs';
import {createLocalGuard} from '../local-guard.mjs';
import {playbackPolicy} from '../core/policy.mjs';
import {installChineseMenu} from '../chinese-menu.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const ui=path.join(here,'renderer','index.html'),uiUrl=pathToFileURL(ui).href;
app.setName('星橙·映钥播放器');
app.setPath('userData',process.env.VIDEOKEY_PLAYER_DATA_DIR||path.join(app.getPath('appData'),'VideoKeyPlayer'));
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
let win,engine,media,checkpointTimer,onlineTimer,quitting=false,openingPlayback=false;
const files=new Set();
function machine(){let id=os.hostname();try{const value=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',windowsHide:true,timeout:3000});id=value.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1]||id;}catch{}return createHash('sha256').update(id+'|'+os.userInfo().username+'|VideoKey-v1').digest('hex').slice(0,32);}
function state(){const d=engine.getDashboard();return {deviceId:d.deviceId,captureProtection:win?.isContentProtected()||false,licenses:d.licenses.map(l=>({id:l.payload.id,videoIds:l.payload.videos.map(v=>v.videoId),courseNames:[...new Set(l.payload.videos.map(v=>v.courseId))].join('、'),maxPlays:l.payload.maxPlays,playsUsed:l.playsUsed,expiresAt:l.payload.expiresAt,revoked:l.revoked,online:Boolean(l.payload.online),policy:playbackPolicy(l.payload.policy,l.payload.policy==null),legacy:l.payload.version<2}))};}
function handle(name,fn){ipcMain.handle('viewer:'+name,async(event,...args)=>{if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==uiUrl)throw Error('请求来源无效');return fn(...args);});}
async function init(){
 configureOnlineTransport(desktopFetch(session.defaultSession));
 if(!safeStorage.isEncryptionAvailable())throw Error('Windows 安全存储不可用');
 const storageDir=path.join(app.getPath('userData'),'vault'),seal=b=>safeStorage.encryptString(Buffer.from(b).toString('base64')),unseal=b=>Buffer.from(safeStorage.decryptString(Buffer.from(b)),'base64');
 const anchor=createLocalGuard({storageDir,anchorRoot:path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'StarOrangeYingKey','anchors'),seal,unseal});
 engine=await createEngine({storageDir,deviceId:machine(),role:'player',seal,unseal,anchor});
 checkpointTimer=setInterval(()=>engine.checkpoint().catch(()=>{}),15000);checkpointTimer.unref();
 onlineTimer=setInterval(()=>engine.refreshOnlineSessions().catch(()=>{}),20000);onlineTimer.unref();
 media=await createMediaServer(engine);
 handle('getState',state);
 handle('exportRequest',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'星橙·映钥-设备请求.vdevice',filters:[{name:'设备请求',extensions:['vdevice']}]});if(r.canceled)return null;await fs.writeFile(r.filePath,JSON.stringify(engine.getDeviceRequest(),null,2),'utf8');return true;});
 handle('importLicense',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'星橙·映钥播放许可',extensions:['vlicense']}],properties:['openFile']});if(r.canceled)return null;const stat=await fs.stat(r.filePaths[0]);if(stat.size>1048576)throw Error('许可文件过大');let license;try{license=JSON.parse(await fs.readFile(r.filePaths[0],'utf8'));}catch{throw Error('许可文件格式无效');}await engine.importLicense(license);return state();});
 handle('chooseVideo',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'星橙·映钥加密视频',extensions:['vdrm']}],properties:['openFile']});if(r.canceled)return null;const filePath=r.filePaths[0],h=await engine.inspectVideo(filePath);files.add(filePath);return {filePath,title:h.title,videoId:h.videoId,courseId:h.courseId,previewSeconds:h.preview?.seconds||0};});
 handle('chooseVideos',async()=>{const r=await dialog.showOpenDialog(win,{filters:[{name:'星橙·映钥加密视频',extensions:['vdrm']}],properties:['openFile','multiSelections']});if(r.canceled)return null;if(r.filePaths.length>1000)throw Error('每次最多添加1000个视频');const videos=[],errors=[];for(const filePath of r.filePaths){try{const h=await engine.inspectVideo(filePath);files.add(filePath);videos.push({filePath,title:h.title,videoId:h.videoId,courseId:h.courseId,previewSeconds:h.preview?.seconds||0});}catch(e){errors.push({filename:path.basename(filePath),error:e.message});}}return {videos,errors};});
 handle('play',async data=>{if(openingPlayback)throw Error('正在验证，请稍候');if(!files.has(data?.filePath))throw Error('请先打开加密视频');openingPlayback=true;try{return media.add(await engine.openPlayback(data));}finally{openingPlayback=false;}});
 handle('preview',async filePath=>{if(openingPlayback)throw Error('正在验证，请稍候');if(!files.has(filePath))throw Error('请先打开加密视频');openingPlayback=true;try{return media.add(await engine.openPreview({filePath}));}finally{openingPlayback=false;}});
 handle('close',id=>media.remove(id));
 handle('status',id=>engine.getSessionStatus(id));
 session.defaultSession.setPermissionRequestHandler((contents,permission,cb)=>cb(permission==='fullscreen'&&contents===win?.webContents));
 win=new BrowserWindow({width:1080,height:900,minWidth:760,minHeight:650,show:false,title:'星橙·映钥播放器',backgroundColor:'#f2f5fb',webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:!app.isPackaged,backgroundThrottling:false}});
 installChineseMenu();win.setIcon(path.resolve(here,'../../assets/brand.png'));win.setContentProtection(true);
 win.webContents.on('before-input-event',(event,input)=>{if(['PrintScreen','F12'].includes(input.key)||(input.control&&input.shift&&['I','J','C'].includes(input.key)))event.preventDefault();});
 win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(e,url)=>{if(url!==uiUrl)e.preventDefault();});
 win.once('ready-to-show',()=>win.show());win.on('closed',()=>{win=null;});await win.loadFile(ui);
}
app.on('second-instance',()=>{if(win){win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(engine&&!quitting){event.preventDefault();quitting=true;clearInterval(checkpointTimer);clearInterval(onlineTimer);Promise.resolve(media?.close()).then(()=>engine.close()).finally(()=>app.quit());}});
if(lock)app.whenReady().then(init).catch(e=>{dialog.showErrorBox('播放器无法启动',e.message);app.quit();});
