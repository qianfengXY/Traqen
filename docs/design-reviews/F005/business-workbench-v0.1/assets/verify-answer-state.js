async (page) => {
 const isolated=await page.context().browser().newContext();page=await isolated.newPage();
 try {
 const base='http://127.0.0.1:5186/assets/index.html';
 const checks=[];const pageErrors=[];const onError=e=>pageErrors.push(String(e));page.on('pageerror',onError);
 const check=(name,ok,details='')=>checks.push({name,pass:!!ok,details});
 await page.setViewportSize({width:1440,height:900});
 await page.goto(base+'?page=impact');
 await page.getByRole('link',{name:'查看原回答',exact:true}).click();
 const main=await page.locator('main').innerText();
 check('影响入口返回回答后可见新分析未生效及当前 g7',/新分析.*尚未生效/.test(main)&&main.includes('r9')&&main.includes('g7'));
 const timeout=page.locator('[data-answer-id="rules-timeout"]');
 check('30 分钟条目就地提示 r9 已证实影响和待复核',await timeout.count()===1 && /r9[\s\S]*待复核/.test(await timeout.innerText()));
 check('保留 r8 的30分钟并列新材料15分钟，不偷换当前规则',await timeout.count()===1 && (await timeout.innerText()).includes('30 分钟') && (await timeout.innerText()).includes('15 分钟'));
 check('Q02 三个命题分别可选',await page.locator('[data-answer-choice]').count()===3);
 const q2Inspector=await page.locator('[aria-label="答案依据与状态"]').innerText();
 await page.goto(base+'?page=graph&q=purpose');
 const q1Inspector=await page.locator('[aria-label="答案依据与状态"]').innerText();
 check('检查器随回答变化且功能目的不借用已支付分歧',q1Inspector!==q2Inspector&&!q1Inspector.includes('已支付分支有分歧'));
 for(const q of ['data','tests','versions','verification']){
  await page.goto(base+'?page=graph&q='+q);
  check(q+' 不用通用带依据徽标遮蔽未知或未验证',!(await page.locator('main').innerText()).includes('带依据的回答'));
 }
 await page.goto(base+'?page=graph&q=data');
 check('业务数据有带类型未知原因',await page.locator('[data-unknown-kind]').count()>0);
 await page.goto(base+'?page=graph&q=rules&answer=rules-timeout');
 const evidence=page.getByRole('link',{name:'查阅依据',exact:true});
 await evidence.click();
 await page.getByRole('link',{name:'返回原回答',exact:true}).click();
 check('原文往返保留准确回答条目',new URL(page.url()).searchParams.get('answer')==='rules-timeout');

 // Check the boundary that a review screenshot alone cannot establish.
 await page.locator('[data-answer-choice="rules-manual"]').click();
 check('人工确认只绑定主动取消命题', (await page.locator('[data-state="authority"]').innerText()).includes('D-012'));
 await page.locator('[data-action="decision-source"]').click();
 check('确认详情明确不覆盖自动取消及退款', (await page.locator('#dialog').innerText()).includes('下单用户可取消未支付订单') && (await page.locator('#dialog').innerText()).includes('不覆盖'));
 await page.keyboard.press('Escape');
 check('对话框 Escape 返回触发控件', await page.locator('[data-action="decision-source"]').evaluate(el=>el===document.activeElement));
 await page.locator('[data-answer-choice="rules-paid"]').click();
 check('已支付命题单独显示分歧且无 D-012 确认', (await page.locator('[data-state="conformance"]').innerText()).includes('意图允许 / 实现拒绝') && !(await page.locator('[data-state="authority"]').innerText()).includes('D-012'));
 await page.locator('[data-answer-choice="rules-timeout"]').click();
 const answerBefore=await page.locator('[data-answer-id]').getAttribute('data-answer-id');
 await page.locator('[data-action="theme"]').click();
 check('主题切换保留准确命题和就地影响提示', await page.locator('[data-answer-id]').getAttribute('data-answer-id')===answerBefore && (await page.locator('.answer-impact').innerText()).includes('r9'));
 await page.reload();
 check('刷新恢复主题且 URL 指定同一条目', await page.locator('html').getAttribute('data-theme')==='dark' && await page.locator('[data-answer-id]').getAttribute('data-answer-id')==='rules-timeout');
 await page.getByRole('link',{name:'查看对应影响项',exact:false}).click();
 check('回答可回到准确影响项',new URL(page.url()).searchParams.get('impact')==='timeout' && await page.locator('#impact-timeout').evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=66&&r.top<innerHeight}));
 for(const q of ['purpose','rules','implementation','data','tests','versions','verification']){
  await page.goto(base+'?page=graph&q='+q);
  check(q+' 有自己的五维状态和范围', await page.locator('[data-state]').count()===5 && (await page.locator('[data-inspector-answer]').getAttribute('data-inspector-answer'))===(await page.locator('[data-answer-id]').getAttribute('data-answer-id')));
 }
 await page.goto(base+'?page=graph&q=data');
 await page.getByRole('link',{name:'查阅依据',exact:true}).click();
 check('数据条目的原文入口不冒充需求文件',await page.locator('h1').innerText()==='order-repository.sql' && (await page.locator('pre').innerText()).includes('UPDATE orders'));
 for(const [id,label] of [['overview','工作区概览'],['sources','来源快照'],['evidence','技术证据'],['graph','业务图谱'],['impact','变更影响'],['settings','设置中心']]){
  await page.locator('.sidebar nav').getByRole('link',{name:label,exact:false}).click();
  check(label+' 导航 URL 与唯一 active 一致',new URL(page.url()).searchParams.get('page')===id && await page.locator('.sidebar nav [aria-current="page"]').count()===1);
 }
 await page.goto(base+'?page=overview&view=session');
 await page.getByRole('button',{name:'调查 Agent · 查看身份',exact:true}).click();
 const actor=await page.locator('#dialog').innerText();
 check('Agent 合成身份可回查模型 Skill 和配置修订',actor.includes('AGENT-DEMO-01')&&actor.includes('fixture-1')&&actor.includes('demo-config-03'));
 await page.keyboard.press('Escape');
 await page.locator('[data-action="contribute"]').click();
 check('空回写定位字段且有错误说明',await page.locator('#contribution').getAttribute('aria-invalid')==='true' && await page.locator('#draft-error').isVisible());
 await page.locator('#contribution').fill('回归检查：先核对退款入口，再留下理由。');
 await page.locator('[data-action="theme"]').click();
 check('主题切换保留会话草稿',(await page.locator('#contribution').inputValue()).includes('回归检查'));
 await page.goto(base+'?page=overview&view=session');
 check('离开后返回保留会话草稿',(await page.locator('#contribution').inputValue()).includes('回归检查'));
 await page.locator('#contribution-kind').selectOption('decision');
 await page.locator('[data-action="contribute"]').click();
 check('正式决定不伪造提交成功',(await page.locator('#dialog').innerText()).includes('不实现权限校验或真实决定提交'));
 await page.keyboard.press('Escape');
 await page.locator('#contribution-kind').selectOption('finding');
 await page.locator('[data-action="contribute"]').click();
 check('演示贡献仍是待分流未进入真实答卷',(await page.locator('.timeline').innerText()).includes('演示贡献 · 待分流') && (await page.locator('#announcement').innerText()).includes('未进入真实答卷'));
 await page.goto(base+'?page=overview');
 await page.locator('[data-action="new"]').first().click();
 await page.locator('#new-title').fill('核查未知归属');
 await page.locator('#new-form button').click();
 check('未归属新工作不虚构 Agent 参与',(await page.locator('[aria-label="工作范围"]').innerText()).includes('林予（仅创建者）') && !(await page.locator('.timeline').innerText()).includes('调查 Agent'));
 check('新会话草稿与已有贡献隔离',await page.locator('#contribution').inputValue()==='' && !(await page.locator('.timeline').innerText()).includes('回归检查'));
 const layouts=[];
 for(const [width,height] of [[1440,900],[2560,1440]]){
  await page.setViewportSize({width,height});
  for(const query of ['page=overview','page=graph&q=rules&answer=rules-timeout','page=overview&view=session','page=impact']){
   await page.goto(base+'?'+query);
   await page.waitForFunction(s=>Number(document.querySelector('#app').dataset.scale)===s,width===1440?1:1.6);
   const layout=await page.evaluate(()=>{const el=document.querySelector('main'),s=Number(document.querySelector('#app').dataset.scale);return {scale:s,overflow:el.scrollWidth>el.clientWidth,geometry:['.sidebar','.topbar','.reading','.inspector'].map(sel=>{const r=document.querySelector(sel)?.getBoundingClientRect();return r?[r.width/s,r.height/s]:null}),text:el.innerText};});
   layouts.push({width,height,query,...layout});
   check(width+' '+query+' 无横向溢出',!layout.overflow);
  }
 }
 const small=layouts.find(x=>x.width===1440&&x.query.includes('graph')),large=layouts.find(x=>x.width===2560&&x.query.includes('graph'));
 check('两显示倍率文本相同且几何归一误差小于1px',small.text===large.text && small.geometry.every((r,i)=>r.every((n,j)=>Math.abs(n-large.geometry[i][j])<1)));
 await page.setViewportSize({width:1440,height:900});
 await page.goto(base.replace('index.html','offline.html')+'?page=graph&q=rules&answer=rules-timeout');
 check('离线单文件同步回答状态和新分析提示',await page.locator('[data-answer-id="rules-timeout"]').count()===1 && (await page.locator('.pending-analysis').innerText()).includes('尚未生效'));
 page.off('pageerror',onError);
 return {artifact:'F005 business-workbench v0.1.1',verifiedAt:new Date().toISOString(),checks,passed:checks.filter(x=>x.pass).length,total:checks.length,layouts,pageErrors,
 red:{base:'c94309d3e48e63f2ae246d4f6491ead22d9c2189',checks:11,failed:11,scope:'原稿影响往返、条目状态、UnknownReason与原文定位缺口'},
 limitations:['Static synthetic fixture only; no backend, real authorization or publication.','1440 master only; no mobile or complete accessible reflow.','Graph is a fixed one-hop illustration.','Offline single file verified via HTTP, not all file:// browser policies.']};

 } finally {await isolated.close();}
}