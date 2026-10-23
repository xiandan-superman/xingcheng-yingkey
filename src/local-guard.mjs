import {promises as fs} from 'node:fs';
import path from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
export function createLocalGuard({storageDir,anchorRoot,seal,unseal}){
 const id=createHash('sha256').update(path.resolve(storageDir).toLowerCase()).digest('hex').slice(0,32);
 const file=path.join(anchorRoot,id+'.anchor'),registry='HKCU\\Software\\StarOrange\\YingKey\\Anchors';
 const reg=path.join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe');
 const options={encoding:'utf8',windowsHide:true,timeout:5000,stdio:['ignore','pipe','pipe']};
 async function decode(raw){try{return JSON.parse(Buffer.from(await unseal(Buffer.from(raw,'base64'))).toString('utf8'));}catch{throw Error('本机防回滚标记损坏，已停止授权验证');}}
 return {
  async load(){const marks=[];try{marks.push(await decode(await fs.readFile(file,'utf8')));}catch(e){if(e.code!=='ENOENT')throw e;}
   if(process.platform==='win32'){try{const result=execFileSync(reg,['query',registry,'/v',id],options);const v=result.match(/REG_SZ\s+(\S+)/)?.[1];if(v)marks.push(await decode(v));}catch(e){if(!e.status)throw e;}}
   if(!marks.length)return null;
   if(marks.some(m=>m.key!==marks[0].key||!Number.isSafeInteger(m.revision)||!Number.isFinite(m.maxTime)))throw Error('本机防回滚标记不一致');
   marks.sort((a,b)=>b.revision-a.revision);return {...marks[0],maxTime:Math.max(...marks.map(m=>m.maxTime))};
  },
  async commit(mark){const data=Buffer.from(await seal(Buffer.from(JSON.stringify(mark)))).toString('base64');await fs.mkdir(anchorRoot,{recursive:true});
   if(process.platform==='win32')execFileSync(reg,['add',registry,'/v',id,'/t','REG_SZ','/d',data,'/f'],options);
   const temp=file+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,data,{mode:0o600});await fs.rename(temp,file);
  }
 };
}
