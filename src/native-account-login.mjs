const ACCOUNT='https://account.qstarorange.com',SERVICE='https://video-auth.qstarorange.com';
// The account password is sent only to the account center. The service still
// receives a one-use authorization code and verifies PKCE, state and signatures.
export async function completeAccountLogin({loginUrl,username,password,newPassword,fetch,signal}){
 if(typeof username!=='string'||!username.trim()||typeof password!=='string'||!password)throw Error('请输入账号和密码');
 if(username.length>128||password.length>1024)throw Error('账号或密码长度不正确');
 const start=new URL(loginUrl);if(start.origin!==SERVICE||start.pathname!=='/sso/start')throw Error('登录地址无效');
 async function request(url,options={}){
  const target=new URL(url);if(![ACCOUNT,SERVICE].includes(target.origin))throw Error('登录跳转地址不受信任');
  signal?.throwIfAborted();
  try{return await fetch(target.href,{...options,credentials:'include',redirect:'manual',cache:'no-store',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(20000)]):AbortSignal.timeout(20000)});}catch(e){if(signal?.aborted)throw e;throw Error('网络连接失败，请检查网络后重试');}
 }
 async function json(response){let value;try{value=await response.json();}catch{throw Error('账号服务响应异常，请稍后重试');}if(!response.ok)throw Error(value.message||value.error_description||value.error||'登录失败，请重试');return value;}
 let csrf=(await json(await request(ACCOUNT+'/api/session'))).csrf;
 let logged=await json(await request(ACCOUNT+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:ACCOUNT},body:JSON.stringify({username:username.trim(),password})}));
 if(logged.user?.must_change){
  if(!newPassword)throw Error('首次登录需要修改密码，请设置新密码');
  if(typeof newPassword!=='string'||newPassword.length<10||newPassword.length>128)throw Error('新密码须为10至128个字符');
  await json(await request(ACCOUNT+'/api/profile',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':logged.csrf,Origin:ACCOUNT},body:JSON.stringify({old_password:password,new_password:newPassword})}));
  csrf=(await json(await request(ACCOUNT+'/api/session'))).csrf;
  logged=await json(await request(ACCOUNT+'/api/login',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':csrf,Origin:ACCOUNT},body:JSON.stringify({username:username.trim(),password:newPassword})}));
 }
 password='';newPassword='';
 csrf=logged.csrf;
 const initial=await request(start.href),authorize=new URL(initial.headers.get('location')||'',SERVICE);
 if(authorize.origin!==ACCOUNT||authorize.pathname!=='/oauth/authorize'||authorize.searchParams.get('client_id')!=='yingkey'||authorize.searchParams.get('redirect_uri')!==SERVICE+'/sso/callback')throw Error('账号平台配置不正确');
 const consent=await request(authorize.href);
 if(!consent.ok){await json(consent);throw Error('当前账号没有映钥使用权限，请联系管理员');}
 const granted=await request(authorize.href,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded',Origin:ACCOUNT},body:new URLSearchParams({csrf,approve:'yes'}).toString()});
 if(granted.status!==302&&granted.status!==303){await json(granted);throw Error('账号授权失败，请重试');}
 const callback=new URL(granted.headers.get('location')||'',ACCOUNT);
 if(callback.origin!==SERVICE||callback.pathname!=='/sso/callback')throw Error('账号回调地址无效');
 const done=await request(callback.href);if(!done.ok){await json(done);throw Error('登录验证失败，请重试');}
 await done.body?.cancel();
}
