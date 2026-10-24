import {net} from 'electron';
// Use the system's Chromium network stack, including proxy settings. Handle
// manual redirects explicitly: net.fetch rejects them instead of exposing 302.
export function desktopFetch(session){return (url,options={})=>new Promise((resolve,reject)=>{
 let finished=false;const signal=options.signal;
 const req=net.request({url:String(url),method:options.method||'GET',session,redirect:'manual',credentials:options.credentials||'omit',cache:'no-store'});
 const cleanup=()=>signal?.removeEventListener('abort',abort);
 const fail=error=>{if(finished)return;finished=true;cleanup();reject(error);req.abort();};
 const done=response=>{if(finished)return;finished=true;cleanup();resolve(response);};
 const abort=()=>fail(signal.reason||new DOMException('Aborted','AbortError'));
 if(signal?.aborted){abort();return;}signal?.addEventListener('abort',abort,{once:true});
 for(const [key,value] of Object.entries(options.headers||{}))req.setHeader(key,value);
 req.on('redirect',(status,method,location,raw)=>{
  if(options.redirect!=='manual'){fail(Error('拒绝意外的网络跳转'));return;}
  const headers=new Headers();for(const [key,value]of Object.entries(raw||{}))for(const v of Array.isArray(value)?value:[value])headers.append(key,v);
  headers.set('location',location);done(new Response(null,{status,headers}));req.abort();
 });
 req.on('error',fail);req.on('response',response=>{let size=0;const chunks=[];
  response.on('error',fail);response.on('data',chunk=>{size+=chunk.length;if(size>1048576)fail(Error('服务器响应过大'));else chunks.push(chunk);});
  response.on('end',()=>{const headers=new Headers();for(const[key,value]of Object.entries(response.headers))for(const v of Array.isArray(value)?value:[value])headers.append(key,v);done(new Response([204,205,304].includes(response.statusCode)?null:Buffer.concat(chunks),{status:response.statusCode,headers}));});
 });
 req.end(options.body?.toString());
});}
