import {promises as fs} from 'node:fs';import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..'),release=path.dirname(root),kit=path.join(release,'授权服务');
await fs.mkdir(path.join(kit,'src/core'),{recursive:true});
await fs.cp(path.join(root,'server'),path.join(kit,'server'),{recursive:true});
for(const file of ['online.mjs','policy.mjs','groups.mjs'])await fs.copyFile(path.join(root,'src/core',file),path.join(kit,'src/core',file));
console.log('维护包已同步至本地优化版；线上服务器未修改。');
