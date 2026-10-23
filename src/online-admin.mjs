import {promises as fs} from 'node:fs';
import path from 'node:path';
import {onlineConfig,postJson} from './core/online.mjs';
export async function createOnlineAdmin({dataDir,seal,unseal}){
 const file=path.join(dataDir,'online-admin.sealed');let cfg=null,recoveryMessage=null;
 try{const loaded=JSON.parse(Buffer.from(await unseal(await fs.readFile(file))).toString().replace(/^\uFEFF/,''));onlineConfig(loaded);if(typeof loaded.adminToken!=='string'||loaded.adminToken.length<32)throw Error('管理凭据无效');cfg=loaded;}catch(e){if(e.code!=='ENOENT')recoveryMessage='已保存的服务器连接配置无法读取，请重新导入服务连接文件。原有视频和许可仍保留。';}
 return {
  get publicConfig(){return cfg?onlineConfig(cfg):null;},
  get recoveryMessage(){return recoveryMessage;},
  async connect(value){const validated=onlineConfig(value);if(typeof value.adminToken!=='string'||value.adminToken.length<32)throw Error('管理凭据无效');const next={...validated,adminToken:value.adminToken};const result=await postJson(next.url+'/admin/status',{},next.adminToken);if(result.publicKey!==next.publicKey)throw Error('服务器身份不匹配');const temp=file+'.tmp';try{await fs.writeFile(temp,await seal(Buffer.from(JSON.stringify(next))));await fs.rename(temp,file);}finally{await fs.rm(temp,{force:true}).catch(()=>{});}cfg=next;recoveryMessage=null;return {connected:true,licenses:result.licenses};},
  async request(action,body={}){if(!cfg)throw Error('请先连接授权服务');return postJson(cfg.url+'/admin/'+action,body,cfg.adminToken);},
 };
}
