import {createRecordLifecycle} from './record-lifecycle.mjs';
import {createCentralIdentity} from './central-identity.mjs';
import {createTeamWork} from './team-work.mjs';
import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import {generateKeyPairSync,randomBytes,randomUUID,sign,verify,timingSafeEqual,createPublicKey,createHash} from 'node:crypto';
import {gzipSync,brotliCompressSync} from 'node:zlib';
import {canonical,licenseHash,onlineConfig} from '../src/core/online.mjs';
import {createConsoleAuth} from './account-auth.mjs';
import {createFileVault} from './file-vault.mjs';

async function replaceStateFile(source,target){const delays=[25,50,100,200];for(let attempt=0;;attempt++){try{return await fs.rename(source,target);}catch(error){if(!['EPERM','EBUSY'].includes(error.code)||attempt>=delays.length)throw error;await new Promise(resolve=>setTimeout(resolve,delays[attempt]));}}}
export async function createAuthorizationServer({dataDir,host='127.0.0.1',port=0,ttlMs=90000,adminToken,publicUrl=process.env.YINGKEY_PUBLIC_URL||'https://video-auth.qstarorange.com',trustProxy=false,identityConfig}={}){
 await fs.mkdir(dataDir,{recursive:true});const file=path.join(dataDir,'authority.json');let state;
 try{state=JSON.parse(await fs.readFile(file,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const keys=generateKeyPairSync('ed25519',{publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}});state={version:1,...keys,adminToken:adminToken||randomBytes(32).toString('base64url'),licenses:{},sessions:{}};}
 let persistedState,transactionActive=false,transactionDirty=false;const restorePersisted=()=>{if(!persistedState)return;for(const key of Object.keys(state))delete state[key];Object.assign(state,structuredClone(persistedState));};
 let queue=Promise.resolve();const nonces=new Map();const rateBuckets=new Map();const checkRate=req=>{const address=trustProxy?(req.headers['cf-connecting-ip']||req.socket.remoteAddress):req.socket.remoteAddress;const kind=req.url.startsWith('/v1/')?'playback':req.url.startsWith('/console/api/')?'console':'public';const key=address+'|'+kind,now=Date.now();let bucket=rateBuckets.get(key);if(!bucket||now-bucket.at>=1000){bucket={at:now,count:0};rateBuckets.set(key,bucket);}if(rateBuckets.size>1000)for(const [k,v]of rateBuckets)if(now-v.at>=1000)rateBuckets.delete(k);return ++bucket.count<=(kind==='playback'?300:kind==='console'?100:60);};async function save(){if(transactionActive){transactionDirty=true;return;}const tmp=file+'.tmp';const snapshot=JSON.stringify(state);await fs.writeFile(tmp,snapshot,{mode:0o600});await replaceStateFile(tmp,file);persistedState=JSON.parse(snapshot);}await save();
 publicUrl=onlineConfig({url:publicUrl,publicKey:state.publicKey}).url;const webAuth=await createConsoleAuth({state,dataDir,save,trustProxy,consoleUrl:publicUrl});
 const vault=await createFileVault({state,save,publicUrl});
 const central=await createCentralIdentity({dataDir,config:identityConfig,publicUrl,auth:webAuth,state,save});
 const team=createTeamWork({state,save});state.signingAuthors??={};await save();
 const audit=(action,id='',source='桌面管理端',actor=null)=>{state.activity??=[];state.activity.push({at:new Date().toISOString(),action,licenseId:id,source,actor});state.activity=state.activity.slice(-500);};
 const lifecycle=createRecordLifecycle({state,save,audit});
 const dashboard=(actor=null,scope='all')=>({version:'0.10.2',files:vault.info().files.filter(x=>scope!=='mine'||x.createdBy?.username===actor?.username),tasks:team.list().filter(x=>scope!=='mine'||x.createdBy?.username===actor?.username),scope,groups:vault.info().groups,licenses:Object.values(state.licenses).filter(x=>!x.deletedAt).map(x=>{const p=x.license.payload;return {issuedBy:x.issuedBy||null,createdBy:x.createdBy||null,updatedBy:x.updatedBy||null,id:p.id,deviceId:p.deviceId,deviceRemark:x.deviceRemark||'',fileNames:p.videos.map(v=>state.files[v.videoId]?.fileLabel||v.courseId).join('、'),videoIds:p.videos.map(v=>v.videoId),online:p.version===3,enabled:x.enabled,playsUsed:x.playsUsed,maxPlays:p.maxPlays,expiresAt:p.expiresAt,courseNames:[...new Set(p.videos.map(v=>v.courseId))].join('、'),watermarkText:p.policy?.watermarkText||'',label:x.label||'',note:x.note||'',lastVerifiedAt:x.lastVerifiedAt||null,activeSessions:Object.values(state.sessions).filter(s=>s.licenseId===p.id&&!s.revoked&&s.until>Date.now()&&x.enabled).length};}).filter(x=>scope!=='mine'||x.createdBy?.username===actor?.username),activity:(state.activity||[]).filter(x=>scope!=='mine'||x.actor===actor?.username)});
 const auth=req=>{const a=Buffer.from(req.headers.authorization||''),b=Buffer.from('Bearer '+state.adminToken);return a.length===b.length&&timingSafeEqual(a,b);};
 const signed=payload=>({payload,signature:sign(null,Buffer.from(canonical(payload)),state.privateKey).toString('base64')});
 async function route(req,body,res){
  if(central){const result=await central.route(req,res,body);if(result)return {...result,publicKey:state.publicKey};if((req.url.startsWith('/console/api/')&&!['/console/api/login','/console/api/logout'].includes(req.url))||req.url.startsWith('/admin/')||req.url==='/desktop/api/session')await central.validate(req);}

  if(req.method==='GET'&&req.url==='/health')return {product:'星橙·映钥授权服务',version:'0.10.2',publicKey:state.publicKey,identity:central?{enabled:true,issuer:central.issuer}:null};
  if(req.url.startsWith('/console/api/')){
   const parsed=new URL(req.url,'http://localhost'),name=parsed.pathname.slice('/console/api/'.length),scope=parsed.searchParams.get('scope')==='mine'?'mine':'all';
   if(req.method==='GET'&&name==='session'){const s=webAuth.get(req);const identity=central?{enabled:true,issuer:central.issuer}:null;return s?{authenticated:true,username:s.username,role:s.role,displayName:s.displayName,external:!!s.centralToken,identity,csrf:s.csrf,policy:webAuth.policy()}:{authenticated:false,identity};}
   if(req.method==='POST'&&name==='login'){const result=await webAuth.login(req,res,body);audit('登录控制台','','网页控制台',result.username);await save();return result;}
   const actor=webAuth.requireSession(req);req.consoleActor=actor.username;
   if(req.method==='GET'&&name==='dashboard')return dashboard(actor,scope);
   if(req.method==='GET'&&name==='trash'){webAuth.requireSession(req,['admin','operator']);return {records:lifecycle.list(actor)};}
   if(req.method==='GET'&&name==='accounts'){webAuth.requireSession(req,['admin']);return {users:webAuth.users(),policy:webAuth.policy()};}
   if(req.method==='GET'&&name==='crypto-info')return vault.info();
   if(req.method!=='POST')throw Error('控制台请求无效');
   if(name==='logout'){const result=webAuth.logout(req,res);audit('退出控制台','','网页控制台',actor.username);await save();return result;}
   if(name==='password'){const result=await webAuth.changePassword(req,res,body);audit('修改登录密码','','网页控制台');await save();return result;}
   if(name==='user'){const result=await webAuth.editUser(req,body);audit('管理成员：'+body.username,'',actor.username,actor.username);await save();return result;}
   if(name==='login-policy'){const result=await webAuth.setPolicy(req,body);audit('修改登录时效','',actor.username,actor.username);await save();return result;}
   if(name==='license-details'){const l=state.licenses[body.id];if(!l||l.deletedAt)throw Error('找不到授权，记录可能已移入回收站');return {deviceId:l.license.payload.deviceId,deviceRemark:l.deviceRemark||'',payload:actor.role==='admin'?l.license.payload:{...l.license.payload,videos:l.license.payload.videos.map(({wrappedKey,...v})=>v)},issuerPublicKey:l.license.issuerPublicKey,signature:l.license.signature,keyProtection:'RSA-OAEP-SHA256 设备封装密钥，非明文解密密钥'};}
   if(name==='file-details')return vault.details(body.id,actor.role==='admin');
   webAuth.requireSession(req,['admin','operator']);
   if(name==='record-delete')return lifecycle.remove(body,actor);
   if(name==='record-restore')return lifecycle.restore(body,actor);
   if(name==='task-heartbeat')return team.heartbeat(body.id,actor);
   if(name==='task-start')return team.start(body,actor,'web');
   if(name==='task-result')return team.finish(body,actor);
   if(name==='group-edit'){const r=await vault.editGroup(body);audit('编辑课程分组',r.id,actor.username,actor.username);await save();return r;}
   if(name==='group-assign'){const r=await vault.assignGroup(body);audit('调整视频分组，共'+body.videoIds.length+'个',body.groupId,actor.username,actor.username);await save();return r;}
   if(name==='group-remove'){const r=await vault.removeGroup(body.id);audit('删除空分组',body.id,actor.username,actor.username);await save();return r;}
   if(name==='file-edit'){const r=await vault.edit(body);audit('编辑文件记录',body.id,actor.username,actor.username);await save();return r;}
   if(name==='crypto-start'){await team.attach(body.taskId,body.record?.header?.videoId,actor);const r=await vault.register({...body,source:'web',draft:true,actor:team.actorOf(actor)});audit('开始网页加密',r.id,actor.username,actor.username);await save();return r;}
   if(name==='crypto-download-ready'){const r=await vault.downloadReady(body);await team.updateVideo(body.id,'awaiting-save',actor);audit('生成待核验下载',body.id,actor.username,actor.username);await save();return r;}
   if(name==='crypto-complete'){const r=await vault.complete(body.id,body.confirmation);await team.updateVideo(body.id,'complete',actor);audit('完成网页加密',body.id,actor.username,actor.username);await save();return r;}
   if(name==='crypto-issue'){const license=await vault.issue(body);state.licenses[license.payload.id]={license,deviceRequest:body.deviceRequest,enabled:true,playsUsed:0,issuedBy:team.actorOf(actor),createdBy:team.actorOf(actor),updatedBy:team.actorOf(actor),deviceRemark:String(body.deviceRemark||'').slice(0,200)};audit('网页签发授权',license.payload.id,actor.username,actor.username);await save();return {license};}
   if(name==='note'){const x=state.licenses[body.id];if(!x||x.deletedAt||typeof body.label!=='string'||body.label.length>80||typeof body.note!=='string'||body.note.length>300||(body.deviceRemark!==undefined&&(typeof body.deviceRemark!=='string'||body.deviceRemark.length>200)))throw Error('授权备注无效');x.label=body.label.trim();x.note=body.note.trim();if(body.deviceRemark!==undefined)x.deviceRemark=body.deviceRemark.trim();audit('更新备注',body.id,actor.username,actor.username);await save();return {ok:true};}
   if(name==='toggle'||name==='register'){req.consoleAuthorized=true;req.url='/admin/'+name;}else throw Error('控制台操作无效');
  }
  if(req.url==='/desktop/api/login'&&req.method==='POST'){const result=await webAuth.desktopLogin(req,body);audit('员工登录管理端','','桌面管理端',result.username);await save();return {...result,publicKey:state.publicKey};}
  if(req.url==='/desktop/api/session'&&req.method==='POST')return {identity:webAuth.desktopSession(req),publicKey:state.publicKey};
  if(req.url==='/desktop/api/logout'&&req.method==='POST')return webAuth.desktopLogout(req);
  if(req.method!=='POST')throw Error('请求无效');
  if(req.url.startsWith('/admin/')){
   let employee=null;if(!req.consoleAuthorized&&!auth(req)){employee=webAuth.desktopSession(req,['admin','operator','viewer']);if(!['/admin/status','/admin/file-info'].includes(req.url))webAuth.desktopSession(req,['admin','operator']);}const actor=req.consoleAuthorized?{username:req.consoleActor,displayName:state.consoleUsers[req.consoleActor]?.displayName}:employee;const person=team.actorOf(actor);
   if(req.url==='/admin/signing-record'){if(!employee)throw Error('请使用员工账号报送签发记录');const l=body.license,p=l?.payload;if(!p||!['string'].includes(typeof p.id)||!verify(null,Buffer.from(canonical(p)),l.issuerPublicKey,Buffer.from(l.signature||'','base64')))throw Error('许可签名无效');const h=licenseHash(l);if(!state.signingAuthors[h]){state.signingAuthors[h]=person;audit('签发许可报送',p.id,'桌面管理端',person.username);await save();}return {issuedBy:state.signingAuthors[h]};}
   if(req.url==='/admin/task-sync'){if(!employee)throw Error('请使用员工账号同步任务');return team.sync(body,employee,'desktop');}
   if(req.url==='/admin/status')return {licenses:Object.values(state.licenses).filter(x=>!x.deletedAt).map(x=>({id:x.license.payload.id,deviceId:x.license.payload.deviceId,enabled:x.enabled,playsUsed:x.playsUsed,maxPlays:x.license.payload.maxPlays,expiresAt:x.license.payload.expiresAt})),publicKey:state.publicKey};
   if(req.url==='/admin/file-info')return vault.info();
   if(req.url==='/admin/file-record'){const r=await vault.register({...body,source:'desktop',actor:person,encryptedBy:team.owner(body.taskId,body.record?.header?.videoId)});audit('上传加密文件记录',r.id,'桌面管理端',person?.username||null);await save();return r;}
   if(req.url==='/admin/register'){
    const {license,deviceRequest}=body,p=license?.payload;
    if(!p||![2,3].includes(p.version)||!verify(null,Buffer.from(canonical(p)),license.issuerPublicKey,Buffer.from(license.signature||'','base64')))throw Error('许可签名无效');
    if(p.version===3){const cfg=onlineConfig(p.online);if(cfg.publicKey!==state.publicKey)throw Error('许可指向另一台授权服务');}
    const key=createPublicKey(deviceRequest?.publicKey||'');if(deviceRequest.deviceId!==p.deviceId||key.asymmetricKeyType!=='rsa'||key.asymmetricKeyDetails.modulusLength!==2048)throw Error('设备请求无效');
    if(!Number.isInteger(p.maxPlays)||p.maxPlays<1||!Array.isArray(p.videos)||!p.videos.length||(p.expiresAt!==null&&!Number.isFinite(Date.parse(p.expiresAt))))throw Error('许可参数无效');
    if(body.deviceRemark!==undefined&&(typeof body.deviceRemark!=='string'||body.deviceRemark.length>200))throw Error('设备备注过长');const old=state.licenses[p.id];if(old?.deletedAt)throw Error('授权已删除，请由管理员在回收站恢复；重新上传不会重置次数');if(old){if(licenseHash(old.license)!==licenseHash(license)||canonical(old.deviceRequest)!==canonical(deviceRequest))throw Error('许可编号冲突');if(body.deviceRemark!==undefined)old.deviceRemark=body.deviceRemark;old.updatedBy=person;await save();return {ok:true,playsUsed:old.playsUsed,enabled:old.enabled};}
    if(p.videos.some(v=>state.files?.[v.videoId]?.deletedAt))throw Error('关联文件记录已删除，请先恢复文件记录');
    state.licenses[p.id]={license,deviceRequest,enabled:true,playsUsed:0,issuedBy:state.signingAuthors[licenseHash(license)]||null,createdBy:person,updatedBy:person,deviceRemark:body.deviceRemark||''};audit('登记授权',p.id,req.consoleAuthorized?'网页控制台 · '+req.consoleActor:'桌面管理端',person?.username||null);await save();return {ok:true};
   }
   if(req.url==='/admin/toggle'){
    const x=state.licenses[body.id];if(!x||x.deletedAt||typeof body.enabled!=='boolean')throw Error('许可或停用状态无效');
    if(x.license.payload.version!==3)throw Error('离线许可不能远程停用');x.enabled=body.enabled;x.updatedBy=person;
    if(!body.enabled)for(const s of Object.values(state.sessions))if(s.licenseId===body.id)s.revoked=true;
    audit(body.enabled?'恢复授权':'停用授权',body.id,req.consoleAuthorized?'网页控制台 · '+req.consoleActor:'桌面管理端',person?.username||null);await save();return {ok:true,enabled:x.enabled};
   }
   throw Error('管理操作无效');
  }
  if(req.url==='/v1/lease'){
   const x=state.licenses[body.licenseId];if(!x)throw Error('许可尚未登记到服务器');
   const {proof,...unsigned}=body;
   if(typeof proof!=='string'||!verify('sha256',Buffer.from(canonical(unsigned)),x.deviceRequest.publicKey,Buffer.from(proof,'base64')))throw Error('设备身份验证失败');
   const p=x.license.payload;if(p.version!==3)throw Error('离线许可不提供在线会话');if(body.deviceId!==p.deviceId||body.licenseHash!==licenseHash(x.license)||!p.videos.some(v=>v.videoId===body.videoId)||typeof body.nonce!=='string'||body.nonce.length>100)throw Error('播放请求不匹配');
   const response={nonce:body.nonce,deviceId:p.deviceId,videoId:body.videoId,licenseHash:body.licenseHash,ttlMs:Math.min(ttlMs,90000),sessionId:body.sessionId,playsUsed:x.playsUsed,allowed:false};
   const nonceKey=p.id+':'+body.nonce;if(nonces.has(nonceKey))throw Error('拒绝重复播放请求');nonces.set(nonceKey,Date.now());for(const [key,time] of nonces)if(time<Date.now()-300000)nonces.delete(key);
   const deny=(reason,code)=>signed({...response,ttlMs:0,reason,...(code?{code}:{})});
   if(x.deletedAt)return deny('发片方已删除这份授权');if(!x.enabled)return deny('发片方已停用这份授权');if(p.expiresAt&&Date.parse(p.expiresAt)<=Date.now())return deny('授权已到期');
   if(body.sessionId){const s=state.sessions[body.sessionId];if(!s||s.revoked||s.licenseId!==p.id||s.videoId!==body.videoId||s.until<Date.now())return deny('在线会话已失效，请重新验证播放');s.until=Date.now()+Math.min(ttlMs,90000);}
   else{
    if(body.attemptId!==undefined&&(typeof body.attemptId!=='string'||!/^[0-9a-f-]{36}$/i.test(body.attemptId)))throw Error('播放请求编号无效');
    const previous=body.attemptId&&Object.entries(state.sessions).find(([,s])=>s.licenseId===p.id&&s.videoId===body.videoId&&s.attemptId===body.attemptId);
    if(previous){const [id,s]=previous;if(s.revoked)return deny('在线会话已被停用');if(s.until<=Date.now()||Date.now()-s.startedAt>=90000)return deny('上次验证的恢复期限已过，请重新点击验证播放','START_EXPIRED');response.sessionId=id;response.ttlMs=Math.max(0,s.until-Date.now());}
    else{if(x.playsUsed>=p.maxPlays)return deny('许可播放次数已用完');x.playsUsed++;response.sessionId=randomUUID();state.sessions[response.sessionId]={licenseId:p.id,videoId:body.videoId,until:Date.now()+Math.min(ttlMs,90000),...(body.attemptId?{attemptId:body.attemptId,startedAt:Date.now()}: {})};}
   }
   if(p.expiresAt)response.ttlMs=Math.max(0,Math.min(response.ttlMs,Date.parse(p.expiresAt)-Date.now()));
   response.playsUsed=x.playsUsed;response.allowed=true;
   x.lastVerifiedAt=new Date().toISOString();
   // Expired sessions need no long-term retention; counters remain durable.
   for(const [id,s] of Object.entries(state.sessions))if(s.until<Date.now()-(s.attemptId?86400000:90000))delete state.sessions[id];
   await save();return signed(response);
  }
  throw Error('请求路径无效');
 }
 const webFiles=new Map([['/',['index.html','text/html; charset=utf-8']],['/console',['index.html','text/html; charset=utf-8']],['/console/',['index.html','text/html; charset=utf-8']],['/console/app.js',['app.js','text/javascript; charset=utf-8']],['/console/styles.css',['styles.css','text/css; charset=utf-8']]]);
 const source={};for(const name of ['index.html','app.js','styles.css','library.js','crypto.js','visual.css','gsap.min.js','ui-motion.js','team-ui.js','record-ui.js'])source[name]=(await fs.readFile(path.join(import.meta.dirname,'web',name),'utf8')).replace(/^\uFEFF/,'').replace(/\r\n?/g,'\n');
 const js=(source['gsap.min.js']+'\n'+source['ui-motion.js']+'\n'+source['app.js']+'\n'+source['library.js']+'\n'+source['crypto.js']+'\n'+source['team-ui.js']+'\n'+source['record-ui.js']).replaceAll('</script','<\\/script'),css=source['visual.css']+'\n'+source['styles.css'];
 const cspHash=text=>"'sha256-"+createHash('sha256').update(text).digest('base64')+"'";
 const csp=`default-src 'self'; script-src 'self' ${cspHash(js)}; style-src 'self' ${cspHash(css)}; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`;
 source['index.html']=source['index.html'].replace('<link rel="stylesheet" href="/console/styles.css">',()=>'<style>'+css+'</style>').replace('<script src="/console/app.js" defer></script>','').replace('</body>',()=>'<script>'+js+'</script></body>');
 const webData=new Map();for(const [name,text] of Object.entries(source)){const plain=Buffer.from(text);webData.set(name,{plain,gzip:gzipSync(plain),br:brotliCompressSync(plain),etag:createHash('sha256').update(plain).digest('hex').slice(0,24)});}
 const server=http.createServer(async(req,res)=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',csp);try{if(!checkRate(req)){res.statusCode=429;res.end(JSON.stringify({error:'请求过于频繁，请稍后重试'}));return;}const pathname=new URL(req.url,'http://localhost').pathname;if(['GET','HEAD'].includes(req.method)&&webFiles.has(pathname)){const [file,type]=webFiles.get(pathname),data=webData.get(file),accept=req.headers['accept-encoding']||'',encoding=/\bbr\b/.test(accept)?'br':/\bgzip\b/.test(accept)?'gzip':'plain',etag='"'+data.etag+'-'+encoding+'"';res.setHeader('Content-Type',type);res.setHeader('Cache-Control',file==='index.html'?'public, no-transform, max-age=60, s-maxage=300':'public, max-age=300, s-maxage=86400');res.setHeader('Vary','Accept-Encoding');res.setHeader('ETag',etag);if(req.headers['if-none-match']===etag){res.writeHead(304).end();return;}if(encoding!=='plain')res.setHeader('Content-Encoding',encoding);res.setHeader('Content-Length',data[encoding].length);res.end(req.method==='HEAD'?undefined:data[encoding]);return;}let size=0,parts=[];for await(const part of req){size+=part.length;if(size>1048576)throw Error('请求过大');parts.push(part);}const body=parts.length?JSON.parse(Buffer.concat(parts)):{};if(!body||typeof body!=='object'||Array.isArray(body))throw Error('请求格式无效');const op=queue.then(async()=>{transactionActive=true;transactionDirty=false;try{const result=await route(req,body,res);transactionActive=false;if(transactionDirty)await save();return result;}catch(e){transactionActive=false;restorePersisted();throw e;}});queue=op.catch(()=>{});const result=await op;if(!res.writableEnded)res.end(JSON.stringify(result));}catch(e){res.statusCode=e.status||400;res.end(JSON.stringify({error:e.message}));}});
 server.requestTimeout=10000;server.headersTimeout=10000;server.maxConnections=100;
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,host,resolve);});
 return {port:server.address().port,publicKey:state.publicKey,adminToken:state.adminToken,close:async()=>{server.closeAllConnections();await new Promise(r=>server.close(r));await queue;}};
}
if(process.argv[1]&&path.resolve(process.argv[1])===path.resolve(import.meta.filename)){
 const dataDir=path.resolve(process.env.YINGKEY_SERVER_DATA||path.join(import.meta.dirname,'data'));
 const service=await createAuthorizationServer({dataDir,host:process.env.YINGKEY_HOST||'127.0.0.1',port:Number(process.env.YINGKEY_PORT||17891),trustProxy:process.env.YINGKEY_TRUST_PROXY==='1'});
 console.log('星橙·映钥授权服务已启动，端口 '+service.port);
}




