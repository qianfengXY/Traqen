export const createState = () => ({ decisions: [], runs: [], revision: 3 });
const uid = () => globalThis.crypto.randomUUID();
export function decide(state, question, choice, reason) {
  if (!reason.trim()) throw new Error('请填写判断依据。');
  if (!['code', 'doc', 'scope', 'defer'].includes(choice)) throw new Error('请选择处理方式。');
  const deferred = choice === 'defer';
  if (deferred && state.decisions.some(d => d.question === question && d.state === 'human')) {
    throw new Error('暂缓不能撤销已有确认。请提交带依据的新解释来修订这条决定。');
  }
  return { ...state, revision: state.revision + (deferred ? 0 : 1), decisions: [...state.decisions,
    { id: uid(), question, choice, reason: reason.trim(), state: deferred ? 'deferred' : 'human', at: new Date().toISOString() }] };
}
export function startRun(state, name, ready) {
  if (!ready) throw new Error('预检未通过：来源版本不一致。');
  if (!name.trim()) throw new Error('请填写分析名称。');
  return { ...state, runs: [{ id: uid(), name: name.trim(), status: 'running', progress: 0,
    source: 'V12', config: 'team-v3', at: new Date().toISOString() }, ...state.runs] };
}
export function stepRun(state, id, action) {
  return { ...state, runs: state.runs.map(run => {
    if (run.id !== id || ['cancelled', 'complete'].includes(run.status)) return run;
    if (action === 'cancel') return { ...run, status: 'cancelled' };
    if (action === 'pause' && run.status === 'running') return { ...run, status: 'paused' };
    if (action === 'resume' && run.status === 'paused') return { ...run, status: 'running' };
    if (action === 'advance' && run.status === 'running') {
      const progress = Math.min(5, run.progress + 1);
      return { ...run, progress, status: progress === 5 ? 'complete' : 'running' };
    }
    return run;
  }) };
}
