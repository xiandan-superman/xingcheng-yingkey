const {contextBridge,ipcRenderer}=require('electron');
const names=['getState','exportRequest','importLicense','chooseVideo','chooseVideos','play','preview','close','status'];
contextBridge.exposeInMainWorld('viewer',Object.freeze(Object.fromEntries(names.map(n=>[n,(...args)=>ipcRenderer.invoke('viewer:'+n,...args)]))));
