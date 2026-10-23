import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {pipeline} from 'node:stream/promises';

export function parseRange(value,size){
  if(!value)return {start:0,end:size-1,partial:false};
  const match=/^bytes=(\d*)-(\d*)$/.exec(value);
  if(!match||(!match[1]&&!match[2])||size===0)throw Error('无效的视频范围');
  let start,end;
  if(!match[1]){const count=Number(match[2]);if(!Number.isSafeInteger(count)||count<=0)throw Error('无效的视频范围');start=Math.max(0,size-count);end=size-1;}
  else{start=Number(match[1]);end=match[2]?Number(match[2]):size-1;}
  if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||start>=size||end<start)throw Error('无效的视频范围');
  return {start,end:Math.min(end,size-1),partial:true};
}

export async function createMediaServer(engine){
  const sessions=new Map();let port;
  const server=http.createServer(async(req,res)=>{
    res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');
    if(req.headers.host!==`127.0.0.1:${port}`||!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
    if(req.headers.origin&&!['null','file://'].includes(req.headers.origin)){res.writeHead(403).end();return;}
    const match=/^\/media\/([a-f0-9-]+)\/([A-Za-z0-9_-]+)$/.exec(req.url||'');
    const info=match&&sessions.get(match[1]);
    if(!info||info.token!==match[2]){res.writeHead(404).end();return;}
    const status=engine.getSessionStatus(info.sessionId);
    if(!status.valid){res.writeHead(403,{'Content-Type':'text/plain; charset=utf-8'}).end(status.reason);return;}
    let range;try{range=parseRange(req.method==='GET'?req.headers.range:undefined,info.size);}catch{res.writeHead(416,{'Content-Range':`bytes */${info.size}`}).end();return;}
    res.setHeader('Content-Type',info.mime);res.setHeader('Accept-Ranges','bytes');res.setHeader('Content-Length',Math.max(0,range.end-range.start+1));
    if(range.partial)res.setHeader('Content-Range',`bytes ${range.start}-${range.end}/${info.size}`);
    res.statusCode=range.partial?206:200;
    if(req.method==='HEAD'||info.size===0){res.end();return;}
    try{await pipeline(engine.createPlaybackStream({sessionId:info.sessionId,start:range.start,end:range.end}),res);}catch{if(!res.destroyed)res.destroy();}
  });
  server.on('clientError',(_err,socket)=>socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'));
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',()=>{port=server.address().port;resolve();});});
  return {
    add(info){const token=randomBytes(24).toString('base64url');sessions.set(info.sessionId,{...info,token});return {...info,url:`http://127.0.0.1:${port}/media/${info.sessionId}/${token}`};},
    remove(id){sessions.delete(id);engine.closePlayback(id);},
    async close(){for(const id of sessions.keys())engine.closePlayback(id);sessions.clear();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
  };
}
