import {randomUUID} from 'node:crypto';
const valid=(s,max)=>typeof s==='string'&&s.trim().length>0&&s.length<=max&&!/[\x00-\x1f\x7f]/.test(s);
// Editable organization stays separate from authenticated video headers and licenses.
export function createGroups(state,entries){
 state.groups??=[];state.groupAssignments??={};
 const find=id=>state.groups.find(g=>g.id===id);
 const ensure=name=>{if(!valid(name,200))throw Error('分组名称须为1至200个字符');name=name.trim();let g=state.groups.find(g=>g.name.toLocaleLowerCase()===name.toLocaleLowerCase());if(!g){g={id:randomUUID(),name,note:'',createdAt:new Date().toISOString()};state.groups.push(g);}return g;};
 if(!state.groupsMigrated){for(const e of entries())if(e.courseId)state.groupAssignments[e.id]=ensure(e.courseId).id;state.groupsMigrated=true;}
 return {
  ensure,
  list:()=>state.groups.map(g=>({...g,count:entries().filter(e=>state.groupAssignments[e.id]===g.id).length})),
  forVideo(id){const g=find(state.groupAssignments[id]);return {groupId:g?.id||'',groupName:g?.name||'未分组'};},
  assign({videoIds,groupId}){if(!Array.isArray(videoIds)||!videoIds.length||videoIds.length>1000||videoIds.some(id=>!entries().some(e=>e.id===id)))throw Error('请选择有效视频记录');if(groupId!==''&&!find(groupId))throw Error('找不到目标分组');for(const id of videoIds){if(groupId)state.groupAssignments[id]=groupId;else delete state.groupAssignments[id];}},
  edit({id,name,note=''}){if(!valid(name,200)||typeof note!=='string'||note.length>300)throw Error('分组名称或备注无效');if(state.groups.some(g=>g.id!==id&&g.name.toLocaleLowerCase()===name.trim().toLocaleLowerCase()))throw Error('分组名称已存在');if(!id){const g=ensure(name);g.note=note;return g;}const g=find(id);if(!g)throw Error('找不到分组');g.name=name.trim();g.note=note;return g;},
  remove(id){if(!find(id))throw Error('找不到分组');if(entries().some(e=>state.groupAssignments[e.id]===id))throw Error('请先移出组内视频，再删除空分组');state.groups=state.groups.filter(g=>g.id!==id);},
 };
}
