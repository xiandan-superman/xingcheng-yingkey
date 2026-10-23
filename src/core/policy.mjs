export function playbackPolicy(value,legacy=false){
 const defaults={watermark:true,watermarkText:'星橙·映钥',allowSeek:legacy,allowRate:legacy,captureProtection:true};
 if(value==null)return defaults;
 if(typeof value!=='object'||Array.isArray(value))throw Error('播放策略无效');
 const p={...defaults};for(const k of ['watermark','allowSeek','allowRate','captureProtection']){if(value[k]!==undefined){if(typeof value[k]!=='boolean')throw Error('播放策略开关无效');p[k]=value[k];}}
 if(value.watermarkText!==undefined){if(typeof value.watermarkText!=='string'||value.watermarkText.length>80||/[\x00-\x1f]/.test(value.watermarkText))throw Error('水印文字须为80字以内的单行文本');p.watermarkText=value.watermarkText.trim()||'星橙·映钥';}
 return p;
}
