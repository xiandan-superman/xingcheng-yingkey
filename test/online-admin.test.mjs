import test from 'node:test';import assert from 'node:assert/strict';import {promises as fs} from 'node:fs';import os from 'node:os';import path from 'node:path';import {createOnlineAdmin} from '../src/online-admin.mjs';import {createAuthorizationServer} from '../server/server.mjs';
test('unreadable saved connection does not block startup or erase data, and reimport recovers',async t=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'yingkey-connection-'));const server=await createAuthorizationServer({dataDir:path.join(dir,'server')});t.after(async()=>{await server.close();await fs.rm(dir,{recursive:true,force:true});});
 const file=path.join(dir,'online-admin.sealed'),broken=Buffer.from('not decryptable');await fs.writeFile(file,broken);const admin=await createOnlineAdmin({dataDir:dir,seal:b=>b,unseal:()=>{throw Error('decrypt failed');}});
 assert.equal(admin.publicConfig,null);assert.match(admin.recoveryMessage,/重新导入/);assert.deepEqual(await fs.readFile(file),broken);await assert.rejects(admin.request('status'),/先连接/);
 const cfg={url:'http://127.0.0.1:'+server.port,publicKey:server.publicKey,adminToken:server.adminToken};await assert.rejects(admin.connect({...cfg,adminToken:'x'.repeat(32)}));assert.deepEqual(await fs.readFile(file),broken);
 await admin.connect(cfg);assert.equal(admin.recoveryMessage,null);assert.equal(admin.publicConfig.url,cfg.url);
 const reopened=await createOnlineAdmin({dataDir:dir,seal:b=>b,unseal:b=>b});assert.equal(reopened.publicConfig.url,cfg.url);assert.ok(await reopened.request('status'));
});
