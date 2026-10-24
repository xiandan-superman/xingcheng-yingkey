import {promises as fs} from 'node:fs';
import path from 'node:path';
import {packager} from '@electron/packager';
const root=path.resolve(import.meta.dirname,'..'),out=path.resolve(root,'..');
await fs.mkdir(out,{recursive:true});
const shared=`星橙·映钥 v0.10.5（Windows 10/11 64位）

管理端必须先使用量子星橙账号登录，并具备映钥操作权限，才能进入工作台。登录失效、被停用、撤权或暂时无法验证时，不允许新业务操作；旧账号和全局连接文件不能跳过验证。
账号中心：https://account.qstarorange.com/
公司服务：https://video-auth.qstarorange.com/
管理端在独立登录窗口输入统一账号与密码，直接完成登录；密码只发送到账号中心，不保存到本机。

观看方使用独立播放器，不需要员工账号。首次观看：导出设备请求 -> 员工签发许可 -> 收到视频和许可 -> 导入许可、打开视频并验证播放。

完整解压再运行，不要仅复制exe。升级前先关闭旧版；原有本机密钥、视频、许可和历史保留，不要自行删除数据目录或防护记录。
在线许可须完成后台登记。选择文件不计次；成功开始新播放计次，同次暂停继续不重复计次。正常联网约20秒复查，断网宽限最多90秒。离线许可无法远程收回。
试看由桌面管理端按需生成。动态水印、拖动和倍速按签名许可执行；窗口捕获保护和水印不能保证阻止所有录制方式。
详细操作见对应角色的“先读我”。下载包不含真实账号、服务密钥、课程或许可。发布页提供完整角色包及SHA-256校验文件。
`;
await fs.writeFile(path.join(out,'使用说明.txt'),shared,'utf8');
for(const player of process.argv.includes('--player-only')?[true]:process.argv.includes('--manager-only')?[false]:[false,true]){
 const stage=path.join(root,player?'player-app-v8':'manager-app-v8');
 await fs.mkdir(path.join(stage,'src'),{recursive:true});
 await fs.cp(path.join(root,'src','core'),path.join(stage,'src','core'),{recursive:true});await fs.cp(path.join(root,'src','ui'),path.join(stage,'src','ui'),{recursive:true});
 for(const f of ['desktop-network.mjs','native-account-login.mjs','manager-access.mjs','work-log.mjs','video-compatibility.mjs','batch-encryption.mjs','media-server.mjs','local-guard.mjs','online-admin.mjs','chinese-menu.mjs'])await fs.copyFile(path.join(root,'src',f),path.join(stage,'src',f));
 if(player){await fs.cp(path.join(root,'src','player'),path.join(stage,'src','player'),{recursive:true});}
 else{for(const f of ['main.mjs','preload.cjs'])await fs.copyFile(path.join(root,'src',f),path.join(stage,'src',f));await fs.cp(path.join(root,'src','renderer'),path.join(stage,'src','renderer'),{recursive:true});await fs.mkdir(path.join(stage,'assets'),{recursive:true});await fs.copyFile(path.join(root,'assets','demo.mp4'),path.join(stage,'assets','demo.mp4'));}
 const name=player?'星橙·映钥播放器':'星橙·映钥管理端';
 await fs.mkdir(path.join(stage,'assets'),{recursive:true});for(const f of ['brand.ico','brand.png'])await fs.copyFile(path.join(root,'assets',f),path.join(stage,'assets',f));
 await fs.writeFile(path.join(stage,'package.json'),JSON.stringify({name:player?'starorange-yingkey-player':'starorange-yingkey-manager',productName:name,version:'0.10.5',private:true,type:'module',main:player?'src/player/main.mjs':'src/main.mjs'},null,2));
 await fs.writeFile(path.join(stage,'使用说明.txt'),shared,'utf8');
 const extraResource=player?[]:[path.join(root,'node_modules','ffmpeg-static','ffmpeg.exe'),path.join(root,'node_modules','ffmpeg-static','LICENSE'),path.join(root,'assets','demo.mp4')];
 const paths=await packager({dir:stage,name,platform:'win32',arch:'x64',electronVersion:'44.9.0',electronZipDir:process.env.YINGKEY_ELECTRON_ZIP_DIR||undefined,out,overwrite:true,asar:true,prune:false,extraResource,icon:path.join(root,'assets','brand.ico'),win32metadata:{CompanyName:'星橙',ProductName:'星橙·映钥',FileDescription:name}});console.log(paths.join('\n'));
}

