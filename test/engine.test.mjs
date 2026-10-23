import test from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import { createEngine } from '../src/core/engine.mjs';

const wrappingKey=randomBytes(32);
const seal=b=>{const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',wrappingKey,iv);return Buffer.concat([iv,c.update(b),c.final(),c.getAuthTag()]);};
const unseal=b=>{const d=createDecipheriv('aes-256-gcm',wrappingKey,b.subarray(0,12));d.setAuthTag(b.subarray(-16));return Buffer.concat([d.update(b.subarray(12,-16)),d.final()]);};
async function fixture(t,size=1024*1024+117) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'vdrm-test-')); t.after(()=>fs.rm(dir,{recursive:true,force:true}));
 const opts={storageDir:path.join(dir,'state'),deviceId:'test-machine',seal,unseal};const e=await createEngine(opts);t.after(()=>e.close());
 const plain=randomBytes(size),input=path.join(dir,'own.mp4'),output=path.join(dir,'encrypted.vdrm');await fs.writeFile(input,plain);
 const v=await e.encryptVideo({inputPath:input,outputPath:output,courseId:'course',title:'自有样本'});
 const lic=await e.issueLicense({videoIds:[v.videoId],expiresAt:Date.now()+3600000,maxPlays:3});
 return {dir,e,opts,plain,input,output,v,lic};
}
test('stream roundtrip, cross-chunk byte range, source preserved and persistent restart',async t=>{
 const f=await fixture(t);const p=await f.e.openPlayback({filePath:f.output,licenseId:f.lic.payload.id});
 assert.deepEqual(await f.e.readPlayback({sessionId:p.sessionId,start:1024*1024-19,end:1024*1024+44}),f.plain.subarray(1024*1024-19,1024*1024+45));
 const parts=[];for await(const b of f.e.createPlaybackStream({sessionId:p.sessionId}))parts.push(b);assert.deepEqual(Buffer.concat(parts),f.plain);
 assert.deepEqual(await fs.readFile(f.input),f.plain);await f.e.close();const e2=await createEngine(f.opts);t.after(()=>e2.close());assert.equal(e2.getDashboard().licenses[0].playsUsed,1);assert.equal(e2.getDashboard().catalog[0].videoId,f.v.videoId);
 const p2=await e2.openPlayback({filePath:f.output,licenseId:f.lic.payload.id});assert.deepEqual(await e2.readPlayback({sessionId:p2.sessionId}),f.plain);
 const state=await fs.readFile(path.join(f.opts.storageDir,'state.json'),'utf8');assert.ok(!state.includes('PRIVATE KEY'));assert.equal(JSON.stringify(await e2.inspectVideo(f.output)).includes('sealedKey'),false);
});
test('tampering in second chunk fails authentication',async t=>{
 const f=await fixture(t);const p=await f.e.openPlayback({filePath:f.output,licenseId:f.lic.payload.id});const raw=await fs.readFile(f.output);raw[raw.length-20]^=1;await fs.writeFile(f.output,raw);
 await assert.rejects(f.e.readPlayback({sessionId:p.sessionId,start:1024*1024,end:f.plain.length-1}),/完整性/);
});
test('header tampering fails authentication',async t=>{
 const f=await fixture(t);const raw=await fs.readFile(f.output);const title=Buffer.from('自有样本');const i=raw.indexOf(title);assert.ok(i>0);Buffer.from('篡改样本').copy(raw,i);await fs.writeFile(f.output,raw);
 await assert.rejects(f.e.openPlayback({filePath:f.output,licenseId:f.lic.payload.id}),/完整性/);
});
test('wrong device, signature tampering and expiry are rejected',async t=>{
 const f=await fixture(t);const other=await createEngine({...f.opts,storageDir:path.join(f.dir,'other'),deviceId:'other-machine'});t.after(()=>other.close());await assert.rejects(other.importLicense(f.lic),/当前设备/);
 const altered=structuredClone(f.lic);altered.payload.maxPlays=999;await assert.rejects(f.e.importLicense(altered),/签名/);
 const expiring=await f.e.issueLicense({videoIds:[f.v.videoId],expiresAt:Date.now()+10000});
 const now=Date.now;Date.now=()=>now()+20000;try {await assert.rejects(f.e.openPlayback({filePath:f.output,licenseId:expiring.payload.id}),/过期/);}finally{Date.now=now;}
});
test('play count includes concurrent opening, revocation persists and ends active sessions',async t=>{
 const f=await fixture(t);const lic=await f.e.issueLicense({videoIds:[f.v.videoId],expiresAt:Date.now()+100000,maxPlays:1});
 const result=await Promise.allSettled([f.e.openPlayback({filePath:f.output,licenseId:lic.payload.id}),f.e.openPlayback({filePath:f.output,licenseId:lic.payload.id})]);assert.equal(result.filter(x=>x.status==='fulfilled').length,1);assert.match(result.find(x=>x.status==='rejected').reason.message,/次数/);
 const p=result.find(x=>x.status==='fulfilled').value;await f.e.revokeLicense(lic.payload.id);await assert.rejects(f.e.readPlayback({sessionId:p.sessionId}),/会话/);await f.e.close();const e2=await createEngine(f.opts);t.after(()=>e2.close());await assert.rejects(e2.openPlayback({filePath:f.output,licenseId:lic.payload.id}),/吊销/);
});
test('license can be issued to a different device and only it unwraps key',async t=>{
 const f=await fixture(t);const other=await createEngine({...f.opts,storageDir:path.join(f.dir,'other'),deviceId:'other-machine'});t.after(()=>other.close());const lic=await f.e.issueLicense({deviceRequest:other.getDeviceRequest(),videoIds:[f.v.videoId],expiresAt:Date.now()+100000});await other.importLicense(lic);const p=await other.openPlayback({filePath:f.output,licenseId:lic.payload.id});assert.deepEqual(await other.readPlayback({sessionId:p.sessionId}),f.plain);
});

test('blank expiry creates usable timeless license, invalid dates are rejected',async t=>{
 const f=await fixture(t,128);
 for(const expiresAt of [null,undefined]){
  const l=await f.e.issueLicense({videoIds:[f.v.videoId],expiresAt,maxPlays:2});assert.equal(l.payload.expiresAt,null);
  await f.e.importLicense(l);const p=await f.e.openPlayback({filePath:f.output,licenseId:l.payload.id});assert.deepEqual(await f.e.readPlayback({sessionId:p.sessionId}),f.plain);
 }
 await assert.rejects(f.e.issueLicense({videoIds:[f.v.videoId],expiresAt:'not-a-date'}),/未来/);
});
for(const size of [0,1,1024*1024,1024*1024+1]) test(`empty and tail blocks: ${size} bytes`,async t=>{
 const f=await fixture(t,size);const p=await f.e.openPlayback({filePath:f.output,licenseId:f.lic.payload.id});assert.deepEqual(await f.e.readPlayback({sessionId:p.sessionId}),f.plain);
 await assert.rejects(f.e.encryptVideo({inputPath:f.input,outputPath:f.input}),/覆盖/);await assert.rejects(f.e.encryptVideo({inputPath:f.input,outputPath:f.output}),/已存在/);assert.deepEqual(await fs.readFile(f.input),f.plain);
});
test('active playback stops at expiry, exhausted license permits already opened session',async t=>{
 const f=await fixture(t);const lic=await f.e.issueLicense({videoIds:[f.v.videoId],expiresAt:Date.now()+10000,maxPlays:1});const p=await f.e.openPlayback({filePath:f.output,licenseId:lic.payload.id});assert.equal(f.e.getSessionStatus(p.sessionId).valid,true);assert.equal(f.e.getSessionStatus(p.sessionId).reason,'');assert.deepEqual(await f.e.readPlayback({sessionId:p.sessionId,start:0,end:31}),f.plain.subarray(0,32));
 const now=Date.now;Date.now=()=>now()+20000;try {assert.equal(f.e.getSessionStatus(p.sessionId).valid,false);assert.match(f.e.getSessionStatus(p.sessionId).reason,/过期/);await assert.rejects(f.e.readPlayback({sessionId:p.sessionId,start:0,end:31}),/过期/);}finally{Date.now=now;}
});
test('progress callbacks report final byte totals and callback errors do not break encryption',async t=>{
 const f=await fixture(t);const progress=[];const output=path.join(f.dir,'progress.vdrm');await f.e.encryptVideo({inputPath:f.input,outputPath:output,onProgress:async p=>{progress.push(p);throw new Error('UI disconnected');}});assert.equal(progress.length,2);assert.equal(progress.at(-1).percent,100);assert.equal(progress.at(-1).processedBytes,f.plain.length);assert.equal(progress.at(-1).totalBytes,f.plain.length);
 await assert.rejects(f.e.encryptVideo({inputPath:f.input,outputPath:path.join(f.dir,'bad.vdrm'),mime:'video/mp4\r\nX-Evil: yes'}),/媒体类型/);
 assert.equal(f.e.getSessionStatus('missing').valid,false);
});
