import {promises as fs} from 'node:fs';import path from 'node:path';import {randomUUID} from 'node:crypto';
export async function runEncryptionBatch({items,directory,courseId,signal,encrypt,onProgress=()=>{}}){
 if(!Array.isArray(items)||!items.length||items.length>1000)throw Error('请选择1至1000个视频');
 const folder=path.join(directory,'映钥批量-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+randomUUID().slice(0,8));await fs.mkdir(folder);
 const results=[],emit=p=>{try{onProgress(p);}catch{}};
 for(let i=0;i<items.length;i++){
  const input=items[i];if(signal?.aborted){results.push({inputPath:input.path,name:input.name,status:'cancelled'});continue;}
  const name=(input.name||path.basename(input.path)).replace(/\.[^.]+$/,'').replace(/[<>:"/\\|?*\x00-\x1f]/g,'_').slice(0,80)||'视频';const outputPath=path.join(folder,String(i+1).padStart(4,'0')+'-'+name+'.vdrm');
  try{const video=await encrypt({...input,inputPath:input.path,outputPath,courseId,title:name,signal,onProgress:p=>emit({...p,index:i+1,total:items.length,name:input.name})});results.push({inputPath:input.path,name:input.name,status:'complete',video});}
  catch(e){results.push({inputPath:input.path,name:input.name,status:signal?.aborted?'cancelled':'failed',error:e.message});}
  emit({index:i+1,total:items.length,percent:100,name:input.name});
 }
 return {id:randomUUID(),createdAt:new Date().toISOString(),folder,courseId,results};
}
