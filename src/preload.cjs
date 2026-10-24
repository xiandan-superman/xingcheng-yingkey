const {contextBridge,ipcRenderer}=require('electron');
const methods=['loginEmployee','logoutEmployee','syncWorkTasks','chooseVideoFolder','exportManagementReport','chooseVideos','encryptBatch','cancelBatch','editGroup','assignGroup','removeGroup','getDashboard','chooseVideo','encrypt','getDeviceRequest','exportDeviceRequest','loadDeviceRequest','issueLicense','exportLicense','importLicense','chooseContainer','openPlayback','closePlayback','getSessionStatus','revokeLicense','revealPath','getEvidence','uploadRecord','connectOnline','openOnlineConsole','onlineStatus','setOnlineEnabled','registerOnlineLicense'];
const api=Object.fromEntries(methods.map(name=>[name,(...args)=>ipcRenderer.invoke('videokey:'+name,...args)]));
api.onProgress=callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('videokey:progress',listener);return()=>ipcRenderer.removeListener('videokey:progress',listener);};
contextBridge.exposeInMainWorld('desktop',Object.freeze(api));


