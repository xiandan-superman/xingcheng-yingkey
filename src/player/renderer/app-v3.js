'use strict';
const api=window.viewer,$=s=>document.querySelector(s);
let current=null,playback=null,timer=null,data={licenses:[]},lastTime=0,watermarkTick=0,playlist=[],actionBusy=false;
function message(text,error=false){$('#message').textContent=text;$('#message').classList.toggle('error',error);$('#message').setAttribute('role',error?'alert':'status');updateViewState();}
async function action(fn){if(actionBusy)return;actionBusy=true;document.body.setAttribute('aria-busy','true');const locked=[...document.querySelectorAll('button')].filter(b=>!b.disabled);locked.forEach(b=>{b.disabled=true;});try{return await fn();}catch(e){message((e.message||'操作失败').replace(/^Error invoking remote method '[^']+': Error: /,''),true);}finally{actionBusy=false;locked.forEach(b=>{b.disabled=false;});$('#play').disabled=!current;$('#close').disabled=!current;$('#preview').disabled=!current?.previewSeconds;$('#pause').disabled=$('#fullscreen').disabled=!playback;document.body.removeAttribute('aria-busy');updateViewState();}}
function date(value){return value?new Date(value).toLocaleString('zh-CN'):'不设期限';}
function active(l){return !l.revoked&&(!l.expiresAt||Date.parse(l.expiresAt)>Date.now())&&l.playsUsed<l.maxPlays;}
function stamp(n){return `${Math.floor((n||0)/60).toString().padStart(2,'0')}:${Math.floor((n||0)%60).toString().padStart(2,'0')}`;}
async function refresh(){
 data=await api.getState();const selected=$('#license').value;$('#license').replaceChildren(new Option('请选择播放许可',''));
 for(const l of data.licenses.filter(l=>!current||l.videoIds.includes(current.videoId)))$('#license').append(new Option(`${l.courseNames} · ${l.expiresAt&&Date.parse(l.expiresAt)<=Date.now()?'已到期':l.revoked?'本机已撤销':l.playsUsed>=l.maxPlays?'次数用尽':l.online?'在线验证':`剩余 ${Math.max(0,l.maxPlays-l.playsUsed)} 次`}`,l.id));
 if(selected&&[...$('#license').options].some(o=>o.value===selected))$('#license').value=selected;else if($('#license').options.length===2)$('#license').selectedIndex=1;
 $('#count').textContent=`（${data.licenses.length}）`;$('#licenses').replaceChildren();
 for(const l of data.licenses){const row=document.createElement('div');row.className='license-row';const name=document.createElement('strong');name.textContent=l.courseNames;const meta=document.createElement('div');meta.className='meta';meta.textContent=`${l.revoked?'本机已撤销':l.expiresAt&&Date.parse(l.expiresAt)<=Date.now()?'已到期':l.playsUsed>=l.maxPlays?'次数用尽':l.online?'在线验证':'离线有效'} · ${l.online?'本机最近记录':'已使用'} ${l.playsUsed} / ${l.maxPlays} 次 · ${date(l.expiresAt)} · ${l.policy?.allowSeek?'允许拖动':'禁止拖动'} / ${l.policy?.allowRate?'允许倍速':'正常速度'}`;row.append(name,meta);$('#licenses').append(row);}
 if(!data.licenses.length)$('#licenses').textContent='尚未导入许可。';$('#first-use').hidden=data.licenses.length>0;updateViewState();
 $('#protection').textContent=data.captureProtection?'Windows 窗口捕获保护已开启；不保证阻止外部摄像或所有录制方式。':'窗口捕获保护未启用，请联系发片方。';
}
function updateViewState(){const primary=$('#play'),paid=Boolean(playback&&!playback.preview),paused=$('#video').paused;const label=paid?(paused?'继续播放':'正在播放'):'验证并播放';if(primary.dataset.label!==label){primary.dataset.label=label;primary.replaceChildren();if(window.yingkeyUI)primary.append(yingkeyUI.icon('play'));primary.append(document.createTextNode(label));}primary.disabled=actionBusy||!current||(paid&&!paused);const tag=$('#play-status');tag.textContent=playback?(playback.preview?'正在试看':$('#video').paused?'已暂停':'正在播放'):current?'待验证播放':'待选择视频';tag.classList.toggle('playing',Boolean(playback));document.querySelectorAll('#playlist button').forEach((b,i)=>b.setAttribute('aria-current',String(playlist[i]?.filePath===current?.filePath)));}
async function stop(){
 clearInterval(timer);timer=null;const s=playback;playback=null;lastTime=0;
 const v=$('#video');v.pause();v.removeAttribute('src');v.load();v.hidden=true;$('#watermark').hidden=true;$('#placeholder').hidden=false;$('#transport').hidden=true;
 if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});if(s)await api.close(s.sessionId).catch(()=>{});
}
async function open(){
 const file=await api.chooseVideo();if(!file)return;await selectPlaylistVideo(file);
}
async function selectPlaylistVideo(file){
 await stop();current=file;$('#title').textContent=file.title;$('#course').textContent='文件内课程：'+file.courseId;$('#play').disabled=false;$('#close').disabled=false;$('#preview').disabled=!file.previewSeconds;$('#preview').textContent=file.previewSeconds?`试看 ${file.previewSeconds} 秒`:'无试看';await refresh();
 message($('#license').options.length>1?'视频已打开，点击“验证并播放”。':file.previewSeconds?'可以先试看，完整观看需要导入许可。':'视频已打开，请先导入对应播放许可。');
}
function renderPlaylist(){const list=$('#playlist');list.replaceChildren();for(const file of playlist){const button=document.createElement('button');button.textContent=file.title+' · '+file.courseId;button.onclick=()=>action(()=>selectPlaylistVideo(file));button.setAttribute('aria-current',String(file.filePath===current?.filePath));list.append(button);}$('#playlist-count').textContent=String(playlist.length);if(!playlist.length){const empty=document.createElement('p');empty.className='list-empty';empty.textContent='暂无视频，可从上方添加。';list.append(empty);}}
$('#add-videos').onclick=()=>action(async()=>{const result=await api.chooseVideos();if(!result)return;const all=new Map(playlist.map(v=>[v.filePath,v]));for(const video of result.videos)all.set(video.filePath,video);playlist=[...all.values()].sort((a,b)=>a.title.localeCompare(b.title,'zh-CN',{numeric:true}));renderPlaylist();message(`已加入 ${result.videos.length} 个视频。点击列表选择，再点击“验证并播放”。`+(result.errors.length?` ${result.errors.length} 个文件无法读取：`+result.errors.slice(0,3).map(e=>e.filename+'（'+e.error+'）').join('；'):''),Boolean(result.errors.length));});
function watermark(time){
 if(!playback)return;const p=playback.policy,w=$('#watermark');w.hidden=!p.watermark;
 if(!p.watermark)return;const label=p.watermarkText==='星橙·映钥'?'星橙·映钥':`星橙·映钥 · ${p.watermarkText}`;
 w.textContent=`${label}\n设备 ${playback.deviceLabel} · ${playback.licenseLabel}\n${new Date(time).toLocaleString('zh-CN')}`;
 w.className='wm-pos-'+(Math.floor(watermarkTick++/12)%6);
}
async function showSession(s){
 playback=s;const v=$('#video');lastTime=0;watermarkTick=0;v.src=s.url;v.hidden=false;v.playbackRate=1;$('#rate').value='1';$('#placeholder').hidden=true;$('#transport').hidden=false;
 $('#seek').disabled=!s.policy.allowSeek;$('#rate').disabled=!s.policy.allowRate;
 watermark(Date.now());await refresh();try{await v.play();message(s.preview?'正在试看，结束后需导入正式许可。':`${s.online?'在线验证通过，每20秒复查，断网宽限90秒。':'许可验证通过。'}${s.policy.allowSeek?'允许拖动':'禁止拖动'}，${s.policy.allowRate?'允许倍速':'仅正常速度'}。`);}catch{message('许可已验证，点击“暂停 / 继续”开始观看。');}
 if(playback?.sessionId!==s.sessionId)return;const id=s.sessionId;let checking=false;
 timer=setInterval(async()=>{if(checking)return;checking=true;try{const status=await api.status(id);if(playback?.sessionId!==id)return;if(!status.valid){await stop();if(!playback){await refresh();message(status.reason||'授权已失效，播放已停止。',true);}}else watermark(status.clockTime);}catch{if(playback?.sessionId===id){await stop();await refresh();message('无法校验播放权限，已停止播放，请重新验证。',true);}}finally{checking=false;}},500);
}
async function play(){if(playback&&!playback.preview){if($('#video').paused)await $('#video').play();updateViewState();return;}if(!current)throw Error('请先打开视频');const id=$('#license').value;if(!id)throw Error('请先导入并选择对应许可');await stop();message('正在核验完整视频与播放许可，请稍候；大文件需要更长时间。');await showSession(await api.play({filePath:current.filePath,licenseId:id}));}
async function preview(){if(!current?.previewSeconds)throw Error('这个视频没有试看内容');await stop();await showSession(await api.preview(current.filePath));}
function toggle(){const v=$('#video');if(!playback)return;if(v.paused)v.play().catch(()=>message('无法恢复播放',true));else v.pause();}
$('#export').onclick=()=>action(async()=>{if(await api.exportRequest())message('设备请求已保存，请交给发片方。');});
$('#import').onclick=()=>action(async()=>{if(await api.importLicense()){await stop();await refresh();message('许可已导入，打开对应视频即可观看。');}});
$('#open').onclick=$('#first-open').onclick=()=>action(open);$('#play').onclick=()=>action(play);$('#preview').onclick=()=>action(preview);
$('#close').onclick=()=>action(async()=>{await stop();current=null;$('#title').textContent='尚未打开视频';$('#course').textContent='支持 .vdrm 加密视频';for(const id of ['play','preview','close'])$('#'+id).disabled=true;await refresh();message('视频已关闭。');});
for(const event of ['play','pause'])$('#video').addEventListener(event,updateViewState);
$('#pause').onclick=toggle;$('#fullscreen').onclick=()=>action(()=>$('#stage').requestFullscreen());
$('#seek').addEventListener('input',()=>{if(playback?.policy.allowSeek)$('#video').currentTime=Number($('#seek').value)/1000*$('#video').duration;});
$('#rate').addEventListener('change',()=>{$('#video').playbackRate=playback?.policy.allowRate?Number($('#rate').value):1;});
$('#video').addEventListener('ratechange',()=>{if(playback&&!playback.policy.allowRate&&$('#video').playbackRate!==1)$('#video').playbackRate=1;});
$('#video').addEventListener('seeking',()=>{const v=$('#video');if(playback&&!playback.policy.allowSeek&&Math.abs(v.currentTime-lastTime)>.08){v.currentTime=lastTime;message('这份许可禁止拖动播放进度。');}});
$('#video').addEventListener('timeupdate',()=>{const v=$('#video');if(!v.seeking)lastTime=v.currentTime;$('#position').textContent=`${stamp(v.currentTime)} / ${stamp(v.duration)}`;$('#seek').value=Number.isFinite(v.duration)&&v.duration?Math.round(v.currentTime/v.duration*1000):0;});
$('#video').addEventListener('ended',()=>action(async()=>{const trial=playback?.preview;await stop();await refresh();message(trial?'试看结束，请导入正式许可观看完整视频。':'本次播放已结束。再次观看请点击“验证并播放”。');}));
$('#video').addEventListener('error',()=>{if(!playback)return;stop().then(()=>refresh()).catch(()=>{}).finally(()=>message('视频无法解码或文件读取失败，已停止播放。',true));});
document.addEventListener('contextmenu',e=>e.preventDefault());document.addEventListener('keydown',e=>{if(e.code==='Space'&&playback&&!['INPUT','SELECT','BUTTON'].includes(e.target.tagName)){e.preventDefault();toggle();}if(playback&&!playback.policy.allowSeek&&['ArrowLeft','ArrowRight','Home','End'].includes(e.code))e.preventDefault();});
window.addEventListener('beforeunload',()=>{if(playback)api.close(playback.sessionId).catch(()=>{});});
action(refresh);
