import {createHash,randomUUID,verify,createPublicKey} from 'node:crypto';
export const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
export const licenseHash=l=>createHash('sha256').update(canonical({payload:l.payload,signature:l.signature,issuerPublicKey:l.issuerPublicKey})).digest('hex');
export function onlineConfig(x){
 if(!x||typeof x.url!=='string'||typeof x.publicKey!=='string'||x.publicKey.length>4096)throw Error('在线授权服务配置无效');
 const u=new URL(x.url);if(u.username||u.password||u.search||u.hash||u.pathname!=='/'||!['https:','http:'].includes(u.protocol))throw Error('授权服务器地址无效');
 // Plain HTTP is permitted only over loopback or Tailscale's encrypted overlay.
 if(u.protocol==='http:'&&!/^(127\.0\.0\.1|localhost|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3})$/.test(u.hostname))throw Error('公网授权服务必须使用 HTTPS');
 if(createPublicKey(x.publicKey).asymmetricKeyType!=='ed25519')throw Error('授权服务公钥无效');
 return {url:u.origin,publicKey:x.publicKey};
}
export async function postJson(url,body,token){const r=await fetch(url,{method:'POST',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},body:JSON.stringify(body),signal:AbortSignal.timeout(5000),redirect:'error'});if(r.status>=500||r.status===429){const e=Error('授权服务器暂时不可达，请检查网络');e.networkUnavailable=true;await r.body?.cancel();throw e;}const s=await r.text();if(s.length>1048576)throw Error('授权服务器响应过大');let j;try{j=JSON.parse(s);}catch{throw Error('授权服务器响应无效');}if(!r.ok)throw Error(j.error||'授权服务器拒绝请求');return j;}
export async function requestLease({license,videoId,sessionId=null,proof,fetchLease=postJson,attemptId}){
 const cfg=onlineConfig(license.payload.online),nonce=randomUUID();const body={licenseId:license.payload.id,licenseHash:licenseHash(license),deviceId:license.payload.deviceId,videoId,sessionId,nonce,...(attemptId?{attemptId}:{})};body.proof=await proof(canonical(body));
 let reply;try{reply=await fetchLease(cfg.url+'/v1/lease',body);}catch(e){if(e.name==='TimeoutError'||e.name==='AbortError'||e instanceof TypeError){e.networkUnavailable=true;}throw e;}
 if(!reply.payload||typeof reply.signature!=='string'||!verify(null,Buffer.from(canonical(reply.payload)),cfg.publicKey,Buffer.from(reply.signature,'base64')))throw Error('在线授权响应签名无效');
 const p=reply.payload;
 if(p.nonce!==nonce||p.licenseHash!==body.licenseHash||p.deviceId!==body.deviceId||p.videoId!==videoId||!Number.isFinite(p.ttlMs)||p.ttlMs<0||p.ttlMs>90000)throw Error('在线授权响应不匹配');
 if(!p.allowed){const e=Error(p.reason||'授权已被远程停用');e.startExpired=p.code==='START_EXPIRED';throw e;}
 if(typeof p.sessionId!=='string'||(sessionId&&sessionId!==p.sessionId)||!Number.isSafeInteger(p.playsUsed))throw Error('在线播放会话无效');
 return p;
}
