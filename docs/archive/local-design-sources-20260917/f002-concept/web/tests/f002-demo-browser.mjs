import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
const { chromium } = await import(
	process.env.F002_PLAYWRIGHT_MODULE
		? pathToFileURL(process.env.F002_PLAYWRIGHT_MODULE).href
		: "playwright"
);
const base = process.env.F002_DEMO_URL ?? "http://localhost:3182/demo/f002";
const output = await mkdtemp(join(tmpdir(), "f002-demo-evidence-"));
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({
	viewport: { width: 1440, height: 1000 },
	acceptDownloads: true,
});
const errors = [];
const external = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("request", (r) => {
	if (
		/^https?:/.test(r.url()) &&
		new URL(r.url()).hostname !== "127.0.0.1" &&
		new URL(r.url()).hostname !== "localhost"
	)
		external.push(r.url());
});
const scene = (n) => page.getByTestId(`scene-${n}`).click();
const step = () => page.locator(".fd-root").getAttribute("data-scene");
const check = (yes, label) => {
	assert.ok(yes, label);
	console.log("PASS", label);
};
try {
	await page.goto(base, { waitUntil: "networkidle" });
	check(
		(await page.locator(".fd-material").count()) === 6,
		"six source classes visible",
	);
	check(
		(await page.locator(".fd-truth").innerText()).includes("未连接解析器"),
		"honest fixture label",
	);
	await scene(2);
	for (const alias of [
		"DOC-004",
		"API-002",
		"CODE-017",
		"CFG-008",
		"TEST-015",
		"REPORT-003",
		"IMG-001",
	]) {
		await page.locator(".fd-node").filter({ hasText: alias }).click();
		check(
			(await page.locator(".fd-proof").count()) > 0,
			alias + " node exposes source evidence",
		);
	}
	await page
		.getByRole("button", { name: "FACT-021 推导 HTTP 声明绑定到处理方法" })
		.click();
	check(
		(await page.locator(".fd-inspector").innerText()).includes(
			"spring.mapping-declaration@1",
		),
		"fact selection changes rule and evidence",
	);
	const sentinel = "f002-unseen-<b>probe</b>";
	await page.getByRole("searchbox", { name: "搜索事实" }).fill(sentinel);
	check(
		(await page.locator(".fd-query").innerText()).includes(sentinel),
		"foreign search input flows into DOM",
	);
	check(
		(await page.locator(".fd-query b").count()) === 0,
		"input rendered as text",
	);
	check(
		(await page.locator(".fd-fact-list button").count()) === 0,
		"search filters actual fixture results",
	);
	await page.getByRole("searchbox", { name: "搜索事实" }).press("ArrowRight");
	check((await step()) === "2", "input arrows do not advance presentation");
	await page.getByRole("searchbox", { name: "搜索事实" }).fill("");
	await scene(3);
	check(
		(await page.locator(".fd-inspector").innerText()).includes(
			"RASTER_SEMANTICS_UNSUPPORTED",
		),
		"image gap has cause and evidence",
	);
	await page.waitForFunction(() => {
		const img = document.querySelector(".fd-source-image");
		return img?.complete && img.naturalWidth > 0;
	});
	check(
		await page
			.locator(".fd-source-image")
			.evaluate((e) => e.complete && e.naturalWidth > 0),
		"original fixture image loaded",
	);
	await page
		.locator(".fd-gap-list button")
		.filter({ hasText: "运行时配置未知" })
		.click();
	check(
		(await page.locator(".fd-detail-title h3").innerText()) ===
			"运行时配置未知",
		"runtime gap retains its own title",
	);
	check(
		(await page.locator(".fd-inspector").innerText()).includes(
			"RUNTIME_BINDING_UNAVAILABLE",
		),
		"runtime gap retains its own cause",
	);
	await scene(4);
	await page.getByRole("button", { name: "校验引用", exact: true }).click();
	check(
		(await page.getByRole("status").innerText()).includes("WORKSPACE_MISMATCH"),
		"cross workspace reference rejected",
	);
	await page.getByRole("button", { name: "换成当前图引用" }).click();
	await page.getByRole("button", { name: "校验引用", exact: true }).click();
	check(
		(await page.getByRole("status").innerText()).includes("引用有效"),
		"current qualified reference resolves",
	);
	await page.getByLabel("Workspace 样例").selectOption("inventory");
	check(
		(await page.locator(".fd-inspector").innerText()).includes(
			"stock.hold-seconds",
		),
		"same short alias resolves inventory evidence after workspace switch",
	);
	check(
		!(await page.locator(".fd-inspector").innerText()).includes(
			"order.timeout-seconds",
		),
		"previous workspace content absent",
	);
	await scene(5);
	await page.getByRole("button", { name: "模拟范围未完成" }).click();
	check(
		await page.getByRole("button", { name: "组装演示输入" }).isDisabled(),
		"unsealed scope blocks input",
	);
	await page.getByRole("button", { name: "恢复已封存样例" }).click();
	await page.getByRole("button", { name: "组装演示输入" }).click();
	await page.getByRole("button", { name: "JSON 契约样例" }).click();
	const packet = JSON.parse(await page.getByTestId("packet-json").innerText());
	check(
		packet.workspaceId === "ws_demo_inventory" && packet.gaps.length === 2,
		"input includes pinned namespace and gaps",
	);
	check(
		packet.access.directSourceAccess === false,
		"no F001 bypass in contract",
	);
	const downloadPromise = page.waitForEvent("download");
	await page.getByRole("button", { name: "下载 JSON 样例" }).click();
	const download = await downloadPromise;
	const stream = await download.createReadStream();
	let content = "";
	for await (const chunk of stream) content += chunk;
	assert.deepEqual(JSON.parse(content), packet);
	console.log("PASS download matches visible packet");
	await page.getByLabel("Workspace 样例").selectOption("orders");
	check(
		(await page.getByTestId("packet-json").count()) === 0,
		"workspace switch clears old input packet",
	);
	await scene(1);
	await page.clock.install();
	await page.getByRole("button", { name: "播放演示", exact: true }).click();
	await page.clock.runFor(14050);
	check((await step()) === "2", "automatic timeline advances one scene");
	await page.getByRole("button", { name: "暂停演示", exact: true }).click();
	await page.clock.runFor(30000);
	check((await step()) === "2", "pause freezes timeline beyond a full scene");
	await page.locator("h1").click();
	await page.keyboard.press("ArrowRight");
	check((await step()) === "3", "keyboard moves to next scene");
	await page.keyboard.press("Space");
	await page.clock.runFor(1000);
	await page.keyboard.press("Space");
	check(
		(await page.locator(".fd-root").getAttribute("data-playing")) === "false",
		"space toggles shared pause state",
	);
	await page.getByRole("button", { name: "隐藏讲解", exact: true }).click();
	check(
		(await page.getByRole("navigation", { name: "演示场景" }).count()) === 0,
		"presentation controls hide",
	);
	await page.getByRole("button", { name: "显示讲解", exact: true }).click();
	for (const width of [1440, 390]) {
		await page.setViewportSize({ width, height: width === 390 ? 844 : 1000 });
		for (let i = 0; i < 6; i++) {
			await scene(i);
			if (i === 5) {
				await page.getByRole("button", { name: "组装演示输入" }).click();
				await page
					.getByRole("button", { name: "可读视图", exact: true })
					.click();
			}
			check(
				await page.evaluate(
					() => document.documentElement.scrollWidth <= innerWidth,
				),
				`scene ${i + 1} at ${width}px has no page overflow`,
			);
			await page.screenshot({
				path: join(output, `${width}-scene-${i + 1}.png`),
				fullPage: true,
			});
		}
	}
	await page.reload({ waitUntil: "networkidle" });
	check((await step()) === "0", "refresh honestly resets demo");
	check(errors.length === 0, "no runtime errors: " + errors.join(";"));
	check(external.length === 0, "no external requests: " + external.join(";"));
	console.log("EVIDENCE", output);
	console.log("ALL CHECKS PASSED");
} finally {
	await browser.close();
}
