import {randomUUID} from 'node:crypto';
export function createTeamWork({state,save}){
 state.workTasks??={};
 const actorOf=s=>s?{username:s.username,displayName:s.displayName||s.username}:null;
 const statuses=new Set(['running','complete','failed','cancelled','awaiting-save']);
 function fields(body){if(!body||typeof body.filename!=='string'||!body.filename.trim()||body.filename.length>1000||typeof body.courseId!=='string'||body.courseId.length>200||!statuses.has(body.status)||!Number.isSafeInteger(body.plainSize)||body.plainSize<0||typeof (body.error||'')!=='string'||(body.error||'').length>1000||body.videoId!=null&&(typeof body.videoId!=='string'||body.videoId.length>200))throw Error('任务记录格式无效');return {filename:body.filename,courseId:body.courseId,plainSize:body.plainSize,status:body.status,error:body.error||'',videoId:body.videoId||null};}
 function list(){return Object.values(state.workTasks).filter(t=>!t.deletedAt).map(t=>({...t,status:t.status==='running'&&Date.now()-Date.parse(t.updatedAt)>1800000?'unconfirmed':t.status,syncState:t.videoId&&state.files?.[t.videoId]?.status==='complete'?'registered':'task-only'})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));}
 return {actorOf,list,
  async start(body,actor,source){const input=fields({...body,status:'running'}),id=randomUUID(),now=new Date().toISOString();state.workTasks[id]={...input,id,createdAt:now,updatedAt:now,createdBy:actorOf(actor),updatedBy:actorOf(actor),source};await save();return {task:state.workTasks[id]};},
  async sync(body,actor,source){if(typeof body.id!=='string'||! /^[a-f0-9-]{36}$/i.test(body.id))throw Error('任务编号无效');const input=fields(body),old=state.workTasks[body.id];if(old&&old.createdBy?.username!==actor.username)throw Error('只能更新本人报送的加密任务');if(old?.deletedAt)return {task:old,deleted:true};const now=new Date().toISOString();state.workTasks[body.id]={...input,id:body.id,createdAt:old?.createdAt||now,updatedAt:now,createdBy:old?.createdBy||actorOf(actor),updatedBy:actorOf(actor),source:old?.source||source};await save();return {task:state.workTasks[body.id]};},
  async finish(body,actor){const old=state.workTasks[body.id];if(!old||old.deletedAt||old.createdBy?.username!==actor.username)throw Error('只能更新本人创建的加密任务');const input=fields({...old,...body});Object.assign(old,input,{updatedAt:new Date().toISOString(),updatedBy:actorOf(actor)});await save();return {task:old};},
  async heartbeat(id,actor){const t=state.workTasks[id];if(!t||t.deletedAt||t.createdBy?.username!==actor.username)throw Error('任务与当前员工不匹配');if(t.status==='running'){t.updatedAt=new Date().toISOString();await save();}return {ok:true};},
  async attach(taskId,videoId,actor){if(!taskId)return;const t=state.workTasks[taskId];if(!t||t.deletedAt||t.createdBy?.username!==actor.username||t.videoId&&t.videoId!==videoId)throw Error('加密任务与当前员工不匹配');t.videoId=videoId;await save();},
  async updateVideo(videoId,status,actor){for(const t of Object.values(state.workTasks))if(t.videoId===videoId&&!t.deletedAt){t.status=status;t.error='';t.updatedAt=new Date().toISOString();t.updatedBy=actorOf(actor);}await save();},
  owner(taskId,videoId){const t=state.workTasks[taskId];if(!t||t.videoId!==videoId||t.status!=='complete')return null;return t.createdBy;}
 };
}
