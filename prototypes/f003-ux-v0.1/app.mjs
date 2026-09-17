import { createState, decide, startRun, stepRun } from './model.mjs';

const KEY = 'traqen:f003:ux:v0.1';
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
  graph:'M4 5h5v5H4z M15 3h5v5h-5z M14 15h6v6h-6z M9 7h6 M7 10v8h7',
  search:'m15 15 5 5 M10 17a7 7 0 1 0 0-14 7 7 0 0 0 0 14',
  file:'M14 3H5v18h14V8z M14 3v6h5 M8 13h8 M8 17h5',
  code:'m8 7-5 5 5 5 m8-10 5 5-5 5 m-3-14-2 18',
  test:'M9 3h6 M10 3v7l-5 9q-1 2 2 2h10q3 0 2-2l-5-9V3 M8 15h8',
  settings:'M4 6h16 M4 12h16 M4 18h16 M8 3v6 M16 9v6 M10 15v6',
  check:'m5 12 4 4 10-10', plus:'M12 5v14 M5 12h14',
  arrow:'M4 12h15 m-5-5 5 5-5 5', chevron:'m9 5 7 7-7 7', close:'m6 6 12 12 M6 18 18 6',
  run:'m8 4 13 8-13 8z', review:'M5 3h14v18H5z M9 7h6 M9 11h6 m-6 5 2 2 4-4',
  folder:'M3 5h7l2 3h9v12H3z', lock:'M6 10h12v11H6z M8 10V6a4 4 0 0 1 8 0v4',
  clock:'M12 8v5l3 2 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  branch:'M6 3v18 M6 15c10 0 12-3 12-8 M16 3h4v4h-4z',
  panel:'M3 4h18v16H3z M15 4v16', info:'M12 11v6 M12 7h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  history:'M3 10a9 9 0 1 1 1 7 M3 3v7h7 M12 7v6l4 2', zoom:'M5 12h14',
};
const icon = name => `<svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${paths[name] || paths.file}"/></svg>`;
const tag = (status, label) => `<span class="tag ${status}"><i class="dot"></i>${label || ({agent:'Agent 分析',human:'人工确认',dispute:'待查 / 争议',deferred:'已暂缓',restricted:'权限受限'}[status] || status)}</span>`;
const btn = (action, label, cls = '', extra = '', ico = '') => `<button class="btn ${cls}" data-action="${action}" ${extra}>${ico ? icon(ico) : ''}${label}</button>`;
const functions = [
  {id:'order', name:'订单提交', state:'agent', desc:'用户提交订单后，校验商品与价格、预占库存，并创建待支付订单。支付超时的适用规则仍有一项争议。', materials:['doc','submit','config','test'], scope:'Web 商城 · 普通实物订单'},
  {id:'pay', name:'支付与回调', state:'human', desc:'接收支付平台回调，校验签名并幂等地更新订单支付状态。', materials:['callback','doc','test'],scope:'线上支付 · 异步回调'},
  {id:'cancel',name:'订单取消',state:'agent',desc:'取消未支付订单，释放已预占的库存。超时取消时长需要区分文档与实现。',materials:['expiry','config','test'],scope:'未支付订单'},
  {id:'stock',name:'库存预占',state:'agent',desc:'提交订单时预占库存；订单取消后释放库存，已支付订单进入履约。',materials:['submit','config','test'],scope:'实物商品 · 单仓库存'},
  {id:'refund',name:'退款处理',state:'human',desc:'接收退款申请并校验订单状态。优惠券的退还规则存在适用范围歧义。',materials:['refund','callback'],scope:'已支付、未完成履约订单'},
  {id:'fulfill',name:'履约发货',state:'agent',desc:'已支付订单交给履约流程，更新发货信息并保留状态变更记录。',materials:['submit','doc'],scope:'实物订单 · 标准履约'},
];
const materials = [
  {id:'doc',name:'下单流程设计',path:'docs/checkout.md',type:'文档',ico:'file',status:'已关联',lines:'42–48',content:'42  ## 未支付订单\n43  用户提交订单后，系统预占商品库存。\n44  订单进入待支付状态。\n45  未支付订单将在 30 分钟后自动取消。\n46  取消后释放预占库存。\n47  该规则适用于普通实物订单。\n48  文档更新时间：2025-11-03'},
  {id:'submit',name:'订单提交实现',path:'src/orders/submit.ts',type:'API · 代码',ico:'code',status:'已关联',lines:'18–28',content:'18  export async function submitOrder(input) {\n19    const items = await validateItems(input.items);\n20    const quote = await verifyPrice(items);\n21    await inventory.reserve(items);\n22    return orders.create({\n23      items, total: quote.total,\n24      status: "PENDING_PAYMENT",\n25      customerId: input.customerId\n26    });\n27  }\n28  // 示例代码，仅供 UX 讨论'},
  {id:'expiry',name:'超时取消逻辑',path:'src/orders/expiry.ts',type:'API · 代码',ico:'code',status:'已关联',lines:'9–16',content:' 9  const timeoutSeconds = config.order.paymentTimeout;\n10  // 配置默认值为 900 秒（15 分钟）\n11  if (order.status === "PENDING_PAYMENT"\n12      && elapsed > timeoutSeconds) {\n13    await cancelOrder(order.id);\n14    await inventory.release(order.items);\n15  }\n16  // 片段不证明生产环境的实际配置值'},
  {id:'config',name:'订单默认配置',path:'config/orders.yaml',type:'配置 · 数据',ico:'settings',status:'已关联',lines:'1–6',content:'1  order:\n2    paymentTimeout: 900\n3    reserveInventory: true\n4  # 900 秒 = 15 分钟\n5  # 这是默认配置，不是生产环境生效值\n6  # 环境覆盖值尚未关联'},
  {id:'test',name:'订单提交测试',path:'tests/checkout.spec.ts',type:'测试资产',ico:'test',status:'已关联',lines:'12–19',content:'12  test("creates a pending order", async () => {\n13    const order = await submitOrder(exampleInput);\n14    expect(order.status).toBe("PENDING_PAYMENT");\n15    expect(inventory.reserve).toHaveBeenCalled();\n16  });\n17  // 测试资产可以描述断言\n18  // 本轮没有关联执行记录\n19  // 不能据此判断测试通过'},
  {id:'callback',name:'支付回调接口',path:'src/payments/callback.ts',type:'API · 代码',ico:'code',status:'已关联',lines:'21–27',content:'21  export async function onPayment(event) {\n22    verifySignature(event);\n23    if (await processed(event.id)) return;\n24    await markPaid(event.orderId);\n25    await recordProcessed(event.id);\n26  }\n27  // 示例：验证签名、幂等更新'},
  {id:'refund',name:'售后规则说明',path:'docs/refund-rules.md',type:'文档',ico:'file',status:'已关联',lines:'8–13',content:' 8  ## 退款与优惠券\n 9  退款成功后，可恢复符合条件的优惠券。\n10  “符合条件”未说明是否包括过期券。\n11  当前材料没有完整的适用范围定义。\n12  应向业务人员确认，不能推定全部退还。\n13  // UX 示例材料'},
  {id:'legacy',name:'旧版流程附件',path:'archive/order-flow.pdf',type:'文档',ico:'file',status:'不支持',lines:'—',content:null},
  {id:'notes',name:'会议零散记录',path:'notes/migration.md',type:'文档',ico:'file',status:'未归属',lines:'1–3',content:'1  后续考虑拆分订单相关服务。\n2  讨论未形成明确结论，待补充背景。\n3  无法据此建立可靠的业务关系。'},
  {id:'restricted',name:'生产环境配置',path:'environments/production.secrets',type:'配置 · 数据',ico:'lock',status:'受限',lines:'不可读',content:null},
];
const questions = [
  {id:'timeout',func:'order',name:'未支付订单，应在何时自动取消？',brief:'设计与默认实现存在差异',left:'doc',right:'expiry',options:[['code','按默认实现解释','15 分钟 · 仅默认配置上下文'],['doc','按设计意图解释','30 分钟 · 不覆盖实现事实'],['scope','保留两种适用范围','分别标注设计与默认实现']]},
  {id:'coupon',func:'refund',name:'退款后，哪些优惠券可以恢复？',brief:'规则适用范围不明确',left:'refund',right:'callback',options:[['code','限定为未过期券','作为业务补充判断留痕'],['doc','按原文保留条件','不推定所有优惠券可退'],['scope','明确例外与范围','在下方依据中说明边界']]},
];
let state;
let storageError = false;
try {
  const raw = JSON.parse(localStorage.getItem(KEY) || 'null');
  state = raw && Array.isArray(raw.decisions) && Array.isArray(raw.runs) && Number.isInteger(raw.revision) ? raw : createState();
} catch { state = createState(); storageError = true; }
const ui = {page:'graph',view:'business',selected:'order',material:null,search:'',humanOnly:false,inspector:true,question:'timeout',materialFilter:'全部',materialSearch:'',scenario:'normal',dev:true,zoom:1,drafts:{},modal:null};
const currentFunction = () => functions.find(f => f.id === ui.selected) || functions[0];
const lastDecision = id => state.decisions.filter(d => d.question === id).at(-1);
const pendingCount = () => questions.filter(q => lastDecision(q.id)?.state !== 'human').length;
const related = id => functions.filter(f => f.materials.includes(id) || (id === 'expiry' && f.id === 'order'));
const currentMaterials = () => currentFunction().materials.map(id => materials.find(m => m.id === id));
function save(next) { state = next; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { storageError = true; } }
let toastTimer;
function toast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'),3500); }
function empty(title,desc,action='',label='') { return `<div class="empty"><div class="empty-symbol">${icon('graph')}</div><h2>${title}</h2><p>${desc}</p>${action ? btn(action,label,'primary') : ''}</div>`; }

function render() {
  const focus = document.activeElement?.id; const caret = document.activeElement?.selectionStart;
  document.querySelector('#app').innerHTML = `
  <header class="topbar"><div class="brand"><span class="brandmark"><i></i><i></i><i></i><i></i></span>Traqen</div><div class="breadcrumb"><span>/</span><b>order-platform</b><span>/</span><span>业务理解</span></div><div class="topright"><span class="truth">UX 探索 v0.1 · 演示数据 · 未连接后端</span><span class="avatar" title="演示用户">SK</span></div></header>
  <main class="page"><div class="pagehead"><div><div class="eyebrow" style="margin-bottom:4px">TRACEABILITY / F003</div><h1>业务理解</h1><p class="subtitle">从业务功能出发，看清实现、证据与尚未解开的问题。</p><div class="context"><span class="version">来源 V12</span><span>图谱 R${state.revision}</span><span>·</span><span>order-platform / 只读来源快照</span></div></div>${btn('new-run','新建分析','primary','','plus')}</div>
  <nav class="tabs" aria-label="F003 功能导航">${[['graph','业务图谱','graph'],['review','待审问题','review'],['materials','材料覆盖','folder'],['runs','分析运行','run']].map(([id,label,ico]) => `<button class="tab ${ui.page===id?'active':''}" data-action="page" data-page="${id}" aria-current="${ui.page===id?'page':'false'}">${icon(ico)}${label}${id==='review'?`<span class="count orange">${pendingCount()}</span>`:''}</button>`).join('')}<span class="spacer"></span><span class="small muted" style="padding-bottom:13px">功能内探索稿</span></nav>
  ${storageError?'<div class="note red" role="alert">当前浏览器存储不可用，修改只能在本页暂存，刷新将丢失。</div>':''}
  ${ui.scenario==='empty' ? empty('还没有业务图谱','先选择一个已封存的来源版本，开始第一次分析。原型不会上传材料或执行真实 Agent。','new-run','创建首次分析') : ({graph:graphPage,review:reviewPage,materials:materialsPage,runs:runsPage}[ui.page])()}
  <footer class="feature-footer"><span>演示记录仅保存在此浏览器 · 不改变真实图谱或来源材料</span>${ui.dev?`<div class="devcontrols"><label for="scenario">演示场景</label><select id="scenario"><option value="normal" ${ui.scenario==='normal'?'selected':''}>正常项目</option><option value="empty" ${ui.scenario==='empty'?'selected':''}>首次进入 / 空项目</option><option value="blocked" ${ui.scenario==='blocked'?'selected':''}>来源预检阻断</option></select><button class="textbtn" data-action="reset">重置演示</button><button class="iconbtn" data-action="hide-dev" aria-label="隐藏演示控制">${icon('close')}</button></div>`:btn('show-dev','显示演示控制','ghost small')}</footer></main>`;
  if (focus) { const element = document.getElementById(focus); if (element) { element.focus(); if (typeof caret==='number' && element.setSelectionRange) element.setSelectionRange(caret,caret); } }
}

function graphPage() {
  const filtered = functions.filter(f => (!ui.humanOnly || f.state === 'human') && f.name.includes(ui.search));
  return `<div class="summaryline"><span><strong>${functions.length} 个业务功能</strong> · 7 份已关联材料 · ${pendingCount()} 个问题待处理</span><label class="check"><input id="human-filter" type="checkbox" ${ui.humanOnly?'checked':''}>仅看人工确认的功能</label></div>
  <section class="graph-layout ${ui.inspector?'':'no-inspector'}"><aside class="function-nav"><div class="navtitle"><h3 style="font-size:12px">业务功能</h3><span class="muted small">${filtered.length}</span></div><label class="search">${icon('search')}<input id="function-search" value="${esc(ui.search)}" placeholder="搜索业务功能" aria-label="搜索业务功能"></label><div class="navgroup">订单业务域</div><div class="function-list">${filtered.map(f => `<button class="function-button ${f.id===ui.selected?'selected':''}" data-action="function" data-id="${f.id}">${icon('branch')}<span>${f.name}</span><span class="function-status ${f.state}" title="${f.state==='human'?'人工确认':'Agent 分析'}"></span></button>`).join('') || '<div style="padding:20px 7px" class="small muted">没有匹配的功能<br><button class="textbtn" data-action="clear-search">清空搜索</button></div>'}</div><div class="navfoot"><span>视图来自同一张图谱</span><span>功能树是导航，不是唯一归属。</span>${btn('page','查看材料覆盖','ghost small','data-page="materials"','folder')}</div></aside>
  <div class="canvasarea"><div class="canvasbar"><div class="segmented" aria-label="图谱视图">${[['business','业务视图'],['implementation','实现视图'],['coverage','覆盖视图']].map(([id,name])=>`<button class="${ui.view===id?'active':''}" data-action="view" data-view="${id}" aria-pressed="${ui.view===id}">${name}</button>`).join('')}</div><div class="row"><span class="canvasstatus">${icon('lock')}来源 V12</span><button class="iconbtn" data-action="toggle-inspector" aria-label="${ui.inspector?'收起':'展开'}证据详情">${icon('panel')}</button></div></div>
  <div class="canvasbody">${!filtered.some(f=>f.id===ui.selected) ? empty('当前筛选中没有这个功能','选择左侧功能，或取消筛选以继续浏览。') : ui.view==='coverage'?coverageView():graphCanvas()}</div>
  <div class="canvaslegend"><div class="legenditems"><span><i></i>Agent 分析</span><span><i class="green"></i>人工确认</span><span><i class="amber"></i>待查 / 争议</span></div><span class="muted">关系有向 · 查询双向</span><div class="row" style="gap:1px"><button class="iconbtn" data-action="zoom-out" aria-label="缩小图谱">${icon('zoom')}</button><span style="font-size:9px;min-width:30px;text-align:center">${Math.round(ui.zoom*100)}%</span><button class="iconbtn" data-action="zoom-in" aria-label="放大图谱">${icon('plus')}</button></div></div></div>${ui.inspector?inspector():''}</section>`;
}

function graphCanvas() {
  const f = currentFunction(), ms = currentMaterials();
  const questionId = ['order','cancel'].includes(f.id) ? 'timeout' : f.id==='refund' ? 'coupon' : null;
  const d = lastDecision(questionId);
  const hasQuestion = Boolean(questionId);
  const shared = ui.view==='implementation' ? functions.find(other=>other.id!==f.id&&other.materials.includes(ms[0]?.id)) : null;
  const positions = [[360,20],[360,119],[360,218],[24,241]];
  const used = ms.slice(0,4);
  const root = {x:37,y:88};
  return `<div class="graph-caption">${icon('graph')}<strong>${f.name}</strong><span>· ${ui.view==='implementation'?'跨材料实现链路':'功能与证据关系'}</span></div><div class="graph-scene" style="scale:${ui.zoom}">
  <svg class="connections" viewBox="0 0 570 370"><defs><marker id="arrowhead" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" style="fill:#b4c5dc;stroke:none"/></marker><marker id="amberhead" markerWidth="7" markerHeight="6" refX="6" refY="3" orient="auto"><path d="M0 0L6 3L0 6" style="fill:#d3a14e;stroke:none"/></marker></defs>
  ${used.map((m,i)=>{const [x,y]=positions[i];const label=({'文档':'设计依据','API · 代码':'实现依据','配置 · 数据':'配置依据','测试资产':'测试断言'}[m.type]);return i===3?`<path d="M100 186 V${y}" marker-end="url(#arrowhead)"/><text class="edge-label" x="109" y="217">${label}</text>`:`<path d="M213 126 C280 126,280 ${y+34},${x} ${y+34}" marker-end="url(#arrowhead)"/><text class="edge-label" x="281" y="${y+26}">${label}</text>`;}).join('')}
  ${hasQuestion?`<path class="${d?.state==='human'?'':'attention'}" d="M213 147 C255 165,248 279,248 318 Q248 336 261 336" marker-end="url(#${d?.state==='human'?'arrowhead':'amberhead'})"/>`:''}
  ${shared?'<path d="M27 350 H14 Q4 350 4 340 V10 Q4 1 14 1 H337 Q350 1 350 15 V42 Q350 54 360 54" marker-end="url(#arrowhead)"/><text class="edge-label" x="65" y="17">多个功能可引用同一材料</text>':''}
  </svg>
  <button class="node root ${!ui.material?'selected':''}" style="left:${root.x}px;top:${root.y}px" data-action="select-root"><span class="node-type">${icon('branch')}业务功能</span><strong>${f.name}</strong><span style="margin-top:7px;display:block">${tag(f.state)}</span></button>
  ${used.map((m,i)=>`<button class="node ${ui.material===m.id?'selected':''}" style="left:${positions[i][0]}px;top:${positions[i][1]}px" data-action="material" data-id="${m.id}"><span class="node-type">${icon(m.ico)}${m.type}</span><strong>${m.name}</strong><small>${m.id==='test'?'未关联执行记录':m.path.split('/').at(-1)}</small></button>`).join('')}
  ${hasQuestion?`<button class="node rule ${d?.state==='human'?'confirmed':''}" style="left:261px;top:308px" data-action="open-question" data-id="${questionId}"><span class="node-type">${icon('review')}${d?.state==='human'?'单条规则 · 人工确认':'争议命题 · 不作为已成立分支'}</span><strong>${d?.state==='human'?'此规则已限定适用范围':questionId==='timeout'?'未支付超时：15 还是 30 分钟？':'退款后，哪些优惠券可以恢复？'}</strong></button>`:''}
  ${shared?`<button class="node shared" style="left:27px;top:326px;width:170px" data-action="function" data-id="${shared.id}"><span class="node-type">${icon('branch')}共享证据的邻接功能</span><strong>${shared.name}</strong></button>`:''}
  </div>`;
}

function coverageView() {
  return `<div class="graph-caption">${icon('folder')}<strong>材料处置，不等于理解完成</strong></div><div class="coverage-grid">${[['已关联',7,'已有可回查的功能关联'],['未归属',1,'材料保留，不自动循环'],['不支持',1,'格式限制，不计为已分析'],['受限',1,'不可读取，仍列明缺口']].map(([s,n,desc])=>`<button class="coverage-cell" data-action="coverage-filter" data-filter="${s}"><span class="small">${s}</span><strong>${n}</strong><small>${desc} ${icon('arrow')}</small></button>`).join('')}</div><div class="note blue" style="margin:0 17px">覆盖账本保留全部 10 项材料。已读取片段不代表整个文件已被理解。</div>`;
}

function inspector() {
  const f = {...currentFunction()}; const m = materials.find(x=>x.id===ui.material);
  if (f.id==='order' && lastDecision('timeout')?.state==='human') f.desc='用户提交订单后，校验商品与价格、预占库存，并创建待支付订单。超时规则已有单条人工解释，实际环境生效值仍待证。';
  if (f.id==='refund' && lastDecision('coupon')?.state==='human') f.desc='接收退款申请并校验订单状态。优惠券退还规则已有单条人工解释；原始材料中的范围缺口仍留痕。';
  if (m) return `<aside class="inspector" aria-label="证据详情"><div class="inspector-head"><span class="eyebrow">EVIDENCE / 原文依据</span><button class="iconbtn" data-action="select-root" aria-label="返回功能详情">${icon('close')}</button></div><div><h2>${m.name}</h2><span class="tag">${m.type}</span><dl class="source-meta"><dt>来源版本</dt><dd>F001 · V12（封存）</dd><dt>定位</dt><dd>${esc(m.path)}<br>行 ${m.lines}</dd><dt>关系状态</dt><dd>${tag('agent')}</dd><dt>适用范围</dt><dd>${f.scope}</dd></dl></div><div><div class="detail-label">原文片段 · 演示材料</div><pre class="code" style="border-radius:8px;font-size:10px;max-height:200px;overflow:auto">${esc(m.content || '此材料暂不可读取。')}</pre><div style="margin-top:11px">${btn('source','展开原文','small','data-id="'+m.id+'"','file')}</div></div><div style="margin-top:20px"><div class="detail-label">反向查询 · 关联的业务功能</div><div class="row wrap">${related(m.id).map(x=>btn('function',x.name,'small','data-id="'+x.id+'"')).join('')}</div></div>${m.id==='test'?'<div class="note" style="margin-top:17px"><strong>尚未验证</strong>这是测试资产；没有关联执行记录，不能推断测试通过。</div>':m.id==='config'?'<div class="note" style="margin-top:17px"><strong>配置边界</strong>默认值不等于实际环境生效值。</div>':''}<div class="inspector-footer">证据原文不随人工决定改写。<br>来源、状态、依据、范围与不确定性分别保留。</div></aside>`;
  return `<aside class="inspector" aria-label="功能详情"><div class="inspector-head"><span class="eyebrow">FUNCTION / 功能详情</span><button class="iconbtn" data-action="toggle-inspector" aria-label="收起证据详情">${icon('panel')}</button></div><div>${tag(f.state)}<h2>${f.name}</h2><p>${f.desc}</p><div class="context" style="margin-top:12px">${icon('branch')}${f.scope}</div></div><div class="divider"></div><div><div class="row between"><span class="detail-label">支撑材料</span><span class="muted" style="font-size:10px">${f.materials.length} 项</span></div>${currentMaterials().slice(0,3).map(m=>`<button class="evidence-link" data-action="material" data-id="${m.id}"><span class="fileicon">${icon(m.ico)}</span><span><strong>${m.name}</strong><small>${m.path.split('/').at(-1)} · ${m.lines}</small></span><span class="spacer"></span>${icon('chevron')}</button>`).join('')}${currentMaterials().length>3?`<button class="textbtn" data-action="material" data-id="test" style="margin:5px 0 12px">另有测试资产 · 未关联执行记录 ${icon('arrow')}</button>`:''}</div><div style="margin-top:14px">${['order','cancel'].includes(f.id)?`<div class="note"><strong>${lastDecision('timeout')?.state==='human'?'规则已获人工确认':'有一项待澄清的规则'}</strong>设计要求 30 分钟，默认实现为 15 分钟。生产生效值尚未关联。<br><button class="textbtn" data-action="open-question" data-id="timeout">查看问题与证据 →</button></div>`:'<div class="note blue"><strong>当前理解的边界</strong>此结论限定于来源 V12 的可读材料，不保证覆盖未关联的运行环境与业务例外。</div>'}</div><div class="inspector-footer">${f.state==='human'?'示例人工决定 D-014 · 限本条业务定义':'Agent 提炼 · 经证据门自动收录'}<br>自动收录不等于人工确认。</div></aside>`;
}

function sourceCard(id,label) {
  const m=materials.find(x=>x.id===id);
  return `<article class="source-card"><header><span class="row">${icon(m.ico)}${label}</span><button class="textbtn" data-action="source" data-id="${id}">读原文 ↗</button></header><pre>${esc(m.content)}</pre><footer>${esc(m.path)} · 行 ${m.lines} · V12</footer></article>`;
}
function reviewPage() {
  const q = questions.find(x=>x.id===ui.question); const f = functions.find(x=>x.id===q.func); const decision = lastDecision(q.id); const draft = ui.drafts[q.id] || {choice:'',reason:''};
  return `<div class="summaryline"><span>把需要判断的事情，整理成<strong>一个可以回答的问题</strong>。</span><span>按业务功能分组 · 决定落实到单条命题</span></div><div class="review-layout"><aside class="panel question-list"><div class="panelhead"><h3>问题队列</h3><span class="count orange">${pendingCount()}</span></div>${questions.map(item=>{const f=functions.find(x=>x.id===item.func);const d=lastDecision(item.id);return `<button class="question ${ui.question===item.id?'active':''}" data-action="question" data-id="${item.id}"><span class="eyebrow">${f.name}</span><strong>${item.name}</strong><small>${item.brief}</small><div style="margin-top:9px">${tag(d?.state==='human'?'human':d?.state==='deferred'?'deferred':'dispute')}</div></button>`;}).join('')}</aside><section class="panel"><div class="panelhead"><div><div class="eyebrow" style="margin-bottom:8px">${f.name} / 单条业务规则</div><h2>${q.name}</h2><p class="question-context">来源 V12 · 两份证据 · 调查范围与原文一起保留</p></div>${tag(decision?.state==='human'?'human':'dispute')}</div><div class="panelbody"><div class="note blue"><strong>本次需要你判断什么</strong>${q.id==='timeout'?'确定设计意图与默认实现各自适用的范围，不是修改源码或认定生产环境为 15 分钟。':'明确“符合条件”的业务范围。现有材料不足以推断所有优惠券都能退还。'} 系统不会一并批准整个功能。</div><div class="evidence-compare">${sourceCard(q.left,'设计 / 规则材料')}${sourceCard(q.right,'实现 / 关联材料')}</div>
  ${decision ? `<div class="decision-record" data-testid="decision-record"><div class="row between"><strong>${decision.state==='human'?'已记录单条人工决定':'已暂缓，问题仍保留'}</strong>${tag(decision.state)}</div><p><strong>${esc(q.options.find(option=>option[0]===decision.choice)?.[1] || '暂缓处理')}</strong></p><p>${esc(decision.reason)}</p><div class="small muted" style="margin-top:10px">演示用户 Sky · ${new Date(decision.at).toLocaleString('zh-CN')} · ${decision.state==='human'?'已形成局部图谱修订':'未升级为人工确认'}</div><div class="row" style="margin-top:13px">${btn('view-decision-graph','回到相关功能','small','data-id="'+q.func+'"','graph')}${btn('reconsider','补充 / 修订决定','ghost small')}</div></div>` : ''}
  <form id="review-form" ${decision&&!draft.edit?'class="hidden"':''}><label class="formlabel">为这条命题选择解释</label><div class="choices">${q.options.map(([id,title,detail])=>`<label class="choice"><input type="radio" name="choice" value="${id}" ${draft.choice===id?'checked':''}><span><strong>${title}</strong><small>${detail}</small></span></label>`).join('')}</div><label for="decision-reason" class="formlabel">判断依据 / 适用范围 <span class="muted">（必填）</span></label><textarea class="input" id="decision-reason" placeholder="写下你认可的范围与理由。此记录不会改写来源材料。">${esc(draft.reason)}</textarea><div id="review-error" class="validation-error" role="alert"></div><div class="formactions"><span class="small muted">补充文件需先经 F001 建立新来源版本。</span><div class="row">${btn('defer','暂缓处理')}${btn('confirm-decision','记录单条决定','primary','','check')}</div></div></form>
  <div class="divider"></div><div class="row between"><span class="small muted">${q.id==='timeout'?'已查：规则原文、默认配置、取消逻辑。未查：实际环境覆盖值。':'已查：售后规则与支付关联。缺口：优惠券恢复的具体条件。'}</span><button class="textbtn" data-action="source" data-id="${q.id==='timeout'?'config':'refund'}">查看调查依据</button></div></div></section></div>`;
}

function materialsPage() {
  const filtered=materials.filter(m=>(ui.materialFilter==='全部'||m.status===ui.materialFilter)&&(m.name+m.path).toLowerCase().includes(ui.materialSearch.toLowerCase()));
  return `<div class="statstrip">${[['来源材料','10','完整清单 · 来源 V12'],['已关联','7','建立关系，不代表完全理解'],['未归属 / 不支持','2','保留材料与原因'],['权限受限','1','不伪造可读取的内容']].map(([title,n,desc])=>`<div class="stat"><span class="small muted">${title}</span><strong>${n}</strong><small>${desc}</small></div>`).join('')}</div><section class="panel"><div class="material-toolbar"><div class="coverage-chips">${['全部','已关联','未归属','不支持','受限'].map(s=>`<button class="filterchip ${ui.materialFilter===s?'active':''}" data-action="material-filter" data-filter="${s}">${s} <span class="muted">${s==='全部'?10:materials.filter(m=>m.status===s).length}</span></button>`).join('')}</div><label class="search">${icon('search')}<input id="material-search" aria-label="搜索材料" value="${esc(ui.materialSearch)}" placeholder="搜索名称或路径"></label></div><div class="tablewrap"><table><thead><tr><th>来源材料</th><th>类型</th><th>处置状态</th><th>关联功能 / 保留原因</th><th>追溯</th></tr></thead><tbody>${filtered.map(m=>`<tr><td class="filename"><div class="row">${icon(m.ico)}<div>${m.name}<small class="mono">${m.path}</small></div></div></td><td>${m.type}</td><td>${tag(m.status==='受限'?'restricted':m.status==='已关联'?'agent':'',m.status)}</td><td>${m.status==='已关联'?related(m.id).map(f=>f.name).join('、'):({'未归属':'尚无可靠解释；不自动循环','不支持':'PDF 提取不可用，等待支持','受限':'本轮权限不允许读取'}[m.status])}</td><td>${btn('source',m.content?'原文与反查':'查看原因','ghost small','data-id="'+m.id+'"')}</td></tr>`).join('')}</tbody></table>${!filtered.length?empty('没有匹配的材料','尝试更换关键词或处置状态筛选。'):''}</div></section><div class="note blue" style="margin-top:15px">材料不会因为暂时无法解释而消失。格式失败与权限受限不进入业务审核队列；修复来源或执行条件后再调查。</div>`;
}

const stages=['预检','调查','归并','核查','图谱修订'];
function runsPage() {
  return `<div class="summaryline"><span>一份固定上下文，贯穿调查、核查与恢复。</span><span>以下运行均为前端模拟，点击按钮才推进。</span></div><div class="run-grid"><section class="panel"><div class="panelhead"><h3>分析运行</h3><span class="small muted">本次探索创建 ${state.runs.length} 次</span></div>${!state.runs.length?empty('开始一次有边界的分析','为本轮命名，确认来源、参考与执行配置。预检通过后才能启动。','new-run','新建分析'):state.runs.map(run=>`<article class="runitem" data-run-id="${run.id}"><div class="row between"><div><h3>${esc(run.name)}</h3><small>来源 ${run.source} · ${run.config} · ${new Date(run.at).toLocaleString('zh-CN')}</small></div>${tag(run.status==='complete'?'human':run.status==='cancelled'?'':'agent',({running:'模拟运行中',paused:'已暂停',cancelled:'已取消',complete:'模拟完成'}[run.status]))}</div><div class="progress-track"><span style="width:${run.progress*20}%"></span></div><div class="runstage">${stages.map((s,i)=>`<span class="${i<run.progress?'done':''}">${i<run.progress?'✓ ':''}${s}</span>`).join('')}</div><div class="runactions">${run.status==='running'?btn('run-action','推进演示一步','small primary',`data-id="${run.id}" data-step="advance"`)+btn('run-action','暂停','small',`data-id="${run.id}" data-step="pause"`):run.status==='paused'?btn('run-action','继续','small primary',`data-id="${run.id}" data-step="resume"`):''}${['running','paused'].includes(run.status)?btn('run-action','取消运行','small ghost danger',`data-id="${run.id}" data-step="cancel"`):''}<span class="small muted">${run.status==='complete'?'流程已演示完成；未执行模型、未修改图谱。':run.status==='cancelled'?'保留过程；晚到结果不再采纳。':run.status==='paused'?'进度冻结，继续后才可推进。':`已完成 ${run.progress} / 5 阶段`}</span></div></article>`).join('')}</section><aside class="panel"><div class="panelhead"><h3>执行团队</h3><span class="version">team-v3</span></div><div class="panelbody"><div class="eyebrow">F006 / 固定配置摘要</div><div class="team-row"><span class="team-avatar">M</span><div><strong>主 Agent</strong><small>规划 · 分派 · 回读核查</small></div></div><div class="note blue">下发任务 ↓　↑ 返回证据<br>每个子 Agent 都有完整往返。</div><div class="team-row"><span class="team-avatar">01</span><div><strong>子 Agent · 业务调查</strong><small>原文、条件、行为与反例</small></div></div><div class="team-row"><span class="team-avatar">02</span><div><strong>子 Agent · 证据核查</strong><small>跨材料支撑与不确定性</small></div></div><div class="divider"></div><p class="small muted">演示配置：固定模型档位与只读工具权限。运行和恢复不更换来源版本或权限。</p><p class="small muted" style="margin-top:12px">F002 用于参考核查；未提取的材料仍可通过 F001 原文调查。</p></div></aside></div>`;
}

function showModal(kind,id) {
  ui.modal = {kind,id,trigger:document.activeElement};
  let content;
  if (kind==='source') {
    const m=materials.find(x=>x.id===id);
    content=`<div class="modalhead"><div><div class="eyebrow">来源材料 / 只读证据</div><h2 style="margin:6px 0">${m.name}</h2><span class="source-title muted">${m.path}</span></div><button class="iconbtn" data-action="close-modal" aria-label="关闭原文">${icon('close')}</button></div><div class="modalbody"><div class="row between" style="margin-bottom:15px"><span class="tag">F001 · 来源 V12 · 行 ${m.lines}</span><span class="small muted">演示片段，不是实际项目代码</span></div>${m.content?`<pre class="code">${esc(m.content)}</pre>`:`<div class="note ${m.status==='受限'?'red':''}"><strong>${m.status==='受限'?'权限不足，不能显示内容':'当前格式无法提取原文'}</strong>${m.status==='受限'?'材料清单仍保留；需修复权限并重新预检。原型不会模拟越权读取。':'材料仍留在覆盖账本。不将提取失败当作业务争议。'}</div>`}<div class="divider"></div><h3 style="font-size:12px;margin-bottom:11px">反向查询 · 哪些功能引用这份材料</h3><div class="row wrap">${related(m.id).map(f=>btn('source-to-function',f.name,'small',`data-id="${f.id}"`,'branch')).join('')||'<span class="small muted">尚未建立可靠的功能关联；材料与原因仍保留。</span>'}</div>${m.id==='test'?'<div class="note" style="margin-top:20px">测试资产 ≠ 执行结果。本轮未关联执行记录，尚未验证。</div>':''}</div><div class="modal-footer"><span class="small muted">引用位置、封存版本与关系依据一起保留。</span>${btn('close-modal','返回浏览')}</div>`;
  } else {
    content=`<form id="new-run-form"><div class="modalhead"><div><div class="eyebrow">NEW ANALYSIS / 新建分析</div><h2 style="margin:6px 0">先锁定这次理解的边界</h2><p class="small muted">以下为前端预检演示，不会调用真实模型。</p></div><button type="button" class="iconbtn" data-action="close-modal" aria-label="关闭新建分析">${icon('close')}</button></div><div class="modalbody"><label class="formlabel" for="run-name" style="margin-top:0">分析名称</label><input id="run-name" class="input" required maxlength="100" placeholder="例如：订单业务 · 第一轮理解" autocomplete="off"><div class="evidence-compare"><div><label class="formlabel" for="source-version">F001 · 已封存来源</label><select class="input" id="source-version"><option>V12 · order-platform</option></select><p class="small muted" style="margin-top:7px">主分析材料 · 原文可回查</p></div><div><label class="formlabel" for="reference-version">F002 · 参考结果</label><select class="input" id="reference-version"><option value="V12" ${ui.scenario!=='blocked'?'selected':''}>V12 · 与本轮来源对应</option><option value="V11" ${ui.scenario==='blocked'?'selected':''}>V11 · 错版本（阻断演示）</option></select><p class="small muted" style="margin-top:7px">参考与核查 · 不限制可读材料</p></div></div><div class="note blue"><strong>F006 · 已生效团队 team-v3</strong>1 名主 Agent + 2 名子 Agent · 只读来源权限<br>来源、模型、工具与权限随运行固定；恢复不换上下文。</div><div id="preflight"></div><div id="run-error" class="validation-error" role="alert"></div></div><div class="modal-footer"><span class="small muted">阻断项不能跳过；新增文件需先经 F001 封存。</span><button class="btn primary" id="start-run" type="submit">${icon('run')}创建模拟运行</button></div></form>`;
  }
  document.querySelector('#overlay').innerHTML = `<div class="backdrop"><section class="modal ${kind==='source'?'wide':''}" role="dialog" aria-modal="true" aria-label="${kind==='source'?'来源原文':'新建分析'}">${content}</section></div>`;
  document.body.style.overflow='hidden';
  if(kind==='run') preflight();
  document.querySelector('.modal input,.modal button')?.focus();
}
function closeModal() {const trigger=ui.modal?.trigger;ui.modal=null;document.querySelector('#overlay').innerHTML='';document.body.style.overflow='';trigger?.isConnected&&trigger.focus();}
function preflight() {
  const ready=document.querySelector('#reference-version')?.value==='V12';
  document.querySelector('#preflight').innerHTML=`<div class="preflight ${ready?'':'blocked'}"><h3 style="font-size:12px;margin-bottom:8px">${ready?'预检就绪 · 允许带非阻断缺口启动':'预检阻断 · 来源版本不一致'}</h3><p>${icon('check')}来源身份、封存完整性、可读权限：通过（演示）</p><p>${icon(ready?'check':'close')}F002 参考版本${ready?'与 F001 V12 一致':'为 V11，不得混用到 V12'}</p><p>${icon('info')}非阻断缺口：1 项不支持格式、1 项受限材料，范围明确保留。</p></div>`;
  document.querySelector('#start-run').disabled=!ready;
}

document.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]'); if(!target || target.disabled) return;
  event.preventDefault(); const a=target.dataset.action,id=target.dataset.id;
  if(a==='page'){ui.page=target.dataset.page;render();}
  else if(a==='function'||a==='view-decision-graph'||a==='source-to-function'){if(a==='source-to-function')closeModal();ui.selected=id;ui.material=null;ui.page='graph';ui.humanOnly=false;ui.search='';render();}
  else if(a==='view'){ui.view=target.dataset.view;render();}
  else if(a==='material'){ui.material=id;ui.inspector=true;render();}
  else if(a==='select-root'){ui.material=null;render();}
  else if(a==='toggle-inspector'){ui.inspector=!ui.inspector;render();}
  else if(a==='clear-search'){ui.search='';render();}
  else if(a==='open-question'){ui.question=id;ui.page='review';render();}
  else if(a==='question'){ui.question=id;render();}
  else if(a==='source')showModal('source',id);
  else if(a==='close-modal')closeModal();
  else if(a==='new-run')showModal('run');
  else if(a==='zoom-in'||a==='zoom-out'){ui.zoom=Math.max(.7,Math.min(1.3,ui.zoom+(a==='zoom-in'?.1:-.1)));render();}
  else if(a==='coverage-filter'){ui.page='materials';ui.materialFilter=target.dataset.filter;render();}
  else if(a==='material-filter'){ui.materialFilter=target.dataset.filter;render();}
  else if(a==='reconsider'){ui.drafts[ui.question]={edit:true,choice:'',reason:''};render();document.querySelector('#decision-reason').focus();}
  else if(a==='confirm-decision'||a==='defer'){
    const reason=document.querySelector('#decision-reason').value;const choice=a==='defer'?'defer':document.querySelector('input[name="choice"]:checked')?.value;
    try { save(decide(state,ui.question,choice,reason));delete ui.drafts[ui.question];render();toast(a==='defer'?'已暂缓；未升级为人工确认。':'已记录单条决定；原始证据保持不变。'); }
    catch(error){document.querySelector('#review-error').textContent=error.message;}
  }
  else if(a==='run-action'){save(stepRun(state,id,target.dataset.step));render();}
  else if(a==='hide-dev'){ui.dev=false;render();}
  else if(a==='show-dev'){ui.dev=true;render();}
  else if(a==='reset'){if(confirm('仅清除本原型在当前浏览器中的演示记录？不影响真实数据。')){save(createState());ui.scenario='normal';ui.drafts={};render();toast('演示记录已重置。');}}
});
document.addEventListener('input',event=>{
  if(event.target.id==='function-search'){ui.search=event.target.value;render();}
  else if(event.target.id==='material-search'){ui.materialSearch=event.target.value;render();}
  else if(event.target.id==='decision-reason'){ui.drafts[ui.question]={...ui.drafts[ui.question],reason:event.target.value};}
});
document.addEventListener('change',event=>{
  if(event.target.id==='human-filter'){ui.humanOnly=event.target.checked;if(ui.humanOnly&&currentFunction().state!=='human'){ui.selected='pay';ui.material=null;}render();}
  else if(event.target.id==='scenario'){ui.scenario=event.target.value;render();if(ui.scenario==='blocked')showModal('run');}
  else if(event.target.id==='reference-version')preflight();
  else if(event.target.name==='choice'){ui.drafts[ui.question]={...ui.drafts[ui.question],choice:event.target.value};}
});
document.addEventListener('submit',event=>{
  event.preventDefault();
  if(event.target.id==='new-run-form') {
    try {save(startRun(state,document.querySelector('#run-name').value,document.querySelector('#reference-version').value==='V12'));closeModal();ui.scenario='normal';ui.page='runs';render();toast('模拟运行已创建。点击“推进演示一步”查看阶段变化。');}
    catch(error){document.querySelector('#run-error').textContent=error.message;}
  }
});
document.addEventListener('keydown',event=>{
  if(!ui.modal)return;
  if(event.key==='Escape'){closeModal();return;}
  if(event.key==='Tab'){
    const els=[...document.querySelectorAll('.modal button:not(:disabled),.modal input,.modal select,.modal textarea,.modal a')].filter(e=>e.offsetParent!==null);
    if(event.shiftKey&&document.activeElement===els[0]){event.preventDefault();els.at(-1).focus();}
    else if(!event.shiftKey&&document.activeElement===els.at(-1)){event.preventDefault();els[0].focus();}
  }
});
render();
