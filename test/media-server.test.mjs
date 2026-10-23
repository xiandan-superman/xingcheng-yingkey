import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {promises as fs} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {randomBytes} from 'node:crypto';
import {Readable} from 'node:stream';
import {createEngine} from '../src/core/engine.mjs';
import {createMediaServer,parseRange} from '../src/media-server.mjs';

function request(url,{method='GET',headers={}}={}){
 return new Promise((resolve,reject)=>{const req=http.request(url,{method,headers},res=>{const chunks=[];res.on('data',b=>chunks.push(b));res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body:Buffer.concat(chunks)}));res.on('error',reject);});req.on('error',reject);req.end();});
}
async function fixture(t,size=1024*1024+137){
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vdrm-http-'));const engine=await createEngine({storageDir:path.join(dir,'state'),deviceId:'http-test',seal:b=>b,unseal:b=>b});
 const input=path.join(dir,'original.mp4'),output=path.join(dir,'protected.vdrm'),plain=randomBytes(size);await fs.writeFile(input,plain);
 const video=await engine.encryptVideo({inputPath:input,outputPath:output});const license=await engine.issueLicense({videoIds:[video.videoId],expiresAt:Date.now()+3600000,maxPlays:1});
 const server=await createMediaServer(engine);t.after(async()=>{await server.close();await engine.close();await fs.rm(dir,{recursive:true,force:true});});
 const info=server.add(await engine.openPlayback({filePath:output,licenseId:license.payload.id}));return {engine,server,plain,info,license};
}
test('HTTP range returns exact bytes for crossing blocks, open-ended, suffix, clamped end and whole body',async t=>{
 const f=await fixture(t);
 for(const [range,start,end] of [['bytes=1048550-1048590',1048550,1048590],['bytes=1048570-',1048570,f.plain.length-1],['bytes=-57',f.plain.length-57,f.plain.length-1],['bytes=-9999999',0,f.plain.length-1],['bytes=0-9999999',0,f.plain.length-1]]){
  const r=await request(f.info.url,{headers:{Range:range}});assert.equal(r.status,206);assert.equal(r.headers['content-range'],`bytes ${start}-${end}/${f.plain.length}`);assert.equal(Number(r.headers['content-length']),end-start+1);assert.deepEqual(r.body,f.plain.subarray(start,end+1));
 }
 const r=await request(f.info.url);assert.equal(r.status,200);assert.equal(r.headers['accept-ranges'],'bytes');assert.equal(r.headers['cache-control'],'no-store');assert.deepEqual(r.body,f.plain);assert.equal(f.engine.getDashboard().licenses[0].playsUsed,1);
});
test('HEAD has no body; malformed or unsatisfiable GET ranges return 416',async t=>{
 const f=await fixture(t,137);const head=await request(f.info.url,{method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body.length,0);assert.equal(Number(head.headers['content-length']),137);
 const rangedHead=await request(f.info.url,{method:'HEAD',headers:{Range:'bytes=10-19'}});assert.equal(rangedHead.status,200);assert.equal(Number(rangedHead.headers['content-length']),137);assert.equal(rangedHead.headers['content-range'],undefined);
 for(const range of ['bytes=137-','bytes=20-10','bytes=-0','bytes=-','bytes=','bytes=0-5,8-9','items=0-5','bytes=9007199254740993-','bytes=0-9007199254740993']){const r=await request(f.info.url,{headers:{Range:range}});assert.equal(r.status,416,range);assert.equal(r.headers['content-range'],'bytes */137');assert.equal(r.body.length,0);}
});
test('invalid tokens, origins, hosts and methods cannot read media',async t=>{
 const f=await fixture(t,137);
 for(const [url,options,status] of [[f.info.url.replace(/.$/,'!'),{},404],[f.info.url.replace(/\/[^/]+$/,'/not-the-token'),{},404],[new URL('/media/unknown/x',f.info.url).href,{},404],[f.info.url,{headers:{Origin:'https://attacker.example'}},403],[f.info.url,{headers:{Host:'attacker.example'}},403],[f.info.url,{method:'POST'},403]]){const r=await request(url,options);assert.equal(r.status,status);assert.equal(r.body.length,0);}
 const allowed=await request(f.info.url,{headers:{Origin:'null',Range:'bytes=0-3'}});assert.equal(allowed.status,206);assert.deepEqual(allowed.body,f.plain.subarray(0,4));
});
test('revocation and expiry reject new HTTP reads even when token is valid',async t=>{
 const f=await fixture(t,137);const now=Date.now;Date.now=()=>now()+7200000;try {const r=await request(f.info.url);assert.equal(r.status,403);assert.match(r.body.toString(),/过期/);}finally{Date.now=now;}
 await f.engine.revokeLicense(f.license.payload.id);const r=await request(f.info.url);assert.equal(r.status,403);assert.equal(r.body.equals(f.plain),false);
});
test('empty authenticated container serves empty response and rejects range',async t=>{
 const f=await fixture(t,0);const r=await request(f.info.url);assert.equal(r.status,200);assert.equal(r.body.length,0);assert.equal(r.headers['content-length'],'0');const bad=await request(f.info.url,{headers:{Range:'bytes=0-'}});assert.equal(bad.status,416);assert.equal(bad.headers['content-range'],'bytes */0');
});
test('stream failures terminate response instead of delivering unvalidated remainder',async t=>{
 let valid=true;const engine={getSessionStatus:()=>({valid,reason:'许可已过期'}),closePlayback:()=>{},createPlaybackStream:()=>Readable.from((async function*(){yield Buffer.from('start');await new Promise(r=>setTimeout(r,10));valid=false;throw Error('许可已过期');})())};
 const server=await createMediaServer(engine);t.after(()=>server.close());const info=server.add({sessionId:'abc-def',size:1024,mime:'video/mp4'});await assert.rejects(request(info.url),/aborted|reset|socket hang up/i);const r=await request(info.url);assert.equal(r.status,403);
});
test('range parser rejects unsafe values and handles empty resources',()=>{
 assert.deepEqual(parseRange(undefined,0),{start:0,end:-1,partial:false});assert.deepEqual(parseRange('bytes=-10',5),{start:0,end:4,partial:true});assert.throws(()=>parseRange('bytes=-9007199254740993',5));
});
