import {promises as fs} from 'node:fs';
import path from 'node:path';
import {request as httpRequest} from 'node:http';
import {randomBytes,createHash,createPublicKey,verify,timingSafeEqual} from 'node:crypto';
const random=()=>randomBytes(32).toString('base64url');
const hash=v=>createHash('sha256').update(v).digest('base64url');
const denied=(message,status=401)=>Object.assign(Error(message),{status});
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&Buffer.byteLength(a)===Buffer.byteLength(b)&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
export async function createCentralIdentity({dataDir,config,publicUrl,auth,state,save}){
 if(config===undefined){try{config=JSON.parse(await fs.readFile(path.join(dataDir,'identity.json'),'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}}
 if(!config?.enabled)return null;
 const issuer=new URL(config.issuer),back=new URL(config.baseUrl||config.issuer);
 if(issuer.protocol!=='https:'||issuer.pathname!=='/'||issuer.search||issuer.hash||issuer.username||issuer.password)throw Error('统一账号发行者地址无效');
 if(back.origin!==issuer.origin&&!(back.protocol==='http:'&&back.hostname==='127.0.0.1'&&back.pathname==='/'))throw Error('统一账号内部地址必须为本机回环地址');
 if(!config.clientId||typeof config.clientSecret!=='string'||config.clientSecret.length<32)throw Error('统一账号平台配置不完整');
 const base=back.origin,iss=issuer.origin,redirectUri=publicUrl+'/sso/callback',basic='Basic '+Buffer.from(config.clientId+':'+config.clientSecret).toString('base64'),pending=new Map(),devices=new Map();
 const headers={host:issuer.host,'x-forwarded-proto':'https'};
 function loopbackRequest(route,options){return new Promise((resolve,reject)=>{const payload=options.body?.toString(),req=httpRequest(base+route,{method:options.method,headers:{...options.headers,...(payload?{'content-length':Buffer.byteLength(payload)}:{})},signal:options.signal},res=>{let size=0;const chunks=[];res.on('data',chunk=>{size+=chunk.length;if(size>1048576){res.destroy();reject(Error('Response exceeds limit'));}else chunks.push(chunk);});res.on('error',reject);res.on('end',()=>resolve({ok:res.statusCode>=200&&res.statusCode<300,status:res.statusCode,json:async()=>JSON.parse(Buffer.concat(chunks).toString('utf8'))}));});req.on('error',reject);req.end(payload);});}
 async function request(route,{body,token,basicAuth=false}={}){
  let r;try{const options={method:body?'POST':'GET',headers:{...headers,...(body?{'content-type':'application/x-www-form-urlencoded'}:{}),...(token?{authorization:'Bearer '+token}:{}),...(basicAuth?{authorization:basic}:{})},body:body?new URLSearchParams(body):undefined,redirect:'error',signal:AbortSignal.timeout(5000)};r=back.protocol==='http:'?await loopbackRequest(route,options):await fetch(base+route,options);}catch{throw denied('账号中心暂时无法连接，请稍后重试。原有视频与许可仍保留。',503);}
  if(r.status>=500||r.status===429)throw denied('账号中心暂时无法连接，请稍后重试。原有视频与许可仍保留。',503);
  if(!r.ok)throw denied('统一登录或平台授权已失效，请重新登录');
  return r.json();
 }
 function clean(){const now=Date.now();for(const [id,row] of pending)if(now>row.expires)pending.delete(id);for(const [id,row]of devices)if(now>row.expires)devices.delete(id);}
 function checkOrigin(req){if(req.headers.origin&&req.headers.origin!==publicUrl)throw denied('拒绝跨站登录请求',403);}
 async function identity(token,expected){
  const current=await request('/oauth/introspect',{body:{token},basicAuth:true});
  if(!current.active||!current.sub||expected&&current.sub!==expected)throw denied('统一账号或映钥访问权限已失效，请重新登录');
  const info=await request('/oauth/userinfo',{token});
  if(info.sub!==current.sub||typeof info.preferred_username!=='string'||!['user','admin'].includes(current.platform_role)||!Array.isArray(current.permissions))throw denied('统一账号身份校验失败');
  const username='sso_'+hash(iss+'|'+info.sub).slice(0,24),role=current.platform_role==='admin'?'admin':current.permissions.includes('operate')?'operator':'viewer';
  const displayName=String(info.name||info.preferred_username).slice(0,80);
  const old=state.consoleUsers[username];
  if(old&&!old.external)throw denied('账号身份冲突，请联系管理员');
  if(!old||old.role!==role||old.displayName!==displayName||old.preferredUsername!==info.preferred_username){state.consoleUsers[username]={username,role,displayName,preferredUsername:info.preferred_username,external:true,subject:info.sub,enabled:true,version:old?.version||1};await save();}
  return {username,displayName,role,subject:info.sub,external:true,preferredUsername:info.preferred_username};
 }
 async function validate(req){const session=auth.externalSessionOf(req);if(!session)return;try{const person=await identity(session.centralToken,session.subject);auth.refreshExternal(session,person);}catch(e){if(e.status!==503)auth.revokeExternal(session);throw e;}}
 function redirect(res,url){res.writeHead(302,{Location:url});res.end();}
 function cookie(res,value,age){res.setHeader('Set-Cookie','yingkey_sso='+value+'; Path=/sso; HttpOnly; SameSite=Lax; Max-Age='+age+(publicUrl.startsWith('https:')?'; Secure':''));}
 function binding(req){return(req.headers.cookie||'').split(';').map(s=>s.trim()).find(s=>s.startsWith('yingkey_sso='))?.slice(12)||'';}
 async function signedClaims(jwt,nonce){
  if(typeof jwt!=='string'||jwt.length>20000)throw denied('统一登录签名无效');
  const parts=jwt.split('.');if(parts.length!==3)throw denied('统一登录签名无效');
  let header,claims;try{header=JSON.parse(Buffer.from(parts[0],'base64url'));claims=JSON.parse(Buffer.from(parts[1],'base64url'));}catch{throw denied('统一登录签名无效');}
  if(header.alg!=='RS256'||header.crit)throw denied('统一登录签名算法无效');
  const jwks=await request('/.well-known/jwks.json'),keys=jwks.keys?.filter(k=>k.kid===header.kid&&k.kty==='RSA'&&(!k.use||k.use==='sig')&&(!k.alg||k.alg==='RS256'));
  if(keys?.length!==1||!verify('RSA-SHA256',Buffer.from(parts[0]+'.'+parts[1]),createPublicKey({key:keys[0],format:'jwk'}),Buffer.from(parts[2],'base64url')))throw denied('统一登录签名校验失败');
  const now=Date.now()/1000,aud=Array.isArray(claims.aud)?claims.aud:[claims.aud];
  if(claims.iss!==iss||!aud.includes(config.clientId)||aud.length>1&&claims.azp!==config.clientId||typeof claims.exp!=='number'||claims.exp<=now||typeof claims.iat!=='number'||claims.iat>now+30||claims.nbf&&claims.nbf>now+30||!equal(claims.nonce,nonce)||typeof claims.sub!=='string'||!claims.sub)throw denied('统一登录身份或有效期校验失败');
  return claims;
 }
 async function route(req,res,body){
  const url=new URL(req.url,publicUrl);clean();
  if(req.method==='POST'&&url.pathname==='/desktop/api/sso-start'){
   checkOrigin(req);if(devices.size>=100)throw denied('登录请求过多，请稍后重试',429);
   const ticket=random(),pollToken=random();devices.set(ticket,{pollToken,expires:Date.now()+300000});return {loginUrl:publicUrl+'/sso/start?desktop='+ticket,pollToken,ticket,expiresIn:300};
  }
  if(req.method==='POST'&&url.pathname==='/desktop/api/sso-poll'){
   checkOrigin(req);const row=devices.get(body.ticket);if(!row||!equal(row.pollToken,body.pollToken))throw denied('桌面登录已过期，请重新发起');
   if(row.failed){devices.delete(body.ticket);throw denied('统一登录未完成，请重新发起');}
   if(!row.result)return {pending:true};const person=await identity(row.accessToken,row.subject);devices.delete(body.ticket);return auth.createExternal(req,res,person,row.accessToken,true);
  }
  if(req.method==='GET'&&url.pathname==='/sso/start'){
   const device=url.searchParams.get('desktop');if(device&&!devices.has(device))throw denied('桌面登录已过期，请重新发起');
   if(pending.size>=100)throw denied('登录请求过多，请稍后重试',429);
   const id=random(),verifier=random(),nonce=random(),bind=random();pending.set(id,{verifier,nonce,bind,device,expires:Date.now()+300000});cookie(res,bind,300);
   const target=new URL(iss+'/oauth/authorize');target.search=new URLSearchParams({client_id:config.clientId,response_type:'code',redirect_uri:redirectUri,scope:'openid profile',state:id,nonce,code_challenge:hash(verifier),code_challenge_method:'S256'});redirect(res,target.href);return {handled:true};
  }
  if(req.method==='GET'&&url.pathname==='/sso/callback'){
   const id=url.searchParams.get('state'),row=pending.get(id);pending.delete(id);cookie(res,'',0);
   if(!row||!equal(binding(req),row.bind))throw denied('登录校验已过期或浏览器不匹配，请重新登录');
   try{
    if(url.searchParams.has('error')||!url.searchParams.get('code'))throw denied('已取消统一登录');
    const tokens=await request('/oauth/token',{body:{grant_type:'authorization_code',code:url.searchParams.get('code'),redirect_uri:redirectUri,code_verifier:row.verifier},basicAuth:true});
    if(tokens.token_type?.toLowerCase()!=='bearer'||typeof tokens.access_token!=='string')throw denied('统一登录凭据无效');
    const claims=await signedClaims(tokens.id_token,row.nonce),person=await identity(tokens.access_token,claims.sub);
    if(row.device){const device=devices.get(row.device);if(!device)throw denied('桌面登录已过期');device.result=true;device.subject=claims.sub;device.accessToken=tokens.access_token;res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>映钥登录完成</title><h1>登录完成</h1><p>请返回星橙·映钥管理端继续使用。可以关闭此页面。</p></html>');}
    else{await auth.createExternal(req,res,person,tokens.access_token,false);redirect(res,'/');}
    return {handled:true};
   }catch(e){if(row.device&&devices.has(row.device))devices.get(row.device).failed=true;throw e;}
  }
  return null;
 }
 return {issuer:iss,clientId:config.clientId,validate,route};
}
