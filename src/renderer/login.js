'use strict';
const signIn=document.querySelector('#sign-in'),cancel=document.querySelector('#cancel'),status=document.querySelector('#status');
let pending=false;
function message(text,error=false){status.textContent=text;status.classList.toggle('error',error);}
function describe(error){const text=error?.message||String(error||'');if(/aborted|取消/.test(text))return ['已取消登录',false];if(/权限|只读/.test(text))return ['当前账号无操作权限，请联系管理员',true];if(/fetch|网络|连接|验证|timeout/i.test(text))return ['连接失败，请重试',true];if(/失效|过期|停用/.test(text))return ['登录已失效，请重新登录',true];if(/处理中|任务/.test(text))return ['当前任务完成后再试',true];return ['登录未完成，请重试',true];}
function applyState(state){if(pending)return;signIn.disabled=Boolean(state.checking);if(state.checking){message('正在确认登录…');return;}if(state.authenticated){signIn.disabled=true;message('正在进入…');return;}const text=state.message||'';if(/没有管理端操作权限/.test(text))message('当前账号无操作权限，请联系管理员',true);else if(/失效|无法验证/.test(text))message('登录已失效，请重新登录',true);else message('');if(document.activeElement===document.body)signIn.focus();}
signIn.onclick=async()=>{if(pending)return;pending=true;let completed=false;signIn.disabled=true;signIn.textContent='等待登录…';cancel.hidden=false;cancel.disabled=false;message('请在浏览器中完成登录');try{await window.loginApi.signIn();completed=true;message('正在进入…');}catch(error){message(...describe(error));}finally{pending=false;signIn.disabled=completed;signIn.textContent='登录';cancel.hidden=true;}};
cancel.onclick=async()=>{cancel.disabled=true;try{await window.loginApi.cancel();}catch{message('取消失败，请重试',true);cancel.disabled=false;}};
window.loginApi.onState(applyState);
window.loginApi.getState().then(applyState).catch(()=>{signIn.disabled=false;message('连接失败，请重试',true);});
