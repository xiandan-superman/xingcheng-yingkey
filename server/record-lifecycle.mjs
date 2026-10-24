export function createRecordLifecycle({state,save,audit}){
 const stores={task:'workTasks',file:'files',license:'licenses'};
 const permission=(record,kind,actor)=>{if(!actor||actor.role==='viewer'||kind==='license'&&actor.role!=='admin'||actor.role!=='admin'&&record.createdBy?.username!==actor.username)throw Object.assign(Error('仅管理员或记录创建者可执行此操作；授权删除与恢复仅限管理员'),{status:403});};
 const entry=(kind,id)=>{if(!Object.hasOwn(stores,kind)||typeof id!=='string'||!Object.hasOwn(state[stores[kind]]||{},id))throw Error('记录类型或编号无效或找不到记录');return state[stores[kind]][id];};
 function checkDelete(kind,id,actor){const r=entry(kind,id);permission(r,kind,actor);if(r.deletedAt)return r;
  if(kind==='task'&&['running','awaiting-save'].includes(r.status)&&Date.now()-Date.parse(r.updatedAt)<1800000)throw Error('任务仍在处理或等待保存，请先结束任务再删除');
  if(kind==='file'){
   if(Object.values(state.workTasks||{}).some(t=>t.videoId===id&&!t.deletedAt&&['running','awaiting-save'].includes(t.status)&&Date.now()-Date.parse(t.updatedAt)<1800000))throw Error('文件仍有关联的进行中任务，请先结束任务');
   const count=Object.values(state.licenses).filter(l=>!l.deletedAt&&l.license.payload.videos.some(v=>v.videoId===id)).length;if(count)throw Error('该文件关联'+count+'份授权，请先由管理员删除关联授权，再删除文件记录');
  }return r;
 }
 return {
  async remove({kind,id,ids,reason=''},actor){const list=ids??[id];if(!Array.isArray(list)||!list.length||list.length>100||new Set(list).size!==list.length||typeof reason!=='string'||reason.length>300)throw Error('请选择1至100条不同记录');const rows=list.map(id=>checkDelete(kind,id,actor)),now=new Date().toISOString();for(let n=0;n<rows.length;n++){const r=rows[n];if(r.deletedAt)continue;r.deletedAt=now;r.deletedBy={username:actor.username,displayName:actor.displayName||actor.username};r.deleteReason=reason;if(kind==='license'){r.enabled=false;for(const s of Object.values(state.sessions))if(s.licenseId===list[n])s.revoked=true;}audit('删除'+{task:'加密任务',file:'文件记录',license:'授权并终止在线播放'}[kind],list[n],'网页控制台',actor.username);}await save();return {ok:true,deleted:list.length};},
  async restore({kind,id},actor){const r=entry(kind,id);permission(r,kind,actor);if(!r.deletedAt)throw Error('该记录未删除');if(kind==='license'&&r.license.payload.videos.some(v=>state.files?.[v.videoId]?.deletedAt))throw Error('请先恢复关联文件记录，再恢复授权');delete r.deletedAt;delete r.deletedBy;delete r.deleteReason;if(kind==='license')r.enabled=false;audit('从回收站恢复'+{task:'加密任务',file:'文件记录',license:'授权（保持停用）'}[kind],id,'网页控制台',actor.username);await save();return {ok:true,enabled:kind==='license'?false:undefined};},
  list(actor){const result=[];for(const [kind,store]of Object.entries(stores))for(const [id,r]of Object.entries(state[store]||{})){if(!r.deletedAt||actor.role!=='admin'&&(kind==='license'||r.createdBy?.username!==actor.username))continue;result.push({kind,id,label:kind==='file'?r.fileLabel||r.header.filename:kind==='task'?r.filename:r.label||r.license.payload.videos.map(v=>v.courseId).join('、'),deletedAt:r.deletedAt,deletedBy:r.deletedBy,reason:r.deleteReason||'',playsUsed:kind==='license'?r.playsUsed:undefined});}return result.sort((a,b)=>b.deletedAt.localeCompare(a.deletedAt));}
 };
}
