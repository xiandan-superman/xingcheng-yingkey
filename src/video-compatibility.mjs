import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
const run=promisify(execFile);
const videoCodecs=new Set(['h264','vp8','vp9','av1','theora']);
const audioCodecs=new Set(['aac','mp3','opus','vorbis','flac']);
export async function checkVideoCompatibility({inputPath,ffmpegPath,signal}){
 let description='';
 try{const result=await run(ffmpegPath,['-hide_banner','-nostdin','-i',inputPath],{windowsHide:true,timeout:15000,maxBuffer:1048576,signal});description=result.stderr;}
 catch(e){if(e.name==='AbortError')throw e;if(e.code!==1||!e.stderr)throw Error('无法检查视频兼容性，请检查文件读取权限及加密组件。');description=e.stderr;}
 const video=[...description.matchAll(/Stream[^\r\n]*Video:\s*([a-z0-9_]+)/gi)].map(m=>m[1].toLowerCase());
 const audio=[...description.matchAll(/Stream[^\r\n]*Audio:\s*([a-z0-9_]+)/gi)].map(m=>m[1].toLowerCase());
 if(!video.length)throw Error('未检测到有效视频，请选择完整且可读取的视频文件。');
 if(video.some(c=>!videoCodecs.has(c))||audio.some(c=>!audioCodecs.has(c)))throw Error('当前视频或音频编码不受播放器支持（'+[...video,...audio].join('、')+'）。请先转为 MP4 / H.264 视频与 AAC 音频，再加密。未生成加密文件。');
 return {videoCodecs:video,audioCodecs:audio};
}
