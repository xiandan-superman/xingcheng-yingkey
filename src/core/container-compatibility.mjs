// Inspect MP4/MOV sample descriptions, without writing decrypted video to disk.
// Unknown formats keep the existing authenticated-stream behavior.
const containers=new Set(['moov','trak','mdia','minf','stbl']);
const unsupported=new Set(['apco','apcs','apcn','apch','ap4h','ap4x','jpeg','mjpa','mjpb','rle ','raw ','2vuy','yuv2','mp4v','hvc1','hev1']);
export async function checkContainerCompatibility(read,size){
 if(size<16)return;
 const first=await read(0,16);
 if(!['ftyp','wide','free','mdat','moov'].includes(first.toString('ascii',4,8)))return;
 let position=0,count=0;
 while(position+8<=size){
  const head=await read(position,Math.min(16,size-position));let length=head.readUInt32BE(0),header=8;
  if(length===1){if(head.length<16)return;const n=head.readBigUInt64BE(8);if(n>BigInt(Number.MAX_SAFE_INTEGER))return;length=Number(n);header=16;}
  if(length===0)length=size-position;
  if(length<header||position+length>size||++count>10000)return;
  if(head.toString('ascii',4,8)==='moov'){
   if(length>32*1048576)throw Error('视频封装信息过大，请先转为标准 MP4 / H.264 与 AAC，再观看。尚未扣除播放次数。');
   const bytes=await read(position+header,length-header);inspect(bytes,0,bytes.length,0);return;
  }
  position+=length;
 }
}
function inspect(bytes,start,end,depth){
 if(depth>12)return;
 for(let p=start;p+8<=end;){const size=bytes.readUInt32BE(p),type=bytes.toString('ascii',p+4,p+8);if(size<8||p+size>end)return;
  if(containers.has(type))inspect(bytes,p+8,p+size,depth+1);
  if(type==='stsd'&&size>=16){const entries=bytes.readUInt32BE(p+12);let item=p+16;for(let i=0;i<entries&&item+8<=p+size;i++){const length=bytes.readUInt32BE(item),codec=bytes.toString('ascii',item+4,item+8);if(length<8||item+length>p+size)break;if(unsupported.has(codec))throw Error('该视频编码（'+codec.trim()+'）不受播放器支持，请联系发片方转为 MP4 / H.264 与 AAC。尚未扣除播放次数。');item+=length;}}
  p+=size;
 }
}
