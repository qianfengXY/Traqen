"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardBody, CardHeader } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import {
	advanceScene,
	createPacket,
	getDataset,
	resolveFact,
	scenes,
	workspaces,
} from "./model";
import type { WorkspaceKey } from "./model";
import "./surface.css";

function Glyph({ kind }: { kind: string }) {
	return (
		<svg
			width="18"
			height="18"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.6"
			aria-hidden="true"
		>
			{kind === "代码方法" || kind === "HTTP 入口" ? (
				<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18" />
			) : kind === "配置项" ? (
				<>
					<path d="M4 7h16M4 17h16" />
					<circle cx="8" cy="7" r="3" fill="var(--panel)" />
					<circle cx="16" cy="17" r="3" fill="var(--panel)" />
				</>
			) : kind === "设计图片" ? (
				<>
					<rect x="3" y="3" width="18" height="18" rx="3" />
					<path d="m4 18 6-7 5 5 3-3 3 4" />
					<circle cx="16" cy="8" r="1" />
				</>
			) : (
				<>
					<path d="M5 3h10l4 4v14H5zM14 3v5h5M8 12h8M8 16h6" />
				</>
			)}
		</svg>
	);
}
export default function F002Demo() {
	const [workspace, setWorkspace] = useState<WorkspaceKey>("orders");
	const [scene, setScene] = useState(0);
	const [playing, setPlaying] = useState(false);
	const [controls, setControls] = useState(true);
	const [selected, setSelected] = useState("fact_cfg_ref_v1");
	const [query, setQuery] = useState("");
	const [sealed, setSealed] = useState(true);
	const [packetReady, setPacketReady] = useState(false);
	const [json, setJson] = useState(false);
	const [notice, setNotice] = useState("");
	const [refInput, setRefInput] = useState(
		"ws_demo_inventory / gv_demo_inventory_02 / fact_cfg_ref_v1",
	);
	const data = useMemo(() => getDataset(workspace), [workspace]);
	const packet = useMemo(
		() => (sealed ? createPacket(workspace, true) : null),
		[workspace, sealed],
	);
	const fact = data.facts.find((f) => f.factId === selected);
	const gap = data.gaps.find((g) => g.gapId === selected);
	const object = data.objects.find((o) => o.entityId === selected);
	const evidenceIds =
		fact?.sourceEvidenceIds ??
		gap?.sourceEvidenceIds ??
		object?.sourceEvidenceIds ??
		[];
	const evidence = data.evidence.filter((e) =>
		evidenceIds.includes(e.sourceEvidenceId),
	);
	const filtered = data.facts.filter((f) =>
		`${f.alias} ${f.title} ${f.predicate}`
			.toLowerCase()
			.includes(query.toLowerCase()),
	);
	function go(next: number) {
		setScene(Math.max(0, Math.min(5, next)));
		setPlaying(false);
		setNotice("");
		if (next === 3) setSelected("gap_image");
		else setSelected("fact_cfg_ref_v1");
	}
	function select(id: string) {
		setSelected(id);
		setPlaying(false);
	}
	function switchWorkspace(key: WorkspaceKey) {
		setWorkspace(key);
		setSelected("fact_cfg_ref_v1");
		setQuery("");
		setNotice("");
		setPacketReady(false);
		setSealed(true);
		setPlaying(false);
		setRefInput(
			key === "orders"
				? "ws_demo_inventory / gv_demo_inventory_02 / fact_cfg_ref_v1"
				: "ws_demo_orders / gv_demo_orders_03 / fact_cfg_ref_v1",
		);
	}
	function checkReference() {
		setPlaying(false);
		const parts = refInput.split("/").map((v) => v.trim());
		try {
			const resolved = resolveFact(workspace, {
				workspaceId: parts[0],
				graphVersionId: parts[1],
				factId: parts[2],
			});
			setSelected(resolved.factId);
			setNotice("引用有效：已定位当前 Workspace 的 " + resolved.alias);
		} catch (error) {
			setNotice(
				`拒绝引用 · ${error instanceof Error ? error.message : "INVALID_REFERENCE"}。当前图未混入外部事实。`,
			);
		}
	}
	function download() {
		if (!packetReady || !packet) return;
		const url = URL.createObjectURL(
			new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" }),
		);
		const a = document.createElement("a");
		a.href = url;
		a.download = `f002-demo-${workspace}.json`;
		a.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	useEffect(() => {
		if (!playing) return;
		const timer = setTimeout(() => {
			const n = advanceScene(scene, true);
			setScene(n);
			setSelected(n === 3 ? "gap_image" : "fact_cfg_ref_v1");
			if (n === 5) setPlaying(false);
		}, 14000);
		return () => clearTimeout(timer);
	}, [playing, scene]);
	useEffect(() => {
		function keydown(e: KeyboardEvent) {
			if (
				e.target instanceof HTMLElement &&
				e.target.closest("input,select,textarea,button,a,[contenteditable]")
			)
				return;
			if (e.code === "Space") {
				e.preventDefault();
				if (controls) setPlaying((v) => !v);
			}
			if (e.key === "ArrowRight") {
				e.preventDefault();
				go(scene + 1);
			}
			if (e.key === "ArrowLeft") {
				e.preventDefault();
				go(scene - 1);
			}
		}
		window.addEventListener("keydown", keydown);
		return () => window.removeEventListener("keydown", keydown);
	}, [scene, controls]);
	const detail = (
		<Card className="fd-inspector">
			<CardHeader
				title="证据检查器"
				subtitle="每条结论，都能问一句：凭什么？"
				action={
					<Badge variant={gap ? "warning" : "info"}>
						{gap
							? "已知缺口"
							: fact?.basis === "DERIVED"
								? "规则推导"
								: "来源声明"}
					</Badge>
				}
			/>
			<CardBody>
				<div className="fd-detail-title">
					<span className="fd-mono">
						{fact?.alias ?? gap?.alias ?? object?.alias}
					</span>
					<h3>{fact?.title ?? gap?.title ?? object?.label}</h3>
				</div>
				{fact && (
					<>
						<code className="fd-predicate">{fact.predicate}</code>
						<div className="fd-assertion">
							{data.objects.find((o) => o.entityId === fact.subjectId)?.alias}
							<span>→</span>
							{fact.object.entityId
								? data.objects.find((o) => o.entityId === fact.object.entityId)
										?.alias
								: String(fact.object.value)}
						</div>
					</>
				)}
				{gap && <p className="fd-gap-text">{gap.reason}</p>}
				<div className="fd-proof-stack">
					{evidence.map((e) => (
						<article className="fd-proof" key={e.sourceEvidenceId}>
							<div className="fd-proof-head">
								<span className="fd-mono">{e.sourceEvidenceId}</span>
								<Badge variant="muted">样例原文</Badge>
							</div>
							<p className="fd-location">{e.location}</p>
							{e.format === "image" ? (
								<>
									<img
										className="fd-source-image"
										src="/f002-demo-architecture.png"
										alt="演示原图：入口、处理与数据之间的箭头。F002 没有识别图中的文字和语义。"
									/>
									<small>这是预制原图样例，不是 F002 识图结果。</small>
								</>
							) : (
								<pre>{e.content}</pre>
							)}
						</article>
					))}
				</div>
				{fact && (
					<div className="fd-boundary">
						<b>提取规则</b>
						<code>{fact.rule}</code>
						<b>这条事实不证明什么</b>
						<p>{fact.boundary}</p>
					</div>
				)}
				{gap && (
					<div className="fd-boundary amber">
						<b>{gap.code}</b>
						<p>{gap.impact}</p>
						<strong>保留原图，不补画语义关系。</strong>
					</div>
				)}
				<details className="fd-coordinates">
					<summary>完整引用坐标</summary>
					<code>
						{data.workspaceId}
						<br />/ {data.graphVersionId}
						<br />/ {selected}
					</code>
					<p>短号只用于显示；这些机器 ID 也是演示值。</p>
				</details>
			</CardBody>
		</Card>
	);
	return (
		<div
			className="fd-root"
			data-scene={scene}
			data-playing={String(playing)}
			data-workspace={workspace}
		>
			<header className="fd-topbar">
				<div className="brand">
					<span className="brand-mark">T</span>Traqen{" "}
					<span className="fd-divider" />
					<span className="fd-surface-title">技术事实</span>
				</div>
				<div className="fd-top-actions">
					<label htmlFor="workspace">Workspace 样例</label>
					<select
						id="workspace"
						value={workspace}
						onChange={(e) => switchWorkspace(e.target.value as WorkspaceKey)}
					>
						<option value="orders">订单服务</option>
						<option value="inventory">库存服务</option>
					</select>
					<Button
						variant="ghost"
						onClick={() => {
							setControls((v) => !v);
							setPlaying(false);
						}}
					>
						{controls ? "隐藏讲解" : "显示讲解"}
					</Button>
				</div>
			</header>
			<main className="fd-main">
				<div className="fd-truth">
					<span className="fd-dot" />
					<strong>F002 概念演示</strong>
					<span>固定样例 · 未连接解析器 / Agent · 所有操作仅在演示内存中</span>
				</div>
				<section className="fd-intro">
					<div>
						<p className="eyebrow">FROM FROZEN SOURCES TO VERIFIABLE FACTS</p>
						<h1>让每一个事实，都有来处。</h1>
						<p>
							同一份材料，形成同一套可核验的参考。解释交给 Agent，证据留在这里。
						</p>
					</div>
					<div className="fd-version">
						<Badge variant="success">F001 · 已冻结样例</Badge>
						<span>{data.snapshotId}</span>
						<span>{data.graphVersionId}</span>
					</div>
				</section>
				{controls && (
					<section className="fd-guide" aria-label="演示讲解控制">
						<div className="fd-guide-head">
							<div>
								<b>0{scene + 1} / 06</b>
								<strong>{scenes[scene].subtitle}</strong>
							</div>
							<div>
								<Button
									aria-label="上一幕"
									disabled={scene === 0}
									onClick={() => go(scene - 1)}
								>
									←
								</Button>
								<Button
									aria-label={playing ? "暂停演示" : "播放演示"}
									onClick={() => {
										if (scene === 5) setScene(0);
										setPlaying((v) => !v);
									}}
								>
									{playing ? "暂停" : "播放"}
								</Button>
								<Button
									aria-label="下一幕"
									disabled={scene === 5}
									onClick={() => go(scene + 1)}
								>
									→
								</Button>
							</div>
						</div>
						<p>{scenes[scene].text}</p>
						<nav className="fd-steps" aria-label="演示场景">
							{scenes.map((s, i) => (
								<button
									key={s.title}
									aria-current={i === scene ? "step" : undefined}
									data-testid={`scene-${i}`}
									onClick={() => go(i)}
								>
									<span>{i + 1}</span>
									{s.title}
								</button>
							))}
						</nav>
						<small className="fd-keyboard">
							方向键逐幕查看 · 空格播放 / 暂停 · 自动播放每幕 14 秒
						</small>
					</section>
				)}
				<div className="fd-scopebar">
					<span>
						<b>{data.name}</b>
						<code>{data.workspaceId}</code>
					</span>
					<span>
						7 个对象 <i /> 6 条事实 <i /> 2 项已知缺口
					</span>
					<Badge variant={sealed ? "success" : "warning"}>
						{sealed ? "样例范围已封存" : "样例范围仍有待处理项"}
					</Badge>
				</div>

				{scene === 0 ? (
					<div className="fd-source-layout">
						<Card>
							<CardHeader
								title="F001 交给了什么？"
								subtitle="六份冻结材料，保留 Git / 上传目录的独立来源命名空间。"
							/>
							<CardBody>
								<div className="fd-materials">
									{data.materials.map((o) => (
										<button
											className="fd-material"
											key={o.entityId}
											onClick={() => {
												go(2);
												select(o.entityId);
											}}
										>
											<span className="fd-typeicon">
												<Glyph
													kind={
														o.kind === "源码"
															? "代码方法"
															: o.kind === "图片"
																? "设计图片"
																: o.kind
													}
												/>
											</span>
											<div>
												<b>{o.kind}</b>
												<strong>{o.file}</strong>
												<small>{o.source}</small>
											</div>
											<span>↗</span>
										</button>
									))}
								</div>
								<p className="fd-footnote">
									F001 只冻结材料，不解析方法或业务含义。点文件可跳看 F002
									保留的样例证据。
								</p>
							</CardBody>
						</Card>
						<Card className="fd-outcome">
							<CardBody>
								<span className="fd-large-symbol">
									<Glyph kind="代码方法" />
								</span>
								<h2>
									F002 的出口，
									<br />
									不再是一堆文件。
								</h2>
								<p>
									它是一份可以查询、引用和复核的
									<br />
									<b>版本化事实数据集。</b>
								</p>
								<ul>
									<li>对象：材料里明确存在什么</li>
									<li>事实：对象声明了什么、如何关联</li>
									<li>证据：依据在哪里，怎样得到</li>
									<li>缺口：哪些问题还不能回答</li>
								</ul>
								<Button variant="primary" onClick={() => go(1)}>
									看看材料怎样成为事实 →
								</Button>
								<small>预制样例切换，不启动真实扫描。</small>
							</CardBody>
						</Card>
					</div>
				) : scene === 5 ? (
					<div className="fd-delivery-layout">
						<Card>
							<CardHeader
								title="F003 将收到的输入"
								subtitle="这是数据集的受控视图，不是绕过 F002 的源码入口。"
								action={
									packetReady && <Badge variant="success">演示输入已组装</Badge>
								}
							/>
							<CardBody>
								<div className="fd-handoff">
									<div>
										<b>F001</b>
										<span>冻结材料</span>
									</div>
									<span>→</span>
									<div className="active">
										<b>F002</b>
										<span>事实 · 证据 · 缺口</span>
									</div>
									<span>→</span>
									<div>
										<b>F003</b>
										<span>业务解释候选</span>
									</div>
								</div>
								<div className="fd-delivery-actions">
									<Button
										variant="primary"
										disabled={!sealed}
										onClick={() => {
											setPacketReady(true);
											setPlaying(false);
										}}
									>
										组装演示输入
									</Button>
									<Button
										onClick={() => {
											setSealed((v) => !v);
											setPacketReady(false);
										}}
									>
										{sealed ? "模拟范围未完成" : "恢复已封存样例"}
									</Button>
									{packetReady && (
										<Button onClick={download}>下载 JSON 样例</Button>
									)}
								</div>
								{!sealed && (
									<p role="status" className="fd-blocked">
										SCOPE_NOT_SEALED · 范围内还有待处理项，不能交给
										F003。已有缺口可以终态保留，但“还没处理”不能冒充“已知缺口”。
									</p>
								)}
								{!packetReady ? (
									<div className="fd-packet-empty">
										<h3>图谱是持久化出口，输入包是读取视图。</h3>
										<p>
											点击组装，查看同一组对象、事实、受控证据与缺口如何进入
											F003。
										</p>
										<span>此演示不落生产数据，不启动 Agent。</span>
									</div>
								) : (
									<>
										<div className="fd-view-tabs">
											<button
												className={!json ? "active" : ""}
												onClick={() => setJson(false)}
											>
												可读视图
											</button>
											<button
												className={json ? "active" : ""}
												onClick={() => setJson(true)}
											>
												JSON 契约样例
											</button>
										</div>
										{json ? (
											<pre className="fd-json" data-testid="packet-json">
												{JSON.stringify(packet, null, 2)}
											</pre>
										) : (
											<div className="fd-packet" data-testid="packet-readable">
												<div className="fd-packet-head">
													<b>固定的输入坐标</b>
													<code>
														{data.workspaceId}
														<br />
														{data.graphVersionId}
														<br />
														scope_demo_module · SEALED_WITH_GAPS
													</code>
												</div>
												<div className="fd-packet-counts">
													<span>
														<b>7</b>对象
													</span>
													<span>
														<b>6</b>事实
													</span>
													<span>
														<b>6</b>证据
													</span>
													<span>
														<b>2</b>缺口
													</span>
												</div>
												<h3>样例引用</h3>
												<code>
													{data.workspaceId} / {data.graphVersionId} /
													fact_cfg_ref_v1
												</code>
												<p>
													含义：CODE-017 静态引用 CFG-008。
													<br />
													依据：se_code、se_config。
													<br />
													限制：不能证明运行时有效值。
												</p>
												<div className="fd-gap-callout">
													随包继承：图片语义未解析；运行时配置绑定未知。
												</div>
												<h3>F003 必须遵守</h3>
												<ul>
													<li>按完整坐标引用事实，按需读取 F002 受控证据。</li>
													<li>
														不能绕回 F001 直接读源码；不能把缺口补成“事实”。
													</li>
													<li>业务解释另存为候选，不改写本层事实。</li>
												</ul>
											</div>
										)}
									</>
								)}
							</CardBody>
						</Card>
						{detail}
					</div>
				) : (
					<>
						{scene === 4 && (
							<Card className="fd-isolation">
								<CardHeader
									title="两个 Workspace 都有 FACT-023，会撞号吗？"
									subtitle="不会。完整引用绑定项目和图版本；以下只演示前端范围校验，不冒充服务端鉴权。"
								/>
								<CardBody>
									<div className="fd-reference-form">
										<label htmlFor="reference">
											workspaceId / graphVersionId / factId
											<input
												id="reference"
												value={refInput}
												onChange={(e) => setRefInput(e.target.value)}
											/>
										</label>
										<Button variant="primary" onClick={checkReference}>
											校验引用
										</Button>
										<Button
											onClick={() => {
												setRefInput(
													`${data.workspaceId} / ${data.graphVersionId} / fact_cfg_ref_v1`,
												);
												setNotice("");
											}}
										>
											换成当前图引用
										</Button>
									</div>
									{notice && (
										<p
											role="status"
											className={
												notice.startsWith("拒绝") ? "fd-blocked" : "fd-valid"
											}
										>
											{notice}
										</p>
									)}
								</CardBody>
							</Card>
						)}
						<div className="fd-workbench">
							<Card className="fd-directory">
								<CardHeader
									title="事实目录"
									subtitle="短号用于阅读，机器引用有完整坐标。"
								/>
								<CardBody>
									<label className="fd-search">
										<span className="sr-only">搜索事实</span>
										<input
											type="search"
											aria-label="搜索事实"
											placeholder="搜索编号 / 内容 / 关系"
											value={query}
											onChange={(e) => {
												setQuery(e.target.value);
												setPlaying(false);
											}}
										/>
									</label>
									{query && (
										<p className="fd-query" role="status">
											“{query}” · {filtered.length} 条结果
										</p>
									)}
									<div className="fd-fact-list">
										{filtered.map((f) => (
											<button
												key={f.factId}
												className={selected === f.factId ? "selected" : ""}
												onClick={() => select(f.factId)}
											>
												<small>
													{f.alias}
													<span>{f.basis === "DERIVED" ? "推导" : "声明"}</span>
												</small>
												<strong>{f.title}</strong>
											</button>
										))}
										{filtered.length === 0 && (
											<p className="fd-footnote">没有匹配的演示事实。</p>
										)}
									</div>
									<div className="fd-gap-list">
										<h3>
											已知缺口 <span>2</span>
										</h3>
										{data.gaps.map((g) => (
											<button
												key={g.gapId}
												className={selected === g.gapId ? "selected" : ""}
												onClick={() => select(g.gapId)}
											>
												<span>{g.alias}</span>
												<b>
													{g.gapId === "gap_image"
														? "图片语义未解析"
														: "运行时配置未知"}
												</b>
											</button>
										))}
									</div>
								</CardBody>
							</Card>
							<Card className="fd-graph-panel">
								<CardHeader
									title="技术事实图"
									subtitle="点节点看来源，点关系看证据。没有边，不代表没有关系。"
									action={<Badge variant="info">演示数据</Badge>}
								/>
								<div className="fd-graph-scroll">
									<div className="fd-graph" aria-label="演示事实图">
										<svg
											className="fd-edges"
											viewBox="0 0 720 460"
											preserveAspectRatio="none"
											aria-hidden="true"
										>
											<defs>
												<marker
													id="arrow"
													markerWidth="7"
													markerHeight="7"
													refX="6"
													refY="3.5"
													orient="auto"
												>
													<path d="M0 0 7 3.5 0 7" fill="#93b4e8" />
												</marker>
											</defs>
											<path d="M353 135 V207" />
											<path
												className={
													selected === "fact_cfg_ref_v1" ? "active" : ""
												}
												d="M439 240 H518"
											/>
											<path d="M353 363 V287" />
										</svg>
										{data.objects.map((o) => (
											<button
												key={o.entityId}
												className={`fd-node ${o.kind === "设计图片" ? "unknown" : ""} ${selected === o.entityId || fact?.subjectId === o.entityId || fact?.object.entityId === o.entityId ? "lit" : ""}`}
												style={{ left: `${o.x}%`, top: `${o.y}%` }}
												onClick={() => select(o.entityId)}
											>
												<span className="fd-node-kind">
													<Glyph kind={o.kind} />
													{o.kind}
													<code>{o.alias}</code>
												</span>
												<strong>{o.label}</strong>
											</button>
										))}
										<button
											className="fd-edge-label edge-route"
											onClick={() => select("fact_route_v1")}
										>
											FACT-021 · 声明绑定
										</button>
										<button
											className={`fd-edge-label edge-config ${selected === "fact_cfg_ref_v1" ? "active" : ""}`}
											onClick={() => select("fact_cfg_ref_v1")}
										>
											FACT-023
											<br />
											静态引用 →
										</button>
										<button
											className="fd-edge-label edge-test"
											onClick={() => select("fact_test_call_v1")}
										>
											FACT-041 · 静态调用
										</button>
									</div>
								</div>
								<div className="fd-graph-legend">
									<span>
										<i className="blue" />
										有证据的关系
									</span>
									<span>
										<i className="amber" />
										语义未知，保留对象
									</span>
								</div>
								<div className="fd-graph-note">
									<b>没有“看起来像”这类关系</b>
									<p>
										文档、报告和图片保留各自来源。共同名称或数字，不足以证明“功能已实现”或“测试已覆盖”。
									</p>
								</div>
							</Card>
							{detail}
						</div>
					</>
				)}
				<footer className="fd-footer">
					<span>F002 的严谨：结论可核验，未知可见，引用不串范围。</span>
					<span>功能表面原型 · 非正式产品入口 · 刷新重置</span>
				</footer>
			</main>
		</div>
	);
}
