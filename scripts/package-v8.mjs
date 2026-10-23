import {promises as fs} from 'node:fs';
import path from 'node:path';
import {packager} from '@electron/packager';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'..');
await fs.mkdir(out,{recursive:true});
const shared=`星橙·映钥 v0.9.0（Windows 10/11 64位）

管理端给发片方，独立播放器给观看方。请先关闭旧版，再运行新版；旧版应用数据位置保留，首次启动会升级本机防护记录。升级后不要继续运行旧版，否则其写入可能触发完整性保护。不要删除数据目录、注册表或防回滚标记。

加密时可设置0至120秒试看：未授权方只能打开实际截取的试看片段。完整视频需导入设备许可。新版生成的视频与许可需要新版播放器；旧文件仍可打开。新播放策略需重新签发新版许可；已发出的旧版离线许可无法远程收回。

签发许可时可设置动态水印文字、是否允许倍速、是否允许拖动；未勾选的允许项在独立播放器中禁用。策略经过签名，不能直接修改许可文字解除限制。管理端内置页用于预览，学员权限请用独立播放器验收。

播放器已接入Windows窗口捕获保护；该机制不能保证阻止摄像头、采集卡或所有捕获方式。水印随时间移动，包含设备/许可标识；全屏保留水印。

本地计数经过完整性验证，并使用独立的Windows安全存储标记检测时间回拨和数据回滚。它不能抵御管理员清除或还原整套系统；异常时会停止验证，不会自动清零次数。

新增在线授权：授权管理页导入服务连接文件（仅发片方保管，不能发送给观看方），签发时勾选在线验证。加密完成只保存本地记录，不再弹窗；授权完成后统一确认上传文件记录及授权记录。也可从文件列表手动提前上传。确认上传后后台形成记录；在线许可上传完成后才能观看。稍后上传可在文件或授权列表重试。可填写文件名称、设备备注；允许网页签发需要勾选加密备份签名密钥。观看方只需播放器，不需要Tailscale。播放前须联网，播放中每20秒复查；从最后一次成功验证起最多90秒断网宽限，到期停止。管理端点击远程停用，正常联网情况下约20秒内响应；网络异常时最迟到宽限结束。恢复授权后，观看方重新点击验证播放。次数以服务器记录为准。服务器关机、休眠或断网将影响在线授权。旧离线许可不能变成在线许可，也不能被远程收回，必须重新签发。多设备名额管理未加入；每份许可绑定一份设备请求。

网页控制台：https://video-auth.qstarorange.com。网页可在浏览器本地加密并保存视频、签发在线许可、管理文件和成员。网页本版不生成试看；试看请使用桌面管理端。密码最少6位；默认最长8小时、闲置30分钟，管理员可配置。可以查看、搜索授权，停用/恢复观看权限，补登记许可，编辑备注与查看操作记录。桌面管理端与网页端均可加密和授权；只读成员不能执行写操作，只有管理员能管理成员及查看封装密钥。管理员初始登录信息单独保存在受限目录；不随交付包提供。登录后可在账号安全修改密码。

在线服务连接文件请单独保管并备份。不要将它放进观看方文件夹。服务器在提供的Windows电脑上自动启动，通过HTTPS公网入口服务；管理端可导入连接文件，刷新在线授权状态。

第一次观看：播放器导出设备请求 -> 发片方管理端导入并签发 -> 发送加密视频和导出的许可 -> 播放器导入许可、打开视频并验证播放。
`;
await fs.writeFile(path.join(out,'使用说明.txt'),shared,'utf8');
for(const player of process.argv.includes('--player-only')?[true]:process.argv.includes('--manager-only')?[false]:[false,true]){
 const stage=path.join(root,player?'player-app-v8':'manager-app-v8');
 await fs.mkdir(path.join(stage,'src'),{recursive:true});
 await fs.cp(path.join(root,'src','core'),path.join(stage,'src','core'),{recursive:true});await fs.cp(path.join(root,'src','ui'),path.join(stage,'src','ui'),{recursive:true});
 for(const f of ['video-compatibility.mjs','batch-encryption.mjs','media-server.mjs','local-guard.mjs','online-admin.mjs','chinese-menu.mjs'])await fs.copyFile(path.join(root,'src',f),path.join(stage,'src',f));
 if(player){await fs.cp(path.join(root,'src','player'),path.join(stage,'src','player'),{recursive:true});}
 else{for(const f of ['main.mjs','preload.cjs'])await fs.copyFile(path.join(root,'src',f),path.join(stage,'src',f));await fs.cp(path.join(root,'src','renderer'),path.join(stage,'src','renderer'),{recursive:true});await fs.mkdir(path.join(stage,'assets'),{recursive:true});await fs.copyFile(path.join(root,'assets','demo.mp4'),path.join(stage,'assets','demo.mp4'));}
 const name=player?'星橙·映钥播放器':'星橙·映钥管理端';
 await fs.mkdir(path.join(stage,'assets'),{recursive:true});for(const f of ['brand.ico','brand.png'])await fs.copyFile(path.join(root,'assets',f),path.join(stage,'assets',f));
 await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:player?'starorange-yingkey-player':'starorange-yingkey-manager',productName:name,version:'0.9.0',private:true,type:'module',main:player?'src/player/main.mjs':'src/main.mjs'},null,2));
 await fs.writeFile(path.join(stage,'使用说明.txt'),shared,'utf8');
 const extraResource=player?[]:[path.join(root,'node_modules','ffmpeg-static','ffmpeg.exe'),path.join(root,'node_modules','ffmpeg-static','LICENSE'),path.join(root,'assets','demo.mp4')];
 const paths=await packager({dir:stage,name,platform:'win32',arch:'x64',electronVersion:'44.9.0',electronZipDir:process.env.YINGKEY_ELECTRON_ZIP_DIR||undefined,out,overwrite:true,asar:true,prune:false,extraResource,icon:path.join(root,'assets','brand.ico'),win32metadata:{CompanyName:'星橙',ProductName:'星橙·映钥',FileDescription:name}});console.log(paths.join('\n'));
}

