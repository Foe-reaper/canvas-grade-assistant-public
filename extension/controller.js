(function(root){
  'use strict';
  const E=root.CGA;
  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  class Controller {
    constructor(bridge,{timeout=25000,interval=600,inspectTimeout=6000}={}){this.bridge=bridge;this.timeout=timeout;this.interval=interval;this.inspectTimeout=inspectTimeout;this.stopping=false;this.pendingJob=null;this.serverJob=null;}
    get hasPending(){return !!(this.pendingJob||this.serverJob);}
    async inspect(plan,options={}){
      const deadline=Date.now()+this.inspectTimeout;
      for(;;){
        let snapshot;
        try { snapshot=await this.bridge.call('snapshot'); }
        catch(error){
          if(!/\bloading[:：]/.test(error.message))throw error;
          if(Date.now()>=deadline)throw new Error('loading_timeout：评分页仍未加载完成，请先在原评分页确认学生和题目已显示，再检查；可运行只读诊断');
          await pause(this.interval);continue;
        }
        return {snapshot,...E.decision(plan,snapshot,options)};
      }
    }
    async fill(job){if(this.hasPending)throw new Error('已有待保存或核对的任务');await this.bridge.call('apply',job);this.pendingJob=job;}
    async discard(){await this.bridge.call('discard',this.pendingJob);this.pendingJob=null;}
    async save(){
      const job=this.pendingJob;
      if(!job)throw new Error('没有待保存的填写');
      // Submit exactly once. A timeout only retries read requests.
      await this.bridge.call('submit',job);
      const deadline=Date.now()+this.timeout;
      let last='';
      while(Date.now()<deadline){
        await pause(this.interval);
        try{await this.bridge.call('persisted',job);this.pendingJob=null;return {state:'verified',reason:'服务器读回分数与逐题评语一致'};}
        catch(error){last=error.message;if(/stale_target|identity_mismatch|scope_mismatch|extension_/.test(last))throw error;}
      }
      throw new Error('保存结果未确认，队列已停止。'+last);
    }
    async verifyServer(){
      if(!this.serverJob)throw new Error('没有待核对的后台保存');
      const deadline=Date.now()+this.timeout;
      let last='';
      while(Date.now()<deadline){
        await pause(this.interval);
        try{
          await this.bridge.call('serverVerify',this.serverJob);this.serverJob=null;
          return {state:'verified',reason:'服务器读回分数与逐题评语一致'};
        }catch(error){last=error.message;if(/stale_target|identity_mismatch|scope_mismatch|extension_/.test(last))throw error;}
      }
      throw new Error('后台保存结果未确认，队列已停止。'+last);
    }
    async batch(plan,{write=false,overwrite=false,report=()=>{}}={}){
      if(this.hasPending)throw new Error('先保存或恢复当前填写，或核对上次后台保存，再运行批量处理');
      this.stopping=false;
      // The visible page remains in place throughout both kinds of batch.
      await this.inspect(plan,{overwrite});
      const results=await E.runQueue(plan.students,{
        stopped:()=>this.stopping,report,
        process:async student=>{
          let snapshot;
          try { snapshot=await this.bridge.call('serverSnapshot',{scope:plan.scope,userId:student.canvas_user_id,prepare:write}); }
          catch(error){
            const unavailable=error.message.match(/^unavailable_submission[:：]\s*([^\n]*)/);
            if(!unavailable)throw error;
            const released=await this.bridge.call('serverRelease');
            if(!released.released)throw error;
            return {studentId:student.student_id,userId:student.canvas_user_id,state:'skip',code:'unavailable_submission',reason:unavailable[1]};
          }
          const result=E.decision(plan,snapshot,{overwrite});
          const row={studentId:student.student_id,userId:student.canvas_user_id,state:result.state,code:result.code,reason:result.reason};
          if(write&&result.state==='ready'){
            if(this.stopping)return {...row,state:'skip',code:'stopped',reason:'用户已停止，尚未填写'};
            this.serverJob=result.job;
            try { await this.bridge.call('serverCommit',result.job); }
            catch(error) {
              const skip=error.message.match(/\b(source_changed|unsaved_original|unavailable_submission)[:：]\s*([^\n]*)/);
              if(skip){
                const released=await this.bridge.call('serverRelease');
                if(released.released){this.serverJob=null;return {...row,state:'skip',code:skip[1],reason:skip[2]};}
              }
              throw error;
            }
            Object.assign(row,await this.verifyServer());row.code='verified';
          }
          return row;
        }
      });
      const released=await this.bridge.call('serverRelease');
      if(released.released)this.serverJob=null;
      return results;
    }
  }
  root.CGAController=Controller;
  if(typeof module!=='undefined'&&module.exports)module.exports=Controller;
})(globalThis);
