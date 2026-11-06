(function(root){
  'use strict';
  const VERSION='0.1.6';
  const METHODS=['snapshot','apply','discard','submit','persisted','diagnose','serverSnapshot','serverCommit','serverVerify','serverRelease'];
  const refresh='请先保留或保存人工编辑，在 chrome://extensions 重新加载本扩展并重新打开助手；如仍提示评分页版本不一致，保存人工编辑后刷新原评分页。成绩计划不用重新转换。';
  class ChromeBridge {
    constructor(api,target){this.api=api;this.target=target;}
    get version(){return VERSION;}
    get installedVersion(){return this.api?.runtime?.getManifest?.().version||'未知';}
    async call(method,job){
      if(!Number.isInteger(this.target)||this.target<=0)throw new Error('请从 Canvas 评分页点击扩展图标打开助手');
      if(!METHODS.includes(method))throw new Error('extension_command：不支持的工具操作 '+method);
      const installed=this.installedVersion;
      if(installed!==VERSION)throw new Error('extension_reload_required：助手版本 '+VERSION+'，Chrome 已加载扩展版本 '+installed+'。'+refresh);
      const target={tabId:this.target};
      // Probe before injecting. An exception in an injected file is not a
      // reliable acknowledgement that the intended runtime was initialized.
      const probe=await this.api.scripting.executeScript({target,world:'ISOLATED',func:(expected,methods)=>{
        const api=globalThis.CGADom;
        return {present:!!api,version:api?.version||'未知',missing:methods.filter(name=>typeof api?.[name]!=='function')};
      },args:[VERSION,METHODS]});
      const state=probe[0]?.result;
      if(!state)throw new Error('extension_init_failed：未收到原评分页的脚本检查结果。'+refresh);
      if(state.present&&(state.version!==VERSION||state.missing.length)){
        throw new Error('extension_updated：助手版本 '+VERSION+'，评分页脚本版本 '+state.version+
          (state.missing.length?'；缺少功能 '+state.missing.join(', '):'')+'。'+refresh);
      }
      if(!state.present)await this.api.scripting.executeScript({target,world:'ISOLATED',files:['core.js','dom.js']});
      const results=await this.api.scripting.executeScript({target,world:'ISOLATED',func:async(method,job,expected,methods)=>{
        try {
          const api=globalThis.CGADom;
          if(!api)throw new Error('extension_init_failed：评分页脚本尚未成功初始化');
          if(api.version!==expected)throw new Error('extension_updated：助手版本 '+expected+'，评分页脚本版本 '+(api.version||'未知'));
          const missing=methods.filter(name=>typeof api[name]!=='function');
          if(missing.length)throw new Error('extension_updated：评分页脚本功能不完整，缺少 '+missing.join(', '));
          return {ok:true,value:await api[method](job)};
        } catch(error){return {ok:false,error:error.message};}
      },args:[method,job??null,VERSION,METHODS]});
      const result=results[0]?.result;
      if(!result?.ok){
        const message=result?.error||'extension_init_failed：无法读取原评分页';
        throw new Error(message+(/^extension_/.test(message)?'。'+refresh:''));
      }
      return method==='diagnose'?{assistantVersion:VERSION,installedVersion:installed,...result.value}:result.value;
    }
  }
  root.CGAChromeBridge=ChromeBridge;
  if(typeof module!=='undefined'&&module.exports)module.exports=ChromeBridge;
})(globalThis);
