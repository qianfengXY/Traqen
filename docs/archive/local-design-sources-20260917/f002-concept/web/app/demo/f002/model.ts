// Hand-authored demonstration fixtures, not extractor output or production contracts.
export type WorkspaceKey = "orders" | "inventory";
export type FactRef = {
	workspaceId: string;
	graphVersionId: string;
	factId: string;
};
export type Fact = {
	factId: string;
	alias: string;
	title: string;
	subjectId: string;
	predicate: string;
	object: { entityId?: string; value?: string | number };
	basis: "DECLARED" | "DERIVED";
	sourceEvidenceIds: string[];
	rule: string;
	boundary: string;
};
export const scenes = [
	{
		title: "材料已冻结",
		subtitle: "先知道分析的是哪一份材料",
		text: "先看 F001 冻结的文件，以及 F002 要交付的结果。后续画面里，左侧选事实，中间看关系，右侧查证据。点击下一步开始。",
	},
	{
		title: "事实成图",
		subtitle: "不是摘要，是可以逐条核验的数据",
		text: "文件被定位成对象，确定的声明或关系被记录成事实。文档、代码、配置、测试和图片都在图中；没有证据的关系不会被连上。",
	},
	{
		title: "每条有依据",
		subtitle: "点一条事实，回到它成立的依据",
		text: "FACT-023 只说明源码引用了某个配置键，不说明生产运行时最终取值。右侧同时保留原文、位置、规则和成立边界。",
	},
	{
		title: "未知不猜测",
		subtitle: "没有提取到，不等于不存在",
		text: "图片保留为可访问的原始对象，但图中的业务含义不由 F002 猜测。无法证明的内容留下明确缺口，与事实一起交给下一层。",
	},
	{
		title: "编号不串项目",
		subtitle: "短号便于阅读，完整坐标负责引用",
		text: "切换上方 Workspace：另一个项目也可以有 FACT-023，但它们不是同一事实。试用外部引用，看看为什么只给短号是不够的。",
	},
	{
		title: "交给 F003",
		subtitle: "交付事实数据集，不让 Agent 重新猜源码",
		text: "F003 固定 Workspace、图版本和封存范围，取得对象、事实、受控证据、缺口与词义说明。本页组装的是演示输入，不会启动 Agent。",
	},
];
export const workspaces = {
	orders: {
		name: "订单服务",
		workspaceId: "ws_demo_orders",
		graphVersionId: "gv_demo_orders_03",
		snapshotId: "ss_demo_orders_07",
		receiptId: "receipt_demo_orders_07",
		handler: "OrderController.create",
		route: "/orders",
		config: "order.timeout-seconds",
		value: 600,
		service: "Order",
	},
	inventory: {
		name: "库存服务",
		workspaceId: "ws_demo_inventory",
		graphVersionId: "gv_demo_inventory_02",
		snapshotId: "ss_demo_inventory_04",
		receiptId: "receipt_demo_inventory_04",
		handler: "StockController.reserve",
		route: "/stock/reservations",
		config: "stock.hold-seconds",
		value: 120,
		service: "Stock",
	},
} as const;
export function getDataset(key: WorkspaceKey) {
	const w = workspaces[key];
	const method = key === "orders" ? "create" : "reserve";
	const objects = [
		{
			entityId: "obj_doc_section",
			alias: "DOC-004",
			kind: "文档段落",
			label: "超时需求声明",
			location: "upload/design.md §2",
			x: 5,
			y: 12,
		},
		{
			entityId: "obj_api",
			alias: "API-002",
			kind: "HTTP 入口",
			label: `POST ${w.route}`,
			location: `git/src/${w.service}Controller.java:14`,
			x: 37,
			y: 12,
		},
		{
			entityId: "obj_code",
			alias: "CODE-017",
			kind: "代码方法",
			label: w.handler,
			location: `git/src/${w.service}Controller.java:15–17`,
			x: 37,
			y: 45,
		},
		{
			entityId: "obj_config",
			alias: "CFG-008",
			kind: "配置项",
			label: w.config,
			location: "git/config/application.yml:2",
			x: 72,
			y: 45,
		},
		{
			entityId: "obj_test",
			alias: "TEST-015",
			kind: "测试用例",
			label: `${method}_accepts_request`,
			location: `git/test/${w.service}Test.java:8–13`,
			x: 37,
			y: 79,
		},
		{
			entityId: "obj_report",
			alias: "REPORT-003",
			kind: "测试报告",
			label: "报告记录：passed",
			location: "upload/test-result.xml /testcase",
			x: 72,
			y: 79,
		},
		{
			entityId: "obj_image",
			alias: "IMG-001",
			kind: "设计图片",
			label: "架构图 · 语义未解析",
			location: "upload/architecture.png 全图",
			x: 5,
			y: 60,
		},
	];
	const evidence = [
		{
			sourceEvidenceId: "se_doc",
			objectId: "obj_doc_section",
			location: "upload/design.md §2",
			format: "text",
			content: `## 2. 超时约束\n${w.name}超时应配置为 900 秒。\n（文档声明，不代表实现已经满足）`,
		},
		{
			sourceEvidenceId: "se_code",
			objectId: "obj_code",
			location: `git/src/${w.service}Controller.java:10–18（方法及其上下文）`,
			format: "code",
			content: `10  class ${w.service}Controller {\n11    @Value("\u0024{${w.config}}")\n12    private int timeoutSeconds;\n13\n14    @PostMapping("${w.route}")\n15    public Response ${method}(Request request) {\n16      return service.submit(request, timeoutSeconds);\n17    }\n18  }`,
		},
		{
			sourceEvidenceId: "se_config",
			objectId: "obj_config",
			location: "git/config/application.yml:1–2",
			format: "code",
			content: `1  ${key === "orders" ? "order" : "stock"}:\n2    ${key === "orders" ? "timeout-seconds" : "hold-seconds"}: ${w.value}`,
		},
		{
			sourceEvidenceId: "se_test",
			objectId: "obj_test",
			location: `git/test/${w.service}Test.java:8–13`,
			format: "code",
			content: `8   // explicit test id: TEST-015\n9   @Test\n10  void ${method}_accepts_request() {\n11    ${w.service}Controller controller = fixture();\n12    assertNotNull(controller.${method}(request()));\n13  }`,
		},
		{
			sourceEvidenceId: "se_report",
			objectId: "obj_report",
			location: "upload/test-result.xml /testcase",
			format: "code",
			content: `<testcase id="TEST-015"\n  name="${method}_accepts_request"\n  result="passed" />\n<!-- 未提供可核验的执行环境与源码绑定 -->`,
		},
		{
			sourceEvidenceId: "se_image",
			objectId: "obj_image",
			location: "upload/architecture.png 全图",
			format: "image",
			content: "固定演示图片；未进行 OCR 或语义识别。",
			contentResource: {
				resourceId: "demo_image_01",
				mimeType: "image/png",
				demoPreviewPath: "/f002-demo-architecture.png",
				boundary:
					"原型公开样例路径；正式产品通过 F002 受控内容接口取证，非 F001 直读路径",
			},
		},
	];
	const facts: Fact[] = [
		{
			factId: "fact_doc_v1",
			alias: "FACT-007",
			title: "文档声明超时应为 900 秒",
			subjectId: "obj_doc_section",
			predicate: "DOCUMENT_DECLARES",
			object: { value: "超时应为 900 秒" },
			basis: "DECLARED",
			sourceEvidenceIds: ["se_doc"],
			rule: "document.literal-block@1",
			boundary:
				"只证明文档包含这段声明；不证明代码实现、当前有效性或同名配置的业务含义。",
		},
		{
			factId: "fact_route_v1",
			alias: "FACT-021",
			title: "HTTP 声明绑定到处理方法",
			subjectId: "obj_api",
			predicate: "DECLARED_HANDLER",
			object: { entityId: "obj_code" },
			basis: "DERIVED",
			sourceEvidenceIds: ["se_code"],
			rule: "spring.mapping-declaration@1",
			boundary: "静态注解声明；没有运行应用，不能保证运行环境中已暴露该入口。",
		},
		{
			factId: "fact_cfg_ref_v1",
			alias: "FACT-023",
			title: "代码静态引用配置键",
			subjectId: "obj_code",
			predicate: "STATIC_CONFIG_REFERENCE",
			object: { entityId: "obj_config" },
			basis: "DERIVED",
			sourceEvidenceIds: ["se_code", "se_config"],
			rule: "spring.value-key-resolution@1",
			boundary:
				"在此样例的唯一配置键和字段引用下成立；不推断 profile、环境变量覆盖或生产最终取值。",
		},
		{
			factId: "fact_cfg_value_v1",
			alias: "FACT-034",
			title: `配置文件声明数值 ${w.value}`,
			subjectId: "obj_config",
			predicate: "CONFIG_DECLARES_VALUE",
			object: { value: w.value },
			basis: "DECLARED",
			sourceEvidenceIds: ["se_config"],
			rule: "yaml.scalar@1",
			boundary:
				"这是冻结配置文件的字面量，不是运行时有效值；与文档数值不同也不自动判定业务缺陷。",
		},
		{
			factId: "fact_test_call_v1",
			alias: "FACT-041",
			title: "测试代码静态调用处理方法",
			subjectId: "obj_test",
			predicate: "STATIC_CALL",
			object: { entityId: "obj_code" },
			basis: "DERIVED",
			sourceEvidenceIds: ["se_test", "se_code"],
			rule: "java.resolved-call@1",
			boundary:
				"只说明可静态解析的调用；不证明测试执行过或覆盖了整个业务功能。",
		},
		{
			factId: "fact_report_v1",
			alias: "FACT-045",
			title: "报告记录该测试 passed",
			subjectId: "obj_report",
			predicate: "REPORT_RECORDS",
			object: { value: "TEST-015: passed" },
			basis: "DECLARED",
			sourceEvidenceIds: ["se_report"],
			rule: "xml.test-result-literal@1",
			boundary: "报告自身的声明；没有受信执行证据，不晋升为测试已验证。",
		},
	];
	const gaps = [
		{
			gapId: "gap_image",
			title: "图片语义未解析",
			alias: "GAP-001",
			code: "RASTER_SEMANTICS_UNSUPPORTED",
			subjectId: "obj_image",
			sourceEvidenceIds: ["se_image"],
			reason:
				"位图没有可直接解析的结构信息；F002 不用 AI 识图，不生成图中业务关系。",
			status: "terminal",
			impact: "图片对象与原图仍然保留；业务语义留待 F003 解释并明确标为候选。",
		},
		{
			gapId: "gap_runtime",
			title: "运行时配置未知",
			alias: "GAP-002",
			code: "RUNTIME_BINDING_UNAVAILABLE",
			subjectId: "obj_config",
			sourceEvidenceIds: ["se_config"],
			reason: "没有运行环境、profile 与覆盖参数，无法证明当前有效配置值。",
			status: "terminal",
			impact: "禁止把配置字面量当生产事实；F003 继承这一限制。",
		},
	];
	const materials = [
		{
			entityId: "obj_doc_section",
			kind: "文档",
			file: "design.md",
			source: "upload/design.md",
		},
		{
			entityId: "obj_code",
			kind: "源码",
			file: `${w.service}Controller.java`,
			source: `git/src/${w.service}Controller.java`,
		},
		{
			entityId: "obj_config",
			kind: "配置",
			file: "application.yml",
			source: "git/config/application.yml",
		},
		{
			entityId: "obj_test",
			kind: "测试用例",
			file: `${w.service}Test.java`,
			source: `git/test/${w.service}Test.java`,
		},
		{
			entityId: "obj_report",
			kind: "测试结果",
			file: "test-result.xml",
			source: "upload/test-result.xml",
		},
		{
			entityId: "obj_image",
			kind: "图片",
			file: "architecture.png",
			source: "upload/architecture.png",
		},
	];
	const sourcedObjects = objects.map((object) => ({
		...object,
		sourceEvidenceIds:
			object.entityId === "obj_api"
				? ["se_code"]
				: evidence
						.filter((item) => item.objectId === object.entityId)
						.map((item) => item.sourceEvidenceId),
	}));
	return { ...w, objects: sourcedObjects, evidence, facts, gaps, materials };
}
export function resolveFact(key: WorkspaceKey, ref: FactRef) {
	const d = getDataset(key);
	if (ref.workspaceId !== d.workspaceId) throw new Error("WORKSPACE_MISMATCH");
	if (ref.graphVersionId !== d.graphVersionId)
		throw new Error("GRAPH_MISMATCH");
	const fact = d.facts.find((f) => f.factId === ref.factId);
	if (!fact) throw new Error("FACT_NOT_FOUND");
	return fact;
}
export function createPacket(key: WorkspaceKey, sealed: boolean) {
	if (!sealed) throw new Error("SCOPE_NOT_SEALED");
	const d = getDataset(key);
	return {
		schemaVersion: "demo.f002-view/1",
		truth: "HAND_AUTHORED_DEMO_NOT_EXTRACTED",
		workspaceId: d.workspaceId,
		graphVersionId: d.graphVersionId,
		sourceSnapshotId: d.snapshotId,
		receiptId: d.receiptId,
		scope: {
			scopeId: "scope_demo_module",
			state: "SEALED_WITH_GAPS",
			pending: 0,
			unit: "此演示模块，不代表整仓完成",
		},
		access: {
			directSourceAccess: false,
			contentChannel: "F002_CONTROLLED_EVIDENCE",
			namespace: "workspaceId + graphVersionId + localId",
		},
		objects: d.objects.map(({ x, y, ...o }) => o),
		facts: d.facts,
		evidence: d.evidence,
		gaps: d.gaps,
		semantics: Object.fromEntries(
			d.facts.map((f) => [
				f.predicate,
				{ meaning: f.title, doesNotProve: f.boundary },
			]),
		),
		consumerRules: [
			"逐条引用完整坐标",
			"图中没有关系不代表现实中不存在",
			"业务解释保存为 F003 候选，不改写 F002 事实",
			"所有 ID 和内容均为演示样例",
		],
	};
}
export function advanceScene(scene: number, playing: boolean) {
	return playing ? Math.min(scenes.length - 1, scene + 1) : scene;
}
