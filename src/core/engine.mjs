import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createHash, createHmac, timingSafeEqual, randomBytes, randomUUID, generateKeyPairSync, createCipheriv, createDecipheriv, createPublicKey, publicEncrypt, privateDecrypt, sign, verify, constants } from 'node:crypto';
import {createGroups} from './groups.mjs';
import {playbackPolicy} from './policy.mjs';
import {checkContainerCompatibility} from './container-compatibility.mjs';
import {onlineConfig,requestLease} from './online.mjs';


async function replaceStateFile(source,target){const delays=[25,50,100,200];for(let attempt=0;;attempt++){try{return await fs.rename(source,target);}catch(error){if(!['EPERM','EBUSY'].includes(error.code)||attempt>=delays.length)throw error;await new Promise(resolve=>setTimeout(resolve,delays[attempt]));}}}
const MAGIC = Buffer.from('VDRM001\n');
const CHUNK = 1024 * 1024;
const MIME_TYPES=new Set(['video/mp4','video/webm','video/x-matroska','video/quicktime','video/x-msvideo','video/mpeg','video/ogg','video/mp2t','video/x-ms-wmv','application/octet-stream']);
const safeText=(v,max=1000)=>typeof v==='string'&&v.length>0&&v.length<=max&&!/[\x00-\x1f\x7f]/.test(v);
const canonical = x => JSON.stringify(x, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
const hash = x => createHash('sha256').update(x).digest();
const fail = message => { throw new Error(message); };
function ivFor(prefix,index) { const iv=Buffer.alloc(12); Buffer.from(prefix,'base64').copy(iv); iv.writeUInt32BE(index,8); return iv; }
function aadFor(headerHash,index) { const b=Buffer.alloc(36); headerHash.copy(b); b.writeUInt32BE(index,32); return b; }
async function exact(handle,length,position) { const b=Buffer.alloc(length); let n=0; while(n<length) { const r=await handle.read(b,n,length-n,position+n); if(!r.bytesRead) fail('文件不完整或已损坏'); n+=r.bytesRead; } return b; }
async function readHeader(filePath) {
  const f=await fs.open(filePath,'r');
  try {
    const pre=await exact(f,12,0);
    if(!pre.subarray(0,8).equals(MAGIC)) fail('不是本原型支持的视频文件');
    const length=pre.readUInt32BE(8); if(length<2||length>65536) fail('视频文件头无效');
    const raw=await exact(f,length,12); let h; try { h=JSON.parse(raw); } catch { fail('视频文件头无效'); }
    if(![1,2].includes(h.version)||h.chunkSize!==CHUNK||!Number.isSafeInteger(h.plainSize)||h.plainSize<0||h.chunks!==Math.max(1,Math.ceil(h.plainSize/CHUNK))||h.chunks>0xffffffff||typeof h.noncePrefix!=='string'||Buffer.from(h.noncePrefix,'base64').length!==8||typeof h.issuerPublicKey!=='string'||typeof h.videoId!=='string') fail('视频格式参数无效');
    if(!safeText(h.videoId,200)||!safeText(h.courseId,200)||!safeText(h.title)||!safeText(h.filename)||!MIME_TYPES.has(h.mime)||h.issuerPublicKey.length>4096) fail('视频元数据无效');
    if(h.preview&&(!Number.isSafeInteger(h.preview.size)||h.preview.size<1||h.preview.size>50*1024*1024||!Number.isInteger(h.preview.seconds)||h.preview.seconds<1||h.preview.seconds>120||!/^[a-f0-9]{64}$/.test(h.preview.sha256)))fail('试看参数无效');
    const st=await f.stat(); if(st.size!==12+length+h.plainSize+h.chunks*16+(h.preview?.size||0)) fail('视频文件长度不符，可能已损坏');
    return {header:h,hash:hash(raw),offset:12+length};
  } finally { await f.close(); }
}

/** Independent demonstration format; not compatible with third-party DRM. */
export async function createEngine({storageDir,deviceId,seal,unseal,role='manager',anchor=null,fetchLease}) {
  if(!['manager','player'].includes(role)) fail('应用角色无效');
  if(!storageDir||!deviceId||typeof seal!=='function'||typeof unseal!=='function') fail('需要存储目录、设备标识及安全存储接口');
  await fs.mkdir(storageDir,{recursive:true});
  const statePath=path.join(storageDir,'state.json'); let state;
  let guard=anchor?await anchor.load():null,guardError=null;
  const guardKey=anchor?Buffer.from(guard?.key||randomBytes(32).toString('base64'),'base64'):null;
  let maxTime=guard?.maxTime||Date.now();const boot=Math.max(Date.now(),maxTime),mono=process.hrtime.bigint();
  const mac=s=>{const {integrity,...unsigned}=s;return createHmac('sha256',guardKey).update(canonical(unsigned)).digest('hex');};
  function now(){if(!anchor)return Date.now();if(guardError)fail(guardError);const wall=Date.now(),expected=boot+Number(process.hrtime.bigint()-mono)/1e6;maxTime=Math.max(maxTime,wall,expected);if(wall<maxTime-120000)fail('检测到系统时间回拨，请恢复正确时间后重启播放器');return maxTime;}
  const protect=async v => Buffer.from(await seal(Buffer.from(v))).toString('base64');
  const reveal=async v => Buffer.from(await unseal(Buffer.from(v,'base64')));
  let saving=Promise.resolve();
  async function save() {if(anchor){now();state.revision=(state.revision||0)+1;state.integrity=mac(state);}const snapshot=structuredClone(state),data=JSON.stringify(snapshot,null,2);const mark=anchor?{key:guardKey.toString('base64'),revision:snapshot.revision,maxTime}:null;
   const op=saving.catch(()=>{}).then(async()=>{const temp=statePath+'.'+randomUUID()+'.tmp';await fs.writeFile(temp,data,{mode:0o600});await replaceStateFile(temp,statePath);if(anchor){try{await anchor.commit(mark);guard=mark;}catch(e){guardError='防回滚记录写入失败，已停止授权验证';e.yingkeyStatePersisted=true;throw e;}}});saving=op;return op;}
  try { state=JSON.parse(await fs.readFile(statePath,'utf8')); if(state.version!==1) fail('本地存储版本不支持'); }
  catch(e) {
    if(e.code!=='ENOENT') throw e;
    if(guard)fail('授权数据被删除或回滚，无法安全恢复播放次数');
    const issuer=role==='manager'?generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}}):null;
    const device=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});
    state={version:1,role,deviceId,...(issuer?{issuerPublicKey:issuer.publicKey,issuerPrivateKey:await protect(issuer.privateKey)}:{}),devicePublicKey:device.publicKey,devicePrivateKey:await protect(device.privateKey),catalog:[],licenses:[],counts:{},revoked:[]}; await save();
  }
  if(state.deviceId!==deviceId) fail('本地数据属于另一台设备');
  if((state.role||'manager')!==role) fail('管理端和播放器的数据目录不能混用');
  if(anchor){if(guard){const actual=Buffer.from(state.integrity||'','hex'),expected=Buffer.from(mac(state),'hex');if(actual.length!==expected.length||!timingSafeEqual(actual,expected))fail('授权记录完整性校验失败，可能已被修改');if(state.revision<guard.revision||state.revision>guard.revision+1)fail('检测到授权数据回滚');now();if(state.revision!==guard.revision)await anchor.commit({...guard,revision:state.revision,maxTime});}else{if(state.integrity)fail('本机防回滚标记已丢失，不能自动重置次数');await save();}}
  const migrateGroups=role==='manager'&&!state.groupsMigrated;
  const groups=role==='manager'?createGroups(state,()=>state.catalog.map(v=>({id:v.videoId,courseId:v.courseId}))):null;
  if(migrateGroups)await save();
  async function changeGroups(fn){const previous={groups:structuredClone(state.groups),assignments:structuredClone(state.groupAssignments)};try{const result=fn();await save();return result;}catch(e){if(!e.yingkeyStatePersisted){state.groups=previous.groups;state.groupAssignments=previous.assignments;}throw e;}}
  const sessions=new Map();
  const deviceRequest=()=>({deviceId,publicKey:state.devicePublicKey});
  function validateLicense(license) {
    if(!license||typeof license!=='object'||!license.payload||typeof license.signature!=='string'||typeof license.issuerPublicKey!=='string') fail('许可格式无效');
    if(canonical(license).length>1024*1024||license.signature.length>256||license.issuerPublicKey.length>4096) fail('许可文件过大或格式无效');
    let valid=false; try { valid=verify(null,Buffer.from(canonical(license.payload)),license.issuerPublicKey,Buffer.from(license.signature,'base64')); } catch {}
    if(!valid) fail('许可签名无效，文件可能被修改');
    const p=license.payload;
    if(p.deviceId!==deviceId) fail('许可不属于当前设备');
    if(![1,2,3].includes(p.version)||!p.id||!Array.isArray(p.videos)||!Number.isInteger(p.maxPlays)||p.maxPlays<1||(p.expiresAt!==null&&!Number.isFinite(Date.parse(p.expiresAt)))||(p.version>=2&&!p.policy)) fail('许可参数无效');
    if(p.version===3)onlineConfig(p.online);
    if(!safeText(p.id,200)||!p.videos.length||p.videos.length>1000||p.maxPlays>1000000000||new Set(p.videos.map(v=>v?.videoId)).size!==p.videos.length||p.videos.some(v=>!v||!safeText(v.videoId,200)||!safeText(v.courseId,200)||typeof v.wrappedKey!=='string'||v.wrappedKey.length!==344||Buffer.from(v.wrappedKey,'base64').length!==256)) fail('许可视频条目或次数无效');
    if(p.expiresAt!==null&&Date.parse(p.expiresAt)<=now()) fail('许可已过期');
    playbackPolicy(p.policy,p.policy==null);
    if(state.revoked.includes(p.id)) fail('许可已被本机吊销');
    return p;
  }
  function activeSession(id) {now();const s=sessions.get(id); if(!s) fail('播放会话不存在或已关闭');if(s.onlineError)fail(s.onlineError);if(s.onlineDeadline&&performance.now()>=s.onlineDeadline)fail('无法连接授权服务器，断网宽限已到期，请联网后重新验证');if(!s.previewBuffer)validateLicense(s.license);return s; }
  async function lease(license,videoId,sessionId,attemptId){return requestLease({license,videoId,sessionId,attemptId,fetchLease,proof:async text=>{const pk=await reveal(state.devicePrivateKey);try{return sign('sha256',Buffer.from(text),pk).toString('base64');}finally{pk.fill(0);}}});}
  async function decryptChunk(s,index,f) {
    const len=Math.min(CHUNK,s.info.header.plainSize-index*CHUNK);
    const raw=await exact(f,len+16,s.info.offset+index*(CHUNK+16));
    try { const d=createDecipheriv('aes-256-gcm',s.key,ivFor(s.info.header.noncePrefix,index)); d.setAAD(aadFor(s.info.hash,index)); d.setAuthTag(raw.subarray(len)); return Buffer.concat([d.update(raw.subarray(0,len)),d.final()]); }
    catch { fail('视频完整性校验失败，内容可能被篡改'); }
  }
  function bounds(s,start,end) {
    const size=s.info.header.plainSize; start??=0; end??=size-1;
    if(size===0&&start===0&&end===-1) return {start,end};
    if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=size) fail('请求的视频字节范围无效');
    return {start,end};
  }
  const api = {
    getDeviceRequest:deviceRequest,
    getDashboard() { return structuredClone({deviceId,deviceRequest:deviceRequest(),groups:groups?.list()||[],catalog:state.catalog.map(({sealedKey,...v})=>({...v,...groups?.forVideo(v.videoId)})),licenses:state.licenses.map(l=>({...l,playsUsed:state.counts[l.payload.id]||0,revoked:state.revoked.includes(l.payload.id)}))}); },
    async editGroup(data){return changeGroups(()=>structuredClone(groups.edit(data)));},
    async assignGroup(data){await changeGroups(()=>groups.assign(data));},
    async removeGroup(id){await changeGroups(()=>groups.remove(id));},
    async inspectVideo(filePath) { return (await readHeader(filePath)).header; },
    getSessionStatus(sessionId) {try {const s=activeSession(sessionId);return {valid:true,reason:'',clockTime:now(),policy:s.policy,preview:Boolean(s.previewBuffer)};}catch(e){return {valid:false,reason:e.message};}},
    checkpoint(){return save();},
    async exportCloudRecord({videoId,envelopePublicKey,fileLabel,note='',allowWebIssue=false}){const v=state.catalog.find(x=>x.videoId===videoId);if(!v)fail('找不到加密文件记录');const pub=createPublicKey(envelopePublicKey);if(pub.asymmetricKeyType!=='rsa'||pub.asymmetricKeyDetails.modulusLength!==2048)fail('服务器封装公钥无效');const {sealedKey,filePath,...header}=v,key=await reveal(sealedKey);let wrappedKey,wrappedIssuer;try{wrappedKey=publicEncrypt({key:pub,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64');}finally{key.fill(0);}const pk=await reveal(state.issuerPrivateKey);try{if(allowWebIssue)wrappedIssuer=publicEncrypt({key:pub,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},pk).toString('base64');const record={header,wrappedKey,fileLabel:fileLabel||header.filename.slice(0,200),note,groupName:groups.forVideo(videoId).groupId?groups.forVideo(videoId).groupName:null,...(wrappedIssuer?{wrappedIssuer}:{})};return {record,proof:sign(null,Buffer.from(canonical(record)),pk).toString('base64')};}finally{pk.fill(0);}},
    async refreshOnlineSessions(){await Promise.all([...sessions.values()].filter(s=>s.onlineSessionId&&!s.checking&&!s.onlineError).map(async s=>{s.checking=true;const started=performance.now();try{const p=await lease(s.license,s.info.header.videoId,s.onlineSessionId);s.onlineDeadline=started+p.ttlMs;state.counts[s.license.payload.id]=Math.max(state.counts[s.license.payload.id]||0,p.playsUsed);await save();}catch(e){if(!e.networkUnavailable)s.onlineError=e.message;}finally{s.checking=false;}}));},
    async encryptVideo({inputPath,outputPath,courseId='default',title,mime='video/mp4',onProgress,previewPath,previewSeconds,signal}) {
      if(path.resolve(inputPath).toLowerCase()===path.resolve(outputPath).toLowerCase()) fail('输出文件不能覆盖原视频');
      if(!safeText(courseId,200)||!safeText(title||path.basename(inputPath))||!safeText(path.basename(inputPath))||!MIME_TYPES.has(mime)) fail('视频名称、课程或媒体类型无效');
      const src=await fs.open(inputPath,'r'); let dst; let created=false,addedVideoId=null,createdGroupId=null,statePersisted=false;
      const key=randomBytes(32);
      try {
        const stat=await src.stat(); if(!stat.isFile()||!Number.isSafeInteger(stat.size)) fail('输入必须是普通视频文件');
        const h={version:2,videoId:randomUUID(),courseId,title:title||path.basename(inputPath),filename:path.basename(inputPath),mime,plainSize:stat.size,chunkSize:CHUNK,chunks:Math.max(1,Math.ceil(stat.size/CHUNK)),noncePrefix:randomBytes(8).toString('base64'),issuerPublicKey:state.issuerPublicKey};
        if(h.chunks>0xffffffff) fail('视频文件过大');
        let preview;if(previewPath){const st=await fs.stat(previewPath);if(st.size>50*1024*1024||!Number.isInteger(previewSeconds)||previewSeconds<1||previewSeconds>120)fail('试看文件或时长无效');preview=await fs.readFile(previewPath);h.preview={size:preview.length,seconds:previewSeconds,sha256:hash(preview).toString('hex')};}
        const raw=Buffer.from(canonical(h)); if(raw.length>65536) fail('视频元数据过长'); const pre=Buffer.alloc(12); MAGIC.copy(pre); pre.writeUInt32BE(raw.length,8); const hh=hash(raw);
        dst=await fs.open(outputPath,'wx',0o600); created=true; await dst.writeFile(Buffer.concat([pre,raw]));
        for(let i=0;i<h.chunks;i++) {if(signal?.aborted)throw Error('任务已取消');const b=await exact(src,Math.min(CHUNK,stat.size-i*CHUNK),i*CHUNK); const c=createCipheriv('aes-256-gcm',key,ivFor(h.noncePrefix,i)); c.setAAD(aadFor(hh,i)); await dst.writeFile(Buffer.concat([c.update(b),c.final(),c.getAuthTag()])); if(typeof onProgress==='function') {const processedBytes=Math.min(stat.size,(i+1)*CHUNK);try {await onProgress({percent:stat.size?processedBytes/stat.size*100:100,processedBytes,totalBytes:stat.size});}catch{}}}
        if(preview)await dst.writeFile(preview);
        await dst.sync(); await dst.close(); dst=null;
        const sealedKey=await protect(key),existingGroupIds=new Set(state.groups.map(g=>g.id)),group=groups.ensure(courseId);if(!existingGroupIds.has(group.id))createdGroupId=group.id;
        state.catalog.push({...h,filePath:path.resolve(outputPath),sealedKey});addedVideoId=h.videoId;groups.assign({videoIds:[h.videoId],groupId:group.id}); await save();statePersisted=true; return {...h,filePath:path.resolve(outputPath)};
      } catch(e) { if(dst) await dst.close().catch(()=>{});const committed=statePersisted||e.yingkeyStatePersisted;
        if(!committed){if(addedVideoId){state.catalog=state.catalog.filter(v=>v.videoId!==addedVideoId);delete state.groupAssignments[addedVideoId];}if(createdGroupId&&!Object.values(state.groupAssignments).includes(createdGroupId))state.groups=state.groups.filter(g=>g.id!==createdGroupId);if(created)await fs.unlink(outputPath).catch(()=>{});}
        else{e.yingkeySaved=true;e.yingkeyOutputPath=path.resolve(outputPath);}
        if(e.code==='EEXIST') fail('输出文件已存在，请选择新文件名'); throw e; }
      finally { key.fill(0); await src.close(); }
    },
    async issueLicense({deviceRequest:request=deviceRequest(),videoIds,expiresAt,maxPlays=10,policy,online}) {
      if(!safeText(request.deviceId,200)||typeof request.publicKey!=='string'||request.publicKey.length>4096||!Array.isArray(videoIds)||!videoIds.length||videoIds.length>1000) fail('请提供有效设备请求及 1 至 1000 个视频');
      try {const publicKey=createPublicKey(request.publicKey);if(publicKey.asymmetricKeyType!=='rsa'||publicKey.asymmetricKeyDetails.modulusLength!==2048) fail('设备公钥必须为 RSA-2048');}catch {fail('设备公钥必须为有效 RSA-2048 公钥');}
      if(expiresAt!=null&&(!Number.isFinite(new Date(expiresAt).getTime())||new Date(expiresAt).getTime()<=Date.now())) fail('许可到期时间必须在未来');
      if(!Number.isInteger(maxPlays)||maxPlays<1||maxPlays>1000000000) fail('播放次数必须为 1 至 10 亿的整数');
      const videos=[];
      for(const id of [...new Set(videoIds)]) { const v=state.catalog.find(v=>v.videoId===id); if(!v) fail('找不到待授权视频'); const key=await reveal(v.sealedKey); let wrapped; try { wrapped=publicEncrypt({key:request.publicKey,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},key).toString('base64'); } finally { key.fill(0); } videos.push({videoId:id,courseId:v.courseId,wrappedKey:wrapped}); }
      const payload={version:online?3:2,id:randomUUID(),deviceId:request.deviceId,issuedAt:new Date().toISOString(),expiresAt:expiresAt==null?null:new Date(expiresAt).toISOString(),maxPlays,videos,policy:playbackPolicy(policy),...(online?{online:onlineConfig(online)}:{})};
      const pk=await reveal(state.issuerPrivateKey); let signature; try { signature=sign(null,Buffer.from(canonical(payload)),pk).toString('base64'); } finally { pk.fill(0); }
      const license={payload,issuerPublicKey:state.issuerPublicKey,signature,deviceRequest:structuredClone(request)};
      state.licenses.push(license);try{await save();}catch(e){if(!e.yingkeyStatePersisted)state.licenses=state.licenses.filter(l=>l!==license);else{e.yingkeySaved=true;e.yingkeyLicenseId=payload.id;e.message='许可已保存，但安全标记写入失败，请勿重复签发；请保留本机记录并处理存储错误。 '+e.message;}throw e;}return structuredClone(license);
    },
    async importLicense(license) { const p=validateLicense(license); const old=state.licenses.find(l=>l.payload.id===p.id); const signedFields=l=>({payload:l.payload,issuerPublicKey:l.issuerPublicKey,signature:l.signature});if(old&&canonical(signedFields(old))!==canonical(signedFields(license))) fail('同编号许可内容冲突'); const added=!old?structuredClone(license):null;if(added)state.licenses.push(added);try{await save();}catch(e){if(added&&!e.yingkeyStatePersisted)state.licenses=state.licenses.filter(l=>l!==added);throw e;}return p.id; },
    async openPlayback({filePath,licenseId}) {
      const license=state.licenses.find(l=>l.payload.id===licenseId); if(!license) fail('请先导入对应播放许可'); const p=validateLicense(license); const info=await readHeader(filePath); const h=info.header;
      if(license.issuerPublicKey!==h.issuerPublicKey) fail('视频与许可的发行者不匹配');
      if(h.version===2&&p.version<2)fail('新版视频需要重新签发新版许可');
      const entry=p.videos.find(v=>v.videoId===h.videoId&&v.courseId===h.courseId); if(!entry) fail('许可未包含该视频');
      if(p.version!==3&&(state.counts[p.id]||0)>=p.maxPlays) fail('许可播放次数已用完');
      let leaseStart,onlineLease;
      const pk=await reveal(state.devicePrivateKey); let key; try { key=privateDecrypt({key:pk,padding:constants.RSA_PKCS1_OAEP_PADDING,oaepHash:'sha256'},Buffer.from(entry.wrappedKey,'base64')); } catch { fail('设备身份或密钥不匹配，无法解开设备密钥，请检查许可及本地设备数据'); } finally { pk.fill(0); }
      if(key.length!==32) {key.fill(0); fail('视频密钥长度无效');}
      const startKey=p.id+':'+h.videoId;state.pendingStarts??={};let pendingStart=state.pendingStarts[startKey];
      const sessionId=randomUUID(),policy=playbackPolicy(p.policy,p.policy==null);const previousCount=state.counts[p.id];let countChanged=false;const s={key,info,filePath,license,policy};
      try { if(h.chunks) {const f=await fs.open(filePath,'r'); try {for(let index=0;index<h.chunks;index++)await decryptChunk(s,index,f);await checkContainerCompatibility(async(start,length)=>{const parts=[];for(let index=Math.floor(start/CHUNK);index<=Math.floor((start+length-1)/CHUNK);index++){const b=await decryptChunk(s,index,f);parts.push(b.subarray(Math.max(0,start-index*CHUNK),Math.min(b.length,start+length-index*CHUNK)));}return Buffer.concat(parts);},h.plainSize);} finally {await f.close();}} if(p.version===3){if(pendingStart&&Date.now()-pendingStart.createdAt>=90000){delete state.pendingStarts[startKey];pendingStart=null;await save();throw Error('上次验证的恢复期限已过，请重新点击验证播放；如未观看但次数已用尽，请联系发片方处理。');}if(!pendingStart){pendingStart={id:randomUUID(),createdAt:Date.now()};state.pendingStarts[startKey]=pendingStart;try{await save();}catch(e){if(!e.yingkeyStatePersisted){delete state.pendingStarts[startKey];pendingStart=null;}throw e;}}leaseStart=performance.now();try{onlineLease=await lease(license,h.videoId,null,pendingStart.id);}catch(e){if(e.startExpired){delete state.pendingStarts[startKey];pendingStart=null;await save();}throw e;}}else onlineLease=null;if(onlineLease){s.onlineSessionId=onlineLease.sessionId;s.onlineDeadline=leaseStart+onlineLease.ttlMs;}if(!onlineLease&&(state.counts[p.id]||0)>=p.maxPlays) fail('许可播放次数已用完');countChanged=true;state.counts[p.id]=onlineLease?onlineLease.playsUsed:(state.counts[p.id]||0)+1;if(onlineLease)delete state.pendingStarts[startKey]; await save(); sessions.set(sessionId,s); return {sessionId,size:h.plainSize,mime:h.mime,title:h.title,policy,online:Boolean(onlineLease),deviceLabel:deviceId.slice(-8),licenseLabel:p.id.slice(0,8)}; } catch(e) {if(countChanged&&!e.yingkeyStatePersisted){if(previousCount===undefined)delete state.counts[p.id];else state.counts[p.id]=previousCount;}if(pendingStart&&!e.yingkeyStatePersisted)state.pendingStarts[startKey]=pendingStart;key.fill(0);throw e;}
    },
    async openPreview({filePath}){const info=await readHeader(filePath),p=info.header.preview;if(!p)fail('这个视频未设置试看，请先导入许可');const f=await fs.open(filePath,'r');let b;try{b=await exact(f,p.size,info.offset+info.header.plainSize+info.header.chunks*16);}finally{await f.close();}if(hash(b).toString('hex')!==p.sha256)fail('试看内容已损坏');const sessionId=randomUUID(),policy=playbackPolicy({allowSeek:false,allowRate:false,watermarkText:'试看'});sessions.set(sessionId,{previewBuffer:b,info:{header:{plainSize:b.length}},policy});return {sessionId,size:b.length,mime:'video/mp4',title:info.header.title,policy,preview:true,seconds:p.seconds,deviceLabel:deviceId.slice(-8),licenseLabel:'试看'};},
    createPlaybackStream({sessionId,start,end}) {
      const s=activeSession(sessionId); ({start,end}=bounds(s,start,end));
      return Readable.from((async function*(){ if(end<start) return;if(s.previewBuffer){yield s.previewBuffer.subarray(start,end+1);return;}const f=await fs.open(s.filePath,'r'); try { for(let i=Math.floor(start/CHUNK);i<=Math.floor(end/CHUNK);i++){activeSession(sessionId); const b=await decryptChunk(s,i,f); yield b.subarray(Math.max(0,start-i*CHUNK),Math.min(b.length,end-i*CHUNK+1));} } finally {await f.close();} })());
    },
    async readPlayback(args) { const s=activeSession(args.sessionId); const {start,end}=bounds(s,args.start,args.end); if(end-start+1>8*CHUNK) fail('单次读取超过 8 MiB，请使用流式读取'); const parts=[]; for await(const b of this.createPlaybackStream({...args,start,end})) parts.push(b); return Buffer.concat(parts); },
    closePlayback(sessionId) {const s=sessions.get(sessionId); if(s?.key)s.key.fill(0);sessions.delete(sessionId);},
    async revokeLicense(id) { if(!state.licenses.some(l=>l.payload.id===id)) fail('找不到该许可');const alreadyRevoked=state.revoked.includes(id);if(!alreadyRevoked)state.revoked.push(id);try{await save();}catch(e){if(!alreadyRevoked&&!e.yingkeyStatePersisted)state.revoked=state.revoked.filter(value=>value!==id);throw e;}for(const [sid,s]of sessions)if(s.license?.payload.id===id){s.key?.fill(0);sessions.delete(sid);} },
    async close() { for(const s of sessions.values())s.key?.fill(0);sessions.clear();await saving;guardKey?.fill(0); }
  };
  const playbackStarts=new Map(),startPlayback=api.openPlayback.bind(api);api.openPlayback=data=>{const id=data?.licenseId,previous=playbackStarts.get(id)||Promise.resolve(),result=previous.catch(()=>{}).then(()=>startPlayback(data));playbackStarts.set(id,result);result.finally(()=>{if(playbackStarts.get(id)===result)playbackStarts.delete(id);}).catch(()=>{});return result;};
  if(role==='player'){delete api.editGroup;delete api.assignGroup;delete api.removeGroup;delete api.encryptVideo;delete api.issueLicense;delete api.revokeLicense;delete api.exportCloudRecord;}
  return api;
}


