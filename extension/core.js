(function (root) {
  'use strict';
  const fail = message => { throw new Error(message); };
  const id = value => typeof value === 'string' && /^[0-9]+$/.test(value);
  const MAX_PLAN_BYTES = 20 * 1024 * 1024;
  function keys(value,required,optional=[]) {
    if(!value||typeof value!=='object'||Array.isArray(value)||required.some(k=>!Object.hasOwn(value,k))||Object.keys(value).some(k=>!required.includes(k)&&!optional.includes(k)))fail('成绩计划字段缺失或含未定义字段，请按 schema/grade-plan.schema.json 准备');
  }
  // Decimal strings are compared as scaled integers; zero and an empty field differ.
  function decimal(value) {
    if (typeof value !== 'string' || !/^\d{1,8}(?:\.\d{1,6})?$/.test(value)) fail('无效分数：' + value);
    const [whole, fraction = ''] = value.split('.');
    return BigInt(whole) * 1000000n + BigInt(fraction.padEnd(6, '0'));
  }
  const equalScore = (a, b) => {
    if (a === '' || b === '') return a === b;
    try { return decimal(a) === decimal(b); } catch { return false; }
  };
  function validate(plan) {
    if (!plan || plan.schema_version !== '1.0') fail('仅支持 schema_version 1.0');
    keys(plan,['schema_version','scope','students'],['conversion_warnings','$schema']);
    if(plan.$schema!==undefined&&typeof plan.$schema!=='string')fail('$schema 须是文本');
    const s = plan.scope;
    keys(s,['origin','course_id','assignment_id','quiz_id']);
    if (!s || !id(s.course_id) || !id(s.assignment_id) || !id(s.quiz_id)) fail('缺少课程、作业或测验 ID');
    const u = new URL(s.origin);
    if (u.origin !== s.origin || (u.protocol !== 'https:' && !(u.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(u.hostname)))) fail('origin 必须是 HTTPS 平台地址');
    if (!Array.isArray(plan.students) || !plan.students.length || plan.students.length > 10000) fail('学生列表为空或过大');
    const users = new Set(), students = new Set();
    for (const student of plan.students) {
      keys(student,['student_id','canvas_user_id','quiz_submission_id','submission_version','questions']);
      if (typeof student.student_id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(student.student_id) || !id(student.canvas_user_id)) fail('无效学生身份');
      if (users.has(student.canvas_user_id) || students.has(student.student_id)) fail('学号或平台用户 ID 重复');
      users.add(student.canvas_user_id); students.add(student.student_id);
      for (const key of ['quiz_submission_id', 'submission_version']) if (student[key] != null && !id(student[key])) fail('无效提交绑定');
      if ((student.quiz_submission_id == null) !== (student.submission_version == null)) fail('提交 ID 与版本必须同时绑定');
      if (!Array.isArray(student.questions) || !student.questions.length || student.questions.length > 500) fail('题目列表为空或过大');
      const qs = new Set();
      for (const q of student.questions) {
        keys(q,['platform_question_id','source_attachment_id','source_sha256','score','max_score','comment','review_status']);
        if (!id(q.platform_question_id) || !id(q.source_attachment_id) || qs.has(q.platform_question_id)) fail('题目或附件 ID 无效，或题目重复');
        qs.add(q.platform_question_id);
        if (!/^[a-f0-9]{64}$/.test(q.source_sha256)) fail('缺少源文件 SHA-256');
        if (decimal(q.score) > decimal(q.max_score)) fail('分数超过满分');
        if (typeof q.comment !== 'string' || [...q.comment].length > 20000) fail('评语无效或过长');
        if (!['ready', 'needs_review', 'skip'].includes(q.review_status)) fail('无效复核状态');
      }
    }
    if(plan.conversion_warnings!==undefined){
      if(!Array.isArray(plan.conversion_warnings))fail('conversion_warnings 须是数组');
      for(const w of plan.conversion_warnings){
        keys(w,['student_id','question_id','reasons']);
        if(typeof w.student_id!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(w.student_id)||!id(w.question_id)||!Array.isArray(w.reasons)||!w.reasons.length||w.reasons.some(r=>typeof r!=='string'))fail('转换复核提示格式错误');
      }
    }
    return plan;
  }
  function parsePlanText(text) {
    let value;
    try { value=JSON.parse(text.replace(/^\uFEFF/,'')); }
    catch { fail('JSON 语法无效，请检查成绩计划是否完整'); }
    if(value&&!value.schema_version&&Array.isArray(value.records))fail('这是原始 results.json；插件只接受标准成绩计划。请按 README 和 schema/grade-plan.schema.json 准备 .plan.json');
    return validate(value);
  }
  async function readPlanFile(file) {
    if(file.size>MAX_PLAN_BYTES)fail('文件为 '+(file.size/1024/1024).toFixed(3)+' MiB，超过标准成绩计划的 20 MiB 上限。请按 README 和 schema/grade-plan.schema.json 准备仅含身份、来源、分数和评语的 .plan.json');
    return parsePlanText(await file.text());
  }
  const sorted = qs => [...qs].sort((a,b) => a.id.localeCompare(b.id));
  // Chrome's extension IPC can reorder dictionary keys. Do not bind identity
  // using insertion-order-dependent JSON from either side of executeScript.
  const stable = value => JSON.stringify(value,(_key,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.entries(item).sort(([a],[b])=>a.localeCompare(b))):item);
  function structure(snapshot) {
    return stable({identity: snapshot.identity, fudge: snapshot.fudge === '' || equalScore(snapshot.fudge,'0') ? '0' : snapshot.fudge,
      questions: sorted(snapshot.questions).map(q => ({id:q.id, maxScore:q.maxScore, attachments:[...q.attachments].sort()}))});
  }
  function fingerprint(snapshot) {
    return stable({docKey:snapshot.docKey, structure:structure(snapshot),
      values:sorted(snapshot.questions).map(q => [q.id,q.score,q.hiddenScore,q.comment])});
  }
  function decision(plan, snap, options = {}) {
    const skip = (code, reason) => ({state:'skip', code, reason});
    const s = plan.scope, i = snap.identity;
    if (i.origin !== s.origin || i.courseId !== s.course_id || i.assignmentId !== s.assignment_id || i.quizId !== s.quiz_id) fail('scope_mismatch：当前课程或作业与计划不一致');
    const student = plan.students.find(x => x.canvas_user_id === i.userId);
    if (!student) return skip('no_record', '该学生没有本地批改记录');
    if (student.student_id !== i.studentId) fail('identity_mismatch：平台用户 ID 对应的学号不同');
    if (student.quiz_submission_id != null && (student.quiz_submission_id !== i.submissionId || student.submission_version !== i.version)) return skip('source_changed', '提交版本已变化');
    if (student.questions.some(q => q.review_status !== 'ready')) return skip('needs_review', '存在待复核或标记跳过的题目');
    if (snap.fudge !== '' && !equalScore(snap.fudge, '0')) return skip('fudge_points', '存在额外调分');
    if (student.questions.length !== snap.questions.length) return skip('question_set_changed', '网页题目集合与本地记录不完整对应');
    const desired = [];
    for (const local of student.questions) {
      const q = snap.questions.find(x => x.id === local.platform_question_id);
      if (!q) return skip('question_set_changed', '平台题目 ID 不对应');
      if (!equalScore(q.maxScore, local.max_score)) return skip('max_score_changed', '题目满分已变化');
      if (q.attachments.length !== 1 || q.attachments[0] !== local.source_attachment_id) return skip('source_changed', '源附件不一致，可能已更新答案');
      desired.push({id:q.id, score:local.score, comment:local.comment});
    }
    const valuesMatch = desired.every(d => {
      const q = snap.questions.find(q => q.id === d.id);
      return equalScore(q.score,d.score) && equalScore(q.hiddenScore,d.score) && q.comment === d.comment;
    });
    if (valuesMatch) return {state:'already_matches', code:'already_matches', reason:'当前分数与评语已一致'};
    if (!options.overwrite && desired.some(d => {
      const q = snap.questions.find(q => q.id === d.id);
      return (q.score !== '' && !equalScore(q.score,d.score)) || (q.hiddenScore !== '' && !equalScore(q.hiddenScore,d.score)) || (q.comment !== '' && q.comment !== d.comment);
    })) return skip('existing_conflict', '已有分数或评语不同；默认保留');
    return {state:'ready', code:'ready', reason:'身份与源附件全部对应',
      job:{identity:{...i}, expected:fingerprint(snap), structure:structure(snap), docKey:snap.docKey, desired}};
  }
  function assertTarget(job, snapshot, allowNewDocument = false) {
    if ((!allowNewDocument && job.docKey !== snapshot.docKey) || structure(snapshot) !== job.structure) fail('stale_target：学生、题目、附件或提交版本已变化');
  }
  function assertValues(job, snapshot) {
    assertTarget(job, snapshot, true);
    for (const d of job.desired) {
      const q = snapshot.questions.find(q => q.id === d.id);
      if (!equalScore(q.score,d.score) || !equalScore(q.hiddenScore,d.score) || q.comment !== d.comment) fail('value_mismatch：分数或评语未保存一致');
    }
    return true;
  }
  async function runQueue(students, handlers) {
    const results=[];
    for (const student of students) {
      if (handlers.stopped()) break;
      try {
        const result = await handlers.process(student);
        results.push(result); handlers.report(result);
      } catch (error) {
        const result={studentId:student.student_id, state:'error',code:'halted',reason:error.message};
        results.push(result); handlers.report(result);
        break;
      }
    }
    return results;
  }
  const api={validate,parsePlanText,readPlanFile,MAX_PLAN_BYTES,decimal,equalScore,structure,fingerprint,decision,assertTarget,assertValues,runQueue};
  root.CGA=api;
  if (typeof module !== 'undefined' && module.exports) module.exports=api;
})(globalThis);
