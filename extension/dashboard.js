(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  const target=Number(new URLSearchParams(location.search).get('target'));
  let plan=null,preview=null,busy=false,log=[];
  const bridge=new CGAChromeBridge(globalThis.chrome,target);
  $('runtime-info').textContent='助手版本 '+bridge.version+' · Chrome 已加载扩展版本 '+bridge.installedVersion;
  const controller=new CGAController(bridge);
  function status(text,kind=''){ $('status').textContent=text;$('status').dataset.kind=kind; }
  function buttons(){
    for(const id of ['plan-file','overwrite'])$(id).disabled=busy||controller.hasPending;
    $('inspect').disabled=!plan||busy||controller.hasPending;
    $('fill').disabled=!preview?.job||busy||controller.hasPending;
    $('save').disabled=!controller.pendingJob||busy;
    $('discard').disabled=!controller.pendingJob||busy;
    $('audit').disabled=!plan||busy||controller.hasPending;
    $('batch').disabled=!plan||busy||controller.hasPending||!$('confirm-batch').checked;
    $('stop').disabled=!busy;
    $('export').disabled=!log.length;
    $('diagnose').disabled=busy||controller.hasPending;
    $('verify-last').disabled=busy||!controller.serverJob;
  }
  function row(values,parent){const tr=document.createElement('tr');for(const value of values){const td=document.createElement('td');td.textContent=value;tr.append(td);}parent.append(tr);}
  function report(result){log.push({...result,time:new Date().toISOString()});const names={ready:'可录入',verified:'已保存并核对',skip:'已跳过',already_matches:'已一致',error:'已停止'};row([result.studentId,names[result.state]||result.state,result.reason],$('results'));$('progress').textContent='已处理 '+log.length+' / '+plan.students.length;buttons();}
  function show(result){
    preview=result;
    $('preview').hidden=false;
    const i=result.snapshot.identity;
    $('identity').textContent='学号 '+i.studentId+' · 平台用户 '+i.userId+' · 作业 '+i.assignmentId+' · 提交版本 '+i.version;
    const tbody=$('preview').tBodies[0];tbody.replaceChildren();
    const student=plan.students.find(s=>s.canvas_user_id===i.userId);
    for(const q of result.snapshot.questions){const d=student?.questions.find(d=>d.platform_question_id===q.id);row([q.id,q.score===''?'未评分':q.score,d?.score??'无记录',d?.comment??''],tbody);}
    status(result.reason,result.state);buttons();
  }
  async function action(fn){busy=true;buttons();try{await fn();}catch(error){preview=null;$('identity').textContent='';$('preview').tBodies[0].replaceChildren();$('preview').hidden=true;$('diagnostics').textContent='';$('diagnostics').hidden=true;status(error.message,'error');}finally{busy=false;buttons();}}
  $('plan-file').addEventListener('change',()=>action(async()=>{
    const file=$('plan-file').files[0];if(!file)return;
    plan=null;preview=null;
    log=[];$('results').replaceChildren();$('progress').textContent='';
    $('plan-info').textContent='正在校验成绩计划…';
    $('preview').tBodies[0].replaceChildren();$('identity').textContent='';
    try { plan=await CGA.readPlanFile(file); }
    catch(error) { $('plan-info').textContent='成绩计划加载失败。'; throw error; }
    log=[];$('results').replaceChildren();$('preview').tBodies[0].replaceChildren();$('identity').textContent='';$('progress').textContent='';
    $('plan-info').textContent=file.name+' · '+plan.students.length+' 名学生 · 课程 '+plan.scope.course_id+' / 作业 '+plan.scope.assignment_id;
    $('confirm-batch').checked=false;status('成绩计划已加载，可以检查当前学生。');
  }));
  $('inspect').addEventListener('click',()=>action(async()=>show(await controller.inspect(plan,{overwrite:$('overwrite').checked}))));
  $('diagnose').addEventListener('click',()=>action(async()=>{
    const result=await bridge.call('diagnose');
    $('diagnostics').hidden=false;$('diagnostics').textContent=JSON.stringify(result,null,2);
    if(result.error){preview=null;$('identity').textContent='';$('preview').tBodies[0].replaceChildren();$('preview').hidden=true;}
    status(result.error?'诊断发现问题：'+result.error:'只读诊断通过：当前评分页与服务器预览身份一致。',result.error?'error':'');
  }));
  $('overwrite').addEventListener('change',()=>{preview=null;status('规则已改变，请重新检查当前学生。');buttons();});
  $('confirm-batch').addEventListener('change',buttons);
  $('fill').addEventListener('click',()=>action(async()=>{await controller.fill(preview.job);preview=null;status('已填写，尚未保存。可保存并核对，或恢复本次填写。');}));
  $('save').addEventListener('click',()=>action(async()=>{const result=await controller.save();status(result.reason,result.state);}));
  $('verify-last').addEventListener('click',()=>action(async()=>{const result=await controller.verifyServer();status(result.reason+'；可重新运行批量任务继续处理。',result.state);}));
  $('discard').addEventListener('click',()=>action(async()=>{await controller.discard();status('已恢复本工具填写前的值。');}));
  function batch(write){return action(async()=>{
    if(write&&!$('confirm-batch').checked)throw new Error('先核对并确认成绩计划');
    preview=null;log=[];$('results').replaceChildren();
    $('identity').textContent='批量处理结果见下表。';$('preview').tBodies[0].replaceChildren();$('preview').hidden=true;
    status(write?'正在后台逐人保存和核对，原评分页保持不变。':'正在后台只读检查，原评分页保持不变。');
    await controller.batch(plan,{write,overwrite:$('overwrite').checked,report});
    const failed=log.some(x=>x.state==='error');
    status(failed?'队列已停止，请查看最后一条错误。':controller.stopping?'已按要求停止。':'本批处理完成。',failed?'error':'');
  });}
  $('audit').addEventListener('click',()=>batch(false));$('batch').addEventListener('click',()=>batch(true));
  $('stop').addEventListener('click',()=>{controller.stopping=true;status('已请求停止；当前学生的保存核对完成后停止。');});
  $('export').addEventListener('click',()=>{
    const url=URL.createObjectURL(new Blob([JSON.stringify({version:bridge.version,scope:plan.scope,results:log},null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='canvas-grade-log.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  window.addEventListener('beforeunload',event=>{if(busy||controller.hasPending){event.preventDefault();event.returnValue='';}});
  buttons();
})();
