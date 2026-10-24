import {promises as fs} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export async function createWorkLog({dataDir,onlineAdmin}){
 const file=path.join(dataDir,'work-history.json');let tasks=[],licenseAuthors={},queue=Promise.resolve();
 try{const data=JSON.parse(await fs.readFile(file,'utf8'));if(Array.isArray(data))tasks=data;else if(Array.isArray(data.tasks)){tasks=data.tasks;licenseAuthors=data.licenseAuthors||{};}else throw Error('invalid');}catch(e){if(e.code!=='ENOENT')throw Error('加密任务历史无法读取，请保留原文件并联系管理员，勿重复加密。');}
 const persist=()=>{const data=JSON.stringify({tasks,licenseAuthors});const p=queue.then(async()=>{const temp=file+'.tmp';await fs.writeFile(temp,data);await fs.rename(temp,file);});queue=p.catch(()=>{});return p;};
 for(const t of tasks)if(t.status==='running'){t.status='failed';t.error='上次程序退出时任务未完成，请核对输出文件后重试';t.syncState=t.createdBy?'pending':'local-only';}
 if(tasks.length)await persist();
 const publicTask=t=>({...t});
 let syncPromise=null;
 const api={licenseAuthor:id=>licenseAuthors[id]||null,async noteLicense(id,actor){licenseAuthors[id]=actor?{username:actor.username,displayName:actor.displayName||actor.username}:null;await persist();},list:()=>tasks.map(publicTask),forVideo:id=>tasks.find(t=>t.videoId===id),
  async begin({inputPath,courseId,plainSize}){const identity=await onlineAdmin.verifyEmployee();if(identity?.role==='viewer')throw Error('只读成员不能加密或签发许可');const now=new Date().toISOString(),t={id:randomUUID(),filename:path.basename(inputPath),courseId,plainSize,status:'running',createdAt:now,updatedAt:now,createdBy:identity?{username:identity.username,displayName:identity.displayName||identity.username}:null,source:'desktop',syncState:identity?'pending':'local-only',error:''};tasks.unshift(t);await persist();return t.id;},
  async finish(id,{video,error,cancelled=false}){const t=tasks.find(t=>t.id===id);Object.assign(t,{status:error?(cancelled?'cancelled':'failed'):'complete',videoId:video?.videoId||null,error:String(error?.message||'').slice(0,1000),updatedAt:new Date().toISOString(),syncState:t.createdBy?'pending':'local-only'});await persist();},
  async sync(){if(syncPromise)return syncPromise;const run=async()=>{const identity=onlineAdmin.identity;if(!identity)return;do{for(const t of tasks.filter(t=>['pending','failed'].includes(t.syncState)&&t.createdBy?.username===identity.username)){const before=JSON.stringify(t);try{await onlineAdmin.request('task-sync',{id:t.id,filename:t.filename,courseId:t.courseId,plainSize:t.plainSize,status:t.status,error:t.error,videoId:t.videoId},identity.username);if(JSON.stringify(t)===before){t.syncState='synced';t.syncError='';}}catch(e){t.syncState='failed';t.syncError=e.message;}await persist();}}while(tasks.some(t=>t.syncState==='pending'&&t.createdBy?.username===identity.username));};syncPromise=run();try{await syncPromise;}finally{syncPromise=null;}},
  async heartbeat(){let changed=false;for(const t of tasks)if(t.status==='running'&&t.createdBy){t.updatedAt=new Date().toISOString();t.syncState='pending';changed=true;}if(changed)await persist();},
  async markRegistered(videoId){const t=tasks.find(t=>t.videoId===videoId);if(t){t.registeredAt=new Date().toISOString();await persist();}},
  async flush(){await queue;}
 };return api;
}
