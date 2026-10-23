import {app,BrowserWindow,ipcMain,dialog,safeStorage,shell,session} from 'electron';
import {fileURLToPath,pathToFileURL} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {promises as fs} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {promisify} from 'node:util';
import {execFile} from 'node:child_process';
import {createLocalGuard} from './local-guard.mjs';
import {createEngine} from './core/engine.mjs';
import {createMediaServer} from './media-server.mjs';
import {createOnlineAdmin} from './online-admin.mjs';
import {runEncryptionBatch} from './batch-encryption.mjs';
import {installChineseMenu} from './chinese-menu.mjs';
import {checkVideoCompatibility} from './video-compatibility.mjs';

const here=path.dirname(fileURLToPath(import.meta.url));
const appRoot=path.dirname(here);
const demoPath=app.isPackaged?path.join(process.resourcesPath,'demo.mp4'):path.join(appRoot,'assets','demo.mp4');
app.setName('星橙·映钥管理端');
app.setPath('userData',process.env.VIDEOKEY_DATA_DIR?path.resolve(process.env.VIDEOKEY_DATA_DIR):path.join(app.getPath('appData'),'VideoKey'));
const lock=app.requestSingleInstanceLock();if(!lock)app.quit();
let win,engine,media,checkpointTimer,onlineTimer,onlineAdmin;let shuttingDown=false,encryptionBusy=false,encryptionPreparing=false,issueBusy=false,openingPlayback=false,batchController=null,batchHistory=[],activeEncryption=null;
const approvedInputs=new Set(),approvedContainers=new Set(),knownFiles=new Set();
const mimeFor=file=>({'.mp4':'video/mp4','.m4v':'video/mp4','.webm':'video/webm','.ogv':'video/ogg','.ogg':'video/ogg','.mkv':'video/x-matroska','.mov':'video/quicktime'}[path.extname(file).toLowerCase()]||'video/mp4');
const uiUrl=pathToFileURL(path.join(here,'renderer','index.html')).href;
const clean=value=>String(value||'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)||'视频';

function deviceId(){
  let machine=os.hostname();
  if(process.platform==='win32'){try{const value=execFileSync(path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query','HKLM\\SOFTWARE\\Microsoft\\Cryptography','/v','MachineGuid'],{encoding:'utf8',windowsHide:true,timeout:3000});machine=value.match(/MachineGuid\s+REG_SZ\s+(\S+)/)?.[1]||machine;}catch{}}
  return createHash('sha256').update(machine+'|'+os.userInfo().username+'|VideoKey-v1').digest('hex').slice(0,32);
}
function normalized(){
  const d=engine.getDashboard();
  const catalog=d.catalog.map(v=>({...v,id:v.videoId,path:v.filePath,createdAt:v.createdAt||''}));
  const licenses=d.licenses.map(l=>({id:l.payload.id,courseId:[...new Set(l.payload.videos.map(v=>v.courseId))].join('、'),deviceId:l.payload.deviceId,maxPlays:l.payload.maxPlays,playsUsed:l.playsUsed,expiresAt:l.payload.expiresAt,revoked:l.revoked,online:Boolean(l.payload.online),policy:l.payload.policy,videoIds:l.payload.videos.map(v=>v.videoId)}));
  for(const v of catalog){approvedContainers.add(v.path);knownFiles.add(v.path);}
  return {deviceId:d.deviceId,deviceRequest:d.deviceRequest,catalog,licenses,groups:d.groups||[],batchHistory,demoPath,onlineService:onlineAdmin?.publicConfig?.url||null,onlineRecoveryMessage:onlineAdmin?.recoveryMessage||null};
}
async function saveJson(defaultPath,value,extension){
  const {canceled,filePath}=await dialog.showSaveDialog(win,{defaultPath,filters:[{name:'星橙·映钥文件',extensions:[extension]}]});if(canceled||!filePath)return null;
  await fs.writeFile(filePath,JSON.stringify(value,null,2),'utf8');knownFiles.add(filePath);return filePath;
}
async function readJson(filters){
  const {canceled,filePaths}=await dialog.showOpenDialog(win,{filters,properties:['openFile']});if(canceled)return null;
  const stat=await fs.stat(filePaths[0]);if(stat.size>1024*1024)throw Error('文件超过 1 MiB，无法导入');
  try{return JSON.parse(await fs.readFile(filePaths[0],'utf8'));}catch{throw Error('无法读取 JSON 文件，请检查文件格式');}
}
function register(name,fn){ipcMain.handle('videokey:'+name,async(event,...args)=>{
  if(event.sender!==win?.webContents||event.senderFrame!==win.webContents.mainFrame||event.senderFrame.url!==uiUrl)throw Error('拒绝来自未知页面的请求');
  try{return await fn(...args);}catch(e){throw Error(e?.message||'操作失败');}
});}

async function encryptManaged(data,outputPath,onProgress,signal){
 win?.webContents.send('videokey:progress',{percent:0,message:'正在检查视频兼容性…'});const ffmpegPath=app.isPackaged?path.join(process.resourcesPath,'ffmpeg.exe'):path.join(appRoot,'node_modules','ffmpeg-static','ffmpeg.exe');await checkVideoCompatibility({inputPath:data.inputPath,ffmpegPath,signal});
 const trial=Number(data.previewSeconds||0);if(!Number.isInteger(trial)||trial<0||trial>120)throw Error('试看时长须为0至120秒');
    let previewDir;try{let previewPath;if(trial){previewDir=await fs.mkdtemp(path.join(app.getPath('temp'),'starorange-preview-'));previewPath=path.join(previewDir,'preview.mp4');const ffmpeg=app.isPackaged?path.join(process.resourcesPath,'ffmpeg.exe'):path.join(appRoot,'node_modules','ffmpeg-static','ffmpeg.exe');win.webContents.send('videokey:progress',{percent:0,message:'正在生成试看片段…'});await promisify(execFile)(ffmpeg,['-hide_banner','-loglevel','error','-nostdin','-i',data.inputPath,'-t',String(trial),'-vf','scale=640:-2','-c:v','libx264','-preset','fast','-crf','24','-c:a','aac','-b:a','96k','-movflags','+faststart',previewPath],{windowsHide:true,timeout:180000,maxBuffer:1048576,signal});}

 const item=await engine.encryptVideo({inputPath:data.inputPath,outputPath,courseId:data.courseId,title:data.title,mime:mimeFor(data.inputPath),previewPath,previewSeconds:trial,signal,onProgress});knownFiles.add(item.filePath);approvedContainers.add(item.filePath);return {...item,id:item.videoId,path:item.filePath};
 }finally{if(previewDir&&path.dirname(path.resolve(previewDir))===path.resolve(app.getPath('temp'))&&path.basename(previewDir).startsWith('starorange-preview-'))await fs.rm(previewDir,{recursive:true,force:true}).catch(()=>console.warn("试看临时目录清理失败，请稍后清理"));}
}
async function saveBatchHistory(result){const file=path.join(app.getPath('userData'),'batch-history.json'),temp=file+'.tmp';try{await fs.writeFile(temp,JSON.stringify(batchHistory));await fs.rename(temp,file);}catch{result.warning='视频加密结果已保留，但本次任务历史未能写入磁盘。';await fs.rm(temp,{force:true}).catch(()=>{});}}
async function uploadRecords(data){
 if(!onlineAdmin.publicConfig)throw Error('请先导入服务连接文件');if(!data||typeof data!=='object')throw Error('上传参数无效');
 const dashboard=engine.getDashboard(),license=data.licenseId?dashboard.licenses.find(l=>l.payload.id===data.licenseId):null;if(data.licenseId&&!license)throw Error('找不到许可');
 const ids=[...new Set(license?license.payload.videos.map(v=>v.videoId):data.videoIds||[])];if(!ids.length||ids.length>1000)throw Error('请选择加密文件');if(ids.length>1&&data.fileLabel)throw Error('多个文件请保留各自名称，在后台分别编辑');
 if(license?.payload.online&&license.payload.online.publicKey!==onlineAdmin.publicConfig.publicKey)throw Error('这份许可属于另一授权服务');
 let request=license?.deviceRequest;
 if(license&&!request){try{const requests=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'cloud-requests.json'),'utf8'));request=requests[license.payload.id];}catch{}if(!request)request=await readJson([{name:'对应的设备请求',extensions:['vdevice','json']}]);if(!request)throw Error('已取消上传，请准备对应的设备请求后重试');}
 const info=await onlineAdmin.request('file-info');
 for(const videoId of ids){const previous=info.files.find(f=>f.id===videoId),record=await engine.exportCloudRecord({videoId,envelopePublicKey:info.envelopePublicKey,fileLabel:data.fileLabel||previous?.fileLabel,note:data.note||previous?.note||'',allowWebIssue:Boolean(data.allowWebIssue)});await onlineAdmin.request('file-record',record);}
 if(license){const {payload,signature,issuerPublicKey}=license;await onlineAdmin.request('register',{license:{payload,signature,issuerPublicKey},deviceRequest:request,deviceRemark:data.deviceRemark||''});}
 return {uploaded:true,files:ids.length,licenses:license?1:0};
}
async function initialize(){
  if(!safeStorage.isEncryptionAvailable())throw Error('Windows 安全存储不可用，无法保存本机密钥');
  const seal=data=>safeStorage.encryptString(Buffer.from(data).toString('base64'));
  const unseal=data=>Buffer.from(safeStorage.decryptString(Buffer.from(data)),'base64');
  const storageDir=path.join(app.getPath('userData'),'vault');
  const anchor=createLocalGuard({storageDir,anchorRoot:path.join(process.env.LOCALAPPDATA||app.getPath('appData'),'StarOrangeYingKey','anchors'),seal,unseal});
  engine=await createEngine({storageDir,deviceId:deviceId(),seal,unseal,anchor});
  try{const history=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'batch-history.json'),'utf8'));if(Array.isArray(history))batchHistory=history.slice(0,30);}catch{}
  onlineAdmin=await createOnlineAdmin({dataDir:app.getPath('userData'),seal,unseal});
  onlineTimer=setInterval(()=>engine.refreshOnlineSessions().catch(()=>{}),20000);onlineTimer.unref();
  checkpointTimer=setInterval(()=>engine.checkpoint().catch(()=>{}),15000);checkpointTimer.unref();
  media=await createMediaServer(engine);approvedInputs.add(demoPath);
  register('getDashboard',()=>normalized());
  register('connectOnline',async()=>{const cfg=await readJson([{name:'星橙·映钥服务连接',extensions:['yingserver']}]);if(!cfg)return null;return onlineAdmin.connect(cfg);});
  register('onlineStatus',()=>onlineAdmin.request('status'));
  register('uploadRecord',uploadRecords);
  register('openOnlineConsole',async()=>{const cfg=onlineAdmin.publicConfig;if(!cfg)throw Error('请先连接授权服务');await shell.openExternal(cfg.url+'/');});
  register('setOnlineEnabled',async({id,enabled})=>{const l=engine.getDashboard().licenses.find(x=>x.payload.id===id);if(!l?.payload.online)throw Error('这是一份离线许可，不能远程停用');return onlineAdmin.request('toggle',{id,enabled});});
  register('chooseVideo',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'浏览器可播放的视频',extensions:['mp4','m4v','webm','ogv']}]});if(r.canceled)return null;const p=r.filePaths[0],s=await fs.stat(p);approvedInputs.add(p);return {path:p,name:path.basename(p),size:s.size,mime:mimeFor(p)};});
  register('exportManagementReport',async()=>{const r=await dialog.showSaveDialog(win,{defaultPath:'映钥-文件管理清单.csv',filters:[{name:'CSV文件',extensions:['csv']}]});if(r.canceled)return null;const cell=v=>'"'+String(v??'').replace(/^\s*[=+@-]/,"'$&").replaceAll('"','""')+'"';const rows=[['视频编号','标题','分组','原文件名','原始字节数','文件位置'],...engine.getDashboard().catalog.map(v=>[v.videoId,v.title,v.groupName,v.filename,v.plainSize,v.filePath])];await fs.writeFile(r.filePath,'\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n'));return r.filePath;});
  register('editGroup',data=>engine.editGroup(data));
  register('assignGroup',data=>engine.assignGroup(data));
  register('removeGroup',id=>engine.removeGroup(id));
  register('chooseVideos',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile','multiSelections'],filters:[{name:'视频',extensions:['mp4','m4v','webm','ogv','mkv','mov']}]});if(r.canceled)return [];if(r.filePaths.length>1000)throw Error('每批最多1000个视频');return Promise.all(r.filePaths.map(async p=>{const s=await fs.stat(p);approvedInputs.add(p);return {path:p,name:path.basename(p),size:s.size,mime:mimeFor(p)};}));});
  register('chooseVideoFolder',async()=>{const r=await dialog.showOpenDialog(win,{title:'选择待加密视频目录',properties:['openDirectory']});if(r.canceled)return [];const root=await fs.realpath(r.filePaths[0]),items=[];const scan=async(dir,depth)=>{if(depth>12)throw Error('目录层级超过12层，请缩小选择范围');for(const entry of await fs.readdir(dir,{withFileTypes:true})){if(entry.isSymbolicLink())continue;const p=path.join(dir,entry.name);if(entry.isDirectory())await scan(p,depth+1);else if(entry.isFile()&&/\.(mp4|m4v|webm|ogv|mkv|mov)$/i.test(entry.name)){if(items.length>=1000)throw Error('目录中视频超过1000个，请分批选择');items.push({path:p,name:entry.name,size:(await fs.stat(p)).size,mime:mimeFor(p)});}}};await scan(root,0);items.sort((a,b)=>a.path.localeCompare(b.path,'zh-CN',{numeric:true}));items.forEach(x=>approvedInputs.add(x.path));return items;});
  register('cancelBatch',()=>{batchController?.abort();return {requested:true};});
  register('encryptBatch',async data=>{
   if(encryptionBusy||encryptionPreparing)throw Error('已有加密任务正在处理');if(!Array.isArray(data?.items)||!data.items.length||data.items.length>1000||data.items.some(x=>!approvedInputs.has(x.path)))throw Error('请先选择视频');const courseId=String(data.courseId||'').trim();if(!courseId||courseId.length>80)throw Error('请填写1至80字的分组名称');
   let r;encryptionPreparing=true;try{r=await dialog.showOpenDialog(win,{title:'选择批量加密输出文件夹',properties:['openDirectory']});}finally{encryptionPreparing=false;}if(r.canceled||shuttingDown)return null;
   encryptionBusy=true;batchController=new AbortController();let finish;activeEncryption=new Promise(resolve=>{finish=resolve;});try{const result=await runEncryptionBatch({items:data.items,directory:r.filePaths[0],courseId,signal:batchController.signal,encrypt:x=>encryptManaged({...x,previewSeconds:data.previewSeconds},x.outputPath,x.onProgress,x.signal),onProgress:p=>{win?.webContents.send('videokey:progress',{percent:((p.index-1)+p.percent/100)/p.total*100,message:`第 ${p.index}/${p.total} 个：${p.name} · ${Math.round(p.percent)}%`});}});knownFiles.add(result.folder);batchHistory.unshift(result);batchHistory=batchHistory.slice(0,30);await saveBatchHistory(result);return result;}finally{encryptionBusy=false;batchController=null;finish();activeEncryption=null;}
  });
  register('encrypt',async data=>{
   if(encryptionBusy||encryptionPreparing)throw Error('已有加密任务正在处理');if(!data||!approvedInputs.has(data.inputPath))throw Error('请先选择视频文件');const courseId=String(data.courseId||'').trim(),title=String(data.title||'').trim();if(!courseId||courseId.length>80||!title||title.length>120)throw Error('请填写课程名称和视频标题');
   let r;encryptionPreparing=true;try{r=await dialog.showSaveDialog(win,{defaultPath:path.join(app.getPath('videos'),clean(title)+'.vdrm'),filters:[{name:'星橙·映钥加密视频',extensions:['vdrm']}]});}finally{encryptionPreparing=false;}if(r.canceled||shuttingDown)return null;
   encryptionBusy=true;batchController=new AbortController();let finish;activeEncryption=new Promise(resolve=>{finish=resolve;});try{return await encryptManaged({...data,courseId,title},r.filePath,p=>win?.webContents.send('videokey:progress',{percent:p.percent,message:`已加密 ${Math.round(p.percent)}%`}),batchController.signal);}finally{encryptionBusy=false;batchController=null;finish();activeEncryption=null;}
  });
  register('getDeviceRequest',()=>engine.getDeviceRequest());
  register('exportDeviceRequest',()=>saveJson('星橙·映钥-设备请求.vdevice',engine.getDeviceRequest(),'vdevice'));
  register('loadDeviceRequest',()=>readJson([{name:'设备请求',extensions:['vdevice','json']}]));
  register('issueLicense',async function issueFromManager(data){if(issueBusy)throw Error('正在签发许可，请稍候');issueBusy=true;try{const cfg=data.onlineEnabled?onlineAdmin.publicConfig:null;if(data.onlineEnabled&&!cfg)throw Error('请先连接授权服务');const license=await engine.issueLicense({...data,online:cfg}),p=license.payload;return {id:p.id,deviceId:p.deviceId,videoIds:p.videos.map(v=>v.videoId),maxPlays:p.maxPlays,expiresAt:p.expiresAt,playsUsed:0,revoked:false};}finally{issueBusy=false;}});
  register('registerOnlineLicense',async id=>{const license=engine.getDashboard().licenses.find(x=>x.payload.id===id);if(!license?.payload.online)throw Error('不是在线许可');const request=await readJson([{name:'原始设备请求',extensions:['vdevice','json']}]);if(!request)return null;return onlineAdmin.request('register',{license,deviceRequest:request});});
  register('exportLicense',async(id)=>{const l=engine.getDashboard().licenses.find(l=>l.payload.id===id);if(!l)throw Error('找不到该许可');return saveJson('星橙·映钥-'+id.slice(0,8)+'.vlicense',{payload:l.payload,issuerPublicKey:l.issuerPublicKey,signature:l.signature},'vlicense');});
  register('importLicense',async()=>{const license=await readJson([{name:'播放许可',extensions:['vlicense','json']}]);if(!license)return null;const id=await engine.importLicense(license);return normalized().licenses.find(l=>l.id===id);});
  register('chooseContainer',async()=>{const r=await dialog.showOpenDialog(win,{properties:['openFile'],filters:[{name:'星橙·映钥加密视频',extensions:['vdrm']}]});if(r.canceled)return null;const filePath=r.filePaths[0],h=await engine.inspectVideo(filePath);approvedContainers.add(filePath);knownFiles.add(filePath);return {...h,filePath,size:h.plainSize};});
  register('openPlayback',async(data)=>{normalized();if(!data||!approvedContainers.has(data.filePath))throw Error('请先选择加密视频');if(openingPlayback)throw Error('正在验证，请稍候');openingPlayback=true;try{return media.add(await engine.openPlayback(data));}finally{openingPlayback=false;}});
  register('closePlayback',id=>media.remove(id));
  register('getSessionStatus',id=>engine.getSessionStatus(id));
  register('revokeLicense',id=>engine.revokeLicense(id));
  register('revealPath',async p=>{normalized();if(!knownFiles.has(p))throw Error('只能定位本应用打开或生成的文件');shell.showItemInFolder(p);});
  register('getEvidence',()=>({confirmed:['星橙·映钥由管理端和独立播放器组成。','设备许可包含签名保护的播放策略。','试看是截取生成的独立短片，未授权时不提供完整视频密钥。'],unknown:['Windows 捕获保护不能阻止摄像头拍摄或所有采集路径。','离线检测不能抵御管理员清除或恢复整套系统及防护标记。','旧离线许可无法远程召回；在线许可需播放器联网复查。'],design:['AES-256-GCM 分块认证加密；Ed25519 签名许可；RSA-OAEP 设备绑定。','动态水印、允许/禁止倍速及拖动由独立播放器按许可执行。','Windows 安全存储保护私钥；本机记录带完整性校验和独立回滚标记。'],sources:[]}));
  session.defaultSession.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false));
  win=new BrowserWindow({width:1360,height:900,minWidth:1080,minHeight:730,show:false,backgroundColor:'#f5f7fa',title:'星橙·映钥管理端',webPreferences:{preload:path.join(here,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,webSecurity:true,devTools:!app.isPackaged}});
  installChineseMenu();win.setIcon(path.resolve(here,'../assets/brand.png'));win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',(event,url)=>{if(url!==uiUrl)event.preventDefault();});
  win.once('ready-to-show',()=>win.show());win.on('closed',()=>{win=null;});
  await win.loadFile(path.join(here,'renderer','index.html'));
}
app.on('second-instance',()=>{if(win){if(win.isMinimized())win.restore();win.focus();}});
app.on('window-all-closed',()=>app.quit());
app.on('before-quit',event=>{if(!shuttingDown&&engine){event.preventDefault();shuttingDown=true;clearInterval(checkpointTimer);clearInterval(onlineTimer);Promise.resolve().then(()=>{batchController?.abort();return activeEncryption;}).then(()=>media?.close()).then(()=>engine.close()).finally(()=>app.quit());}});
if(lock)app.whenReady().then(initialize).catch(error=>{dialog.showErrorBox('星橙·映钥无法启动',error.message);app.quit();});

