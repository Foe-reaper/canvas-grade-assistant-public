(function (root) {
  'use strict';
  const VERSION='0.1.6';
  if (root.CGADom?.version===VERSION) return;
  if (root.CGADom) throw new Error('extension_updated：评分页仍保留旧版脚本，请刷新评分页后重新打开助手');
  const E=root.CGA;
  // Keep the current DOM wrapper alive across extension IPC/garbage collection.
  let currentDocument=null,currentKey=null;
  let pending=null;
  let serverPending=null;
  const fail=message=>{throw new Error(message);};
  function one(parent,selector) {
    const nodes=parent.querySelectorAll(selector);
    if(nodes.length!==1) fail('unsupported_layout：控件不唯一或缺失 '+selector);
    return nodes[0];
  }
  function live() {
    const frame=one(document,'iframe#speedgrader_iframe');
    const doc=frame.contentDocument;
    if(!doc || doc.readyState!=='complete') fail('loading：评分页尚未完成加载；若持续等待，请检查登录状态');
    const url=frame.contentWindow.location.href;
    if(url==='about:blank'||doc.URL!==url)fail('loading：内嵌评分页正在初始化或跳转');
    if(doc!==currentDocument){currentDocument=doc;currentKey=crypto.randomUUID();}
    return {doc,url,key:currentKey,outer:location.href};
  }
  function maxScore(input,box) {
    for(let node=input.parentElement; node; node=node.parentElement) {
      const matches=[...node.textContent.matchAll(/\/\s*(\d+(?:\.\d+)?)/g)];
      if(matches.length===1) return matches[0][1];
      if(node===box || matches.length>1) break;
    }
    fail('unsupported_layout：无法唯一确认题目满分');
  }
  function parse(ctx) {
    const {doc,url,key,outer}=ctx;
    const topURL=new URL(outer), inner=new URL(url);
    const topPath=topURL.pathname.match(/^\/courses\/(\d+)\/gradebook\/speed_grader\/?$/);
    const framePath=inner.pathname.match(/^\/courses\/(\d+)\/quizzes\/(\d+)\/history\/?$/);
    if(!topPath)fail('unsupported_page：目标标签不是 Canvas 评分工作台，请从 SpeedGrader 页面点击扩展图标');
    if(/\/login(?:\/|$)/.test(inner.pathname)||topURL.origin!==inner.origin)fail('login_required：评分页跳转到了登录页或其他域名，请在原评分页完成登录');
    if(!framePath){
      if(/^\/courses\/\d+\/assignments\/\d+\/submissions\/\d+\/?$/.test(inner.pathname))fail('loading：提交预览正在跳转到测验评分页');
      fail('unsupported_page：内嵌页面不是预期的测验历史页（'+inner.pathname+'），可运行只读诊断');
    }
    if(topPath[1]!==framePath[1])fail('identity_mismatch：外层课程 '+topPath[1]+' 与评分页课程 '+framePath[1]+' 不一致');
    const user=topURL.searchParams.get('student_id');
    if(!/^\d+$/.test(user||'') || user!==inner.searchParams.get('user_id')) fail('identity_mismatch：外层与内嵌学生不一致');
    const form=one(doc,'form#update_history_form');
    const action=new URL(form.getAttribute('action'),inner);
    const actionPath=action.pathname.match(/^\/courses\/(\d+)\/quizzes\/(\d+)\/submissions\/(\d+)\/?$/);
    if(action.origin!==inner.origin || !actionPath || actionPath[1]!==framePath[1] || actionPath[2]!==framePath[2]) fail('identity_mismatch：评分表单提交目标不一致');
    if(form.method.toLowerCase()!=='post' || one(form,'input[name="_method"]').value.toLowerCase()!=='put') fail('unsupported_layout：评分表单方法不符合预期');
    const title=one(doc,'.quiz-header h2').textContent;
    const ids=[...title.matchAll(/[（(]\s*([A-Za-z0-9_-]+)\s*[）)]/g)];
    if(ids.length!==1) fail('unsupported_layout：无法唯一提取学号');
    const version=one(form,'input[name="submission_version_number"]').value;
    if(!/^\d+$/.test(version) || inner.searchParams.get('version')!==version) fail('identity_mismatch：提交版本字段不一致');
    const assignment=topURL.searchParams.get('assignment_id');
    if(!/^\d+$/.test(assignment||'')) fail('unsupported_layout：缺少作业 ID');
    const questions=[...form.querySelectorAll('.display_question[id^="question_"]')].map(box=>{
      const id=box.id.match(/^question_(\d+)$/)?.[1];
      if(!id || !box.classList.contains('file_upload_question')) fail('unsupported_layout：仅支持文件上传题');
      const visible=one(box,'input.question_input');
      if(visible.id!=='question_score_'+id+'_visible' || visible.name!==visible.id || visible.dataset.questionId!==id || visible.disabled || visible.readOnly) fail('unsupported_layout：分数框身份或可写状态不正确');
      const hidden=one(box,'input.question_input_hidden[name="question_score_'+id+'"]');
      const comment=one(box,'textarea#question_comment_'+id);
      if(comment.name!==comment.id || comment.disabled || comment.readOnly) fail('unsupported_layout：评语框状态不正确');
      const attachments=[...new Set([...box.querySelectorAll('a[href]')].flatMap(a=>{
        const u=new URL(a.getAttribute('href'),inner);
        const match=u.pathname.match(/\/files\/(\d+)(?:\/|$)/);
        return u.origin===inner.origin && match ? [match[1]] : [];
      }))].sort();
      return {id,maxScore:maxScore(visible,box),attachments,score:visible.value.trim(),hiddenScore:hidden.value.trim(),comment:comment.value.replace(/\r\n/g,'\n')};
    });
    if(!questions.length || new Set(questions.map(q=>q.id)).size!==questions.length) fail('unsupported_layout：题目为空或重复');
    let fudge=form.querySelector('input[name="fudge_points"],input#fudge_points');
    if(!fudge) {
      const labels=[...form.querySelectorAll('label[for]')].filter(l=>/虚假得分|额外.*分|fudge/i.test(l.textContent));
      if(labels.length===1) fudge=doc.getElementById(labels[0].htmlFor);
    }
    if(!fudge || fudge.form!==form) fail('unsupported_layout：无法确认额外调分字段');
    const button=one(form,'button.update-scores[type="submit"]');
    if(button.disabled) fail('loading：保存按钮暂不可用');
    return {docKey:key,identity:{origin:topURL.origin,courseId:topPath[1],assignmentId:assignment,quizId:framePath[2],userId:user,studentId:ids[0][1],submissionId:actionPath[3],version},fudge:fudge.value.trim(),questions};
  }
  const snapshot=()=>parse(live());
  function setValue(node,value) {
    const proto=node.tagName==='TEXTAREA'?node.ownerDocument.defaultView.HTMLTextAreaElement.prototype:node.ownerDocument.defaultView.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto,'value').set.call(node,value);
  }
  async function apply(job) {
    if(pending) fail('pending_write：已有未核对的填写，先保存或明确恢复');
    if(serverPending?.phase==='submitted')fail('pending_write：上一次后台保存尚未确认，请先重新核对');
    serverPending=null;
    const ctx=live(), before=parse(ctx);
    if(E.fingerprint(before)!==job.expected) fail('stale_target：预览之后页面已变化，请重新检查');
    E.assertTarget(job,before);
    // The visible iframe can be stale while a student uploads a new answer.
    // Read the canonical submission preview again so the server resolves its
    // latest version, instead of trusting an old history?version=N page.
    const server=await readLatest(ctx,before.identity);
    for(const key of ['origin','courseId','assignmentId','quizId','userId','studentId'])if(server.identity[key]!==job.identity[key])fail('identity_mismatch：服务器返回了其他学生或作业');
    if(E.structure(server)!==job.structure)fail('source_changed：服务器上的源附件或提交版本已更新');
    if(E.fingerprint({...server,docKey:job.docKey})!==job.expected)fail('stale_target：服务器评分与预览不同，请刷新后重新检查');
    if(E.fingerprint(snapshot())!==job.expected)fail('stale_target：检查期间页面已变化');
    const form=one(ctx.doc,'#update_history_form');
    const controls=job.desired.map(d=>({d,visible:one(form,'#question_score_'+d.id+'_visible'),hidden:one(form,'input[name="question_score_'+d.id+'"]'),comment:one(form,'#question_comment_'+d.id)}));
    const backup=controls.map(c=>({visible:c.visible.value,hidden:c.hidden.value,comment:c.comment.value}));
    pending={job,ctx,controls,backup,phase:'filling'};
    try {
      for(const c of controls) {
        E.assertTarget(job,snapshot());
        setValue(c.visible,c.d.score);
        for(const type of ['input','change','blur']) {
          c.visible.dispatchEvent(new ctx.doc.defaultView.Event(type,{bubbles:true}));
          E.assertTarget(job,snapshot());
        }
        // Canvas submits this hidden field; keep both representations explicit.
        setValue(c.hidden,c.d.score);
        setValue(c.comment,c.d.comment);
        for(const type of ['input','change']) c.comment.dispatchEvent(new ctx.doc.defaultView.Event(type,{bubbles:true}));
        E.assertTarget(job,snapshot());
      }
      E.assertValues(job,snapshot());
      pending.phase='filled';
      return {state:'filled',snapshot:snapshot()};
    } catch(error) {
      // Restore only the original detached/control objects, never find a different student.
      controls.forEach((c,i)=>{setValue(c.visible,backup[i].visible);setValue(c.hidden,backup[i].hidden);setValue(c.comment,backup[i].comment);});
      pending=null;
      throw error;
    }
  }
  function discard(job) {
    if(!pending || pending.phase!=='filled' || pending.job.expected!==job.expected) fail('pending_write：没有可恢复的本工具填写');
    E.assertTarget(job,snapshot()); E.assertValues(job,snapshot());
    pending.controls.forEach((c,i)=>{setValue(c.visible,pending.backup[i].visible);setValue(c.hidden,pending.backup[i].hidden);setValue(c.comment,pending.backup[i].comment);});
    pending=null;
    return snapshot();
  }
  function submit(job) {
    if(!pending || pending.phase!=='filled' || pending.job.expected!==job.expected) fail('pending_write：仅能提交本工具刚填写的内容');
    E.assertTarget(job,snapshot()); E.assertValues(job,snapshot());
    const form=one(pending.ctx.doc,'#update_history_form');
    const button=one(form,'button.update-scores[type="submit"]');
    if(button.disabled) fail('保存按钮不可用');
    pending.phase='submitted';
    form.requestSubmit(button);
    return {state:'submitted'};
  }
  function route(value) {
    try {
      const url=new URL(value);
      const allowed=['assignment_id','student_id','user_id','version','preview','headless'];
      for(const key of [...url.searchParams.keys()])if(!allowed.includes(key))url.searchParams.delete(key);
      url.hash='';url.username='';url.password='';
      return url.href;
    } catch { return String(value).slice(0,100); }
  }
  function historyTargets(html,base) {
    const normalized=html.replace(/\\\//g,'/').replace(/\\u0026/gi,'&').replace(/&amp;/gi,'&');
    const matches=[...normalized.matchAll(/(?:https?:\/\/[^"'<>\\\s]*)?\/courses\/\d+\/quizzes\/\d+\/history(?:\?[^"'<>\\\s]*)?/g)];
    return [...new Set(matches.flatMap(m=>{
      try {const u=new URL(m[0],base);return u.origin===new URL(base).origin?[route(u.href)]:[];}catch{return [];}
    }))].slice(0,8);
  }
  async function readLatestDocument(ctx,identity,onResponse) {
    const latest=new URL('/courses/'+identity.courseId+'/assignments/'+identity.assignmentId+'/submissions/'+identity.userId,identity.origin);
    latest.searchParams.set('preview','true');
    const abort=new AbortController();
    const timeout=setTimeout(()=>abort.abort(),10000);
    let response,html;
    try {
      response=await fetch(latest.href,{credentials:'same-origin',cache:'no-store',redirect:'follow',headers:{Accept:'text/html'},signal:abort.signal});
      html=await response.text();
    } finally { clearTimeout(timeout); }
    const parsedDoc=new DOMParser().parseFromString(html,'text/html');
    if(onResponse)onResponse({url:route(response.url),status:response.status,redirected:response.redirected,contentType:response.headers.get('content-type'),hasGradeForm:!!parsedDoc.querySelector('#update_history_form'),hasLoginForm:!!parsedDoc.querySelector('input[type="password"]'),historyTargets:historyTargets(html,response.url)});
    if(!response.ok)fail('server_read：服务器读取失败 '+response.status);
    const resolved=new URL(response.url);
    const overview='/courses/'+identity.courseId+'/quizzes/'+identity.quizId;
    if(resolved.origin===identity.origin&&resolved.pathname.replace(/\/$/,'')===overview&&!parsedDoc.querySelector('#update_history_form')&&!parsedDoc.querySelector('input[type="password"]')){
      const notEnrolled=/具体用户不是此课程的学生|specified user is not a student in this course/i.test(parsedDoc.body?.textContent||'');
      fail('unavailable_submission：'+(notEnrolled?'平台提示该用户不是本课程学生':'服务器返回测验介绍页，未取得该学生的可评分提交')+'；已跳过，请人工核对');
    }
    const parsedContext={doc:parsedDoc,url:response.url,key:'server-read',outer:ctx.outer};
    return {ctx:parsedContext,snapshot:parse(parsedContext)};
  }
  async function readLatest(ctx,identity,onResponse){return (await readLatestDocument(ctx,identity,onResponse)).snapshot;}
  function batchContext(scope,userId) {
    if(!/^\d+$/.test(userId||''))fail('identity_mismatch：后台任务缺少平台用户 ID');
    const current=snapshot(),i=current.identity;
    if(i.origin!==scope.origin||i.courseId!==scope.course_id||i.assignmentId!==scope.assignment_id||i.quizId!==scope.quiz_id)fail('scope_mismatch：原评分页已离开当前课程或作业');
    // This URL is an immutable request binding, not a navigation instruction.
    const outer=new URL('/courses/'+scope.course_id+'/gradebook/speed_grader',scope.origin);
    outer.searchParams.set('assignment_id',scope.assignment_id);outer.searchParams.set('student_id',userId);
    return {ctx:{outer:outer.href},identity:{origin:scope.origin,courseId:scope.course_id,assignmentId:scope.assignment_id,quizId:scope.quiz_id,userId},current};
  }
  function scopeOf(identity){return {origin:identity.origin,course_id:identity.courseId,assignment_id:identity.assignmentId,quiz_id:identity.quizId};}
  async function serverSnapshot({scope,userId,prepare=false}) {
    if(prepare&&(pending||serverPending?.phase==='submitted'))fail('pending_write：存在尚未核对的填写或保存');
    const binding=batchContext(scope,userId);
    const server=await readLatestDocument(binding.ctx,binding.identity);
    if(server.snapshot.identity.quizId!==scope.quiz_id)fail('scope_mismatch：服务器返回了其他测验');
    const token=crypto.randomUUID();server.snapshot.docKey=token;server.ctx.key=token;
    if(prepare)serverPending={...server,phase:'prepared',expected:E.fingerprint(server.snapshot)};
    return server.snapshot;
  }
  function sourceHasDraft(current,server) {
    if(current.identity.userId!==server.identity.userId)return false;
    if(E.structure(current)!==E.structure(server))return true;
    return current.questions.some(q=>{
      const s=server.questions.find(s=>s.id===q.id);
      return !s||!E.equalScore(q.score,s.score)||!E.equalScore(q.hiddenScore,s.hiddenScore)||q.comment!==s.comment;
    });
  }
  async function serverCommit(job) {
    if(pending)fail('pending_write：原评分页存在本工具尚未保存的填写');
    if(!serverPending||serverPending.phase!=='prepared'||serverPending.expected!==job.expected||serverPending.snapshot.docKey!==job.docKey)fail('stale_target：后台任务已失效，请重新检查');
    const binding=batchContext(scopeOf(job.identity),job.identity.userId);
    const fresh=await readLatestDocument(binding.ctx,binding.identity);
    for(const key of ['origin','courseId','assignmentId','quizId','userId','studentId'])if(fresh.snapshot.identity[key]!==job.identity[key])fail('identity_mismatch：后台提交对象发生变化');
    if(E.structure(fresh.snapshot)!==job.structure)fail('source_changed：服务器上的源附件或提交版本已更新');
    if(E.fingerprint({...fresh.snapshot,docKey:job.docKey})!==job.expected)fail('stale_target：检查后服务器评分已变化');
    const current=batchContext(scopeOf(job.identity),job.identity.userId).current;
    if(sourceHasDraft(current,fresh.snapshot))fail('unsaved_original：原评分页有未保存编辑或显示旧版本，已保留并跳过该学生');
    const form=one(fresh.ctx.doc,'#update_history_form');
    for(const d of job.desired){
      one(form,'#question_score_'+d.id+'_visible').value=d.score;
      one(form,'input[name="question_score_'+d.id+'"]').value=d.score;
      one(form,'#question_comment_'+d.id).value=d.comment;
    }
    E.assertValues(job,parse(fresh.ctx));
    const data=new URLSearchParams();
    for(const [name,value] of new FormData(form)){
      if(typeof value!=='string')fail('unsupported_layout：评分表单含意外的上传文件');
      data.append(name,value);
    }
    const button=one(form,'button.update-scores[type="submit"]');
    if(button.name)data.append(button.name,button.value);
    const action=new URL(form.getAttribute('action'),fresh.ctx.url);
    const expected='/courses/'+job.identity.courseId+'/quizzes/'+job.identity.quizId+'/submissions/'+job.identity.submissionId;
    if(action.origin!==job.identity.origin||action.pathname.replace(/\/$/,'')!==expected)fail('identity_mismatch：后台表单提交目标不一致');
    serverPending={...fresh,phase:'submitted',expected:job.expected,job};
    const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),15000);
    try {
      // Do not follow a POST redirect or retry a possibly committed request.
      // The next operation is always a fresh, identity-bound GET verification.
      const response=await fetch(action.href,{method:'POST',credentials:'same-origin',headers:{Accept:'text/html'},body:data,redirect:'manual',signal:abort.signal});
      if(response.type!=='opaqueredirect'&&!response.ok)fail('server_submit：保存请求失败 '+response.status+'，请重新核对，勿重复提交');
    } finally {clearTimeout(timer);}
    return {state:'submitted'};
  }
  async function serverVerify(job) {
    if(serverPending&&(serverPending.phase!=='submitted'||serverPending.expected!==job.expected))fail('pending_write：后台保存核对对象不一致');
    const binding=batchContext(scopeOf(job.identity),job.identity.userId);
    const saved=await readLatest(binding.ctx,binding.identity);
    E.assertValues(job,saved);
    serverPending=null;
    return {state:'verified'};
  }
  function serverRelease() {
    if(serverPending?.phase==='submitted')return {released:false};
    serverPending=null;return {released:true};
  }
  async function diagnose() {
    const result={extensionVersion:VERSION,outer:route(location.href),readOnly:true};
    const frame=document.querySelector('iframe#speedgrader_iframe');
    result.frameCount=document.querySelectorAll('iframe#speedgrader_iframe').length;
    if(frame){
      result.frameSource=route(frame.src);
      try {result.frameActual=route(frame.contentWindow.location.href);result.frameReadyState=frame.contentDocument?.readyState||'unavailable';}
      catch {result.frameActual='不可读取（跨域或登录跳转）';}
    }
    try {
      const ctx=live(),current=parse(ctx);
      result.visibleCheck='passed';
      const saved=await readLatest(ctx,current.identity,details=>{result.server=details;});
      for(const key of ['origin','courseId','assignmentId','quizId','userId','studentId'])if(saved.identity[key]!==current.identity[key])fail('identity_mismatch：服务器预览与当前学生身份不同');
      result.serverCheck='passed';
    } catch(error) {result.error=error.message;}
    return result;
  }
  async function persisted(job) {
    const ctx=live();
    E.assertTarget(job,parse(ctx),true);
    const saved=await readLatest(ctx,job.identity);
    E.assertValues(job,saved);
    E.assertTarget(job,snapshot(),true);
    pending=null;
    return {state:'verified',snapshot:saved};
  }
  root.CGADom={version:VERSION,snapshot,apply,discard,submit,persisted,diagnose,serverSnapshot,serverCommit,serverVerify,serverRelease};
})(globalThis);
