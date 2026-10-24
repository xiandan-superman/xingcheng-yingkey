const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('loginApi',{
 getState:()=>ipcRenderer.invoke('videokey:getLoginState'),
 signIn:data=>ipcRenderer.invoke('videokey:loginEmployeeSso',data),
 cancel:()=>ipcRenderer.invoke('videokey:cancelEmployeeSso'),
 onState:callback=>{const listener=(_event,state)=>callback(state);ipcRenderer.on('videokey:login-state',listener);return()=>ipcRenderer.removeListener('videokey:login-state',listener);}
});
