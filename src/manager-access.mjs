export function createManagerAccess({onlineAdmin}){
 let person=null,message='请先使用量子星橙账号登录管理端。',pending,generation=0;
 const view=()=>({required:true,authenticated:Boolean(person),message:person?'':message});
 async function refresh(){if(pending)return pending;const revision=generation;pending=(async()=>{if(!onlineAdmin.isCentralSession){person=null;message='请先使用量子星橙账号登录管理端。';return null;}try{const current=await onlineAdmin.verifyEmployee();if(revision!==generation)return null;if(!current||!['admin','operator'].includes(current.role)){person=null;message='当前账号没有管理端操作权限，请联系管理员在账号中心开通映钥操作权限。';return null;}person=current;message='';return person;}catch(error){if(revision===generation){person=null;message='员工登录已失效或暂时无法验证，请重新登录。'+(error?.message||'');}return null;}})();try{return await pending;}finally{pending=null;}}
 return {get state(){return view();},get identity(){return person;},refresh,clear(){generation++;person=null;message='已退出管理端，请重新登录。';},async require(){const current=await refresh();if(!current)throw Error(message);return current;}};
}
