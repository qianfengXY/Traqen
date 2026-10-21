import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("request form mounts real investigation limits and discoverable authorized persistent request list", async () => {
  const panel = await readFile(new URL("../app/deterministic-facts/request-panel.tsx", import.meta.url), "utf8");
  const catalog = await readFile(new URL("../app/deterministic-facts/request-catalog-panel.tsx", import.meta.url), "utf8").catch(() => "");
  assert.ok(panel.includes("<RequestCatalogPanel"), "known-ID lookup alone is not a discoverable request list");
  assert.ok(catalog.includes("observeRequestCatalog("));
  assert.ok(catalog.includes("snapshot?.client === client"), "late prior-member metadata cannot flash in a new binding");
  for (const field of ["questionSummary", "scope", "updatedAt", "maximumAttempts", "deadline", "allowedCapabilities"]) assert.ok(catalog.includes(field));
  assert.ok(catalog.includes("onSelect(item.id)"), "selecting a listed ID still passes through the original authorized GET reader");
  assert.equal(catalog.includes("localStorage"), false, "trusted limits/list snapshots are not persisted as local authority");
  assert.equal(catalog.includes('"POST"'), false);
});

test("technical evidence mounts its own F002 workbench before legacy business-result gates", async () => {
  const host = await readFile(new URL("../app/traqen-product.tsx", import.meta.url), "utf8");
  const mount = host.indexOf('if (view === "feature") return <DeterministicFactsWorkbench');
  const render = host.indexOf("const renderView = (): ReactNode => {");
  const legacy = host.indexOf('if (["feature", "graph", "impact"].includes(view) && !artifact)');
  assert.ok(mount >= 0, "the technical evidence entry must render the real F002 workbench");
  assert.ok(mount > render && mount < host.indexOf('return <div className="desktop-frame"'), "mount must belong to renderView, not a save callback");
  assert.ok(legacy < 0 || mount < legacy, "no-Fact material browsing must not require a published business graph");
  assert.equal(host.includes('if (view === "feature") return <FeatureExplorer'), false, "F002 is not the legacy business projection");
  assert.equal(host.includes("useEvidenceReturn(routeSearch"), true, "the host must consume the typed return location, not only emit a URL");
  const returnGuard = host.indexOf('if (returning.active && (!returning.ready || returning.error)) return <section');
  assert.ok(returnGuard > render && returnGuard < mount, "return-location JSX belongs to renderView, never a boolean save callback");
  const reader = await readFile(new URL("../app/deterministic-facts/material-view.tsx", import.meta.url), "utf8");
  assert.equal(reader.includes("controlledTextWindow(display.bytes"), true, "bounded physical line windows must drive the actual reader");
  assert.equal(reader.includes(".split(/\\r\\n|\\r|\\n/).map"), false, "the approved full buffer must not become an unbounded line DOM");
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  assert.equal(browser.includes("useEvidenceView("), true, "metadata recovery must be connected to the real directory/reader");
});

test("controlled raster reading is bound to decode, dimensions and object URL retirement", async () => {
  const reader = await readFile(new URL("../app/deterministic-facts/material-view.tsx", import.meta.url), "utf8");
  assert.equal(reader.includes("ControlledRaster"), true, "MIME recognition alone must not make undecoded image bytes visible");
  const image = await readFile(new URL("../app/deterministic-facts/controlled-raster.tsx", import.meta.url), "utf8");
  assert.equal(image.includes("rasterImageHeader"), true, "decode allocation must first enforce the shared dimension limit");
  assert.equal(image.includes(".decode()"), true);
  assert.equal(image.includes("URL.revokeObjectURL"), true);
  assert.equal(image.includes("active = false"), true, "an old decode may not publish after identity/version disposal");
});

test("directory search is connected to real type status controls and explicit empty match states", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const directory = await readFile(new URL("../app/deterministic-facts/directory-view.tsx", import.meta.url), "utf8").catch(() => "");
  const projection = await readFile(new URL("../app/deterministic-facts/directory.ts", import.meta.url), "utf8").catch(() => "");
  assert.equal(`${browser}${projection}`.includes("filterEvidenceMaterials("), true, "material filtering must use the metadata-only shared model");
  assert.equal(browser.includes("matchEvidenceRecords("), true, "objects and facts must use explained metadata matches");
  assert.ok(browser.includes("evidenceMatchDescription") && directory.includes("evidenceMatchDescription"), "all visible hit descriptions must use the same readable labels, never raw MatchField keys");
  assert.equal(browser.includes('aria-label="材料类型筛选"'), true);
  assert.equal(browser.includes('aria-label="能力处置状态筛选"'), true);
  assert.equal(`${browser}${directory}`.includes("没有匹配材料"), true, "a filtered-out directory cannot look like a failed read or an empty Fact set");
  assert.equal(browser.includes("没有已提取事实"), true);
  assert.equal(browser.includes("没有匹配记录"), true);
});

test("Inspector can be manually closed reopened and restored without replacing the reading context", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../app/deterministic-facts/record-detail.tsx", import.meta.url), "utf8");
  assert.equal(browser.includes("view.inspectorOpen"), true, "the actual panel must follow the authorized metadata preference, not a viewport breakpoint");
  assert.equal(browser.includes("<RecordDetailPanel"), true, "the independent visual panel must actually be mounted under the preference");
  assert.equal(panel.includes('aria-label="关闭依据面板"'), true);
  assert.equal(browser.includes('aria-label="重开依据面板"'), true);
  assert.equal(browser.includes("inspectorScrollTop"), true);
  assert.equal(browser.includes("recordKind: context.kind"), true, "position binding must include the full typed record coordinate");
});

test("relation and Gap traversal use shared filters exact Fact edge identity and non-drag graph controls", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const graph = browser.includes("projectEvidenceGraph(") ? browser : await readFile(new URL("../app/deterministic-facts/relation-view.tsx", import.meta.url), "utf8").catch(() => "");
  assert.equal(graph.includes("projectEvidenceGraph("), true, "the rendered graph must consume the actual flat API edge contract");
  assert.equal(graph.includes("filterRelationFacts("), true);
  assert.equal(graph.includes("edge.fact.id"), true, "an edge click selects that same immutable Fact, never a generated diagram ID");
  assert.equal(graph.includes('aria-label="放大局部关系图"'), true);
  assert.equal(graph.includes('aria-label="向左平移局部关系图"'), true, "graph exploration must have a keyboard-accessible non-drag action");
  assert.equal(browser.includes("filterEvidenceGaps("), true);
  assert.equal(browser.includes("evidenceRelationReturn("), true, "the endpoint reader must offer an exact original-relation return action");
});

function scrollEffectDependencies(source, assignment) {
  const effect = [...source.matchAll(/useEffect\(\(\) => \{([\s\S]*?)\}, \[([^\]]*)\]\);/g)].find(match => match[1].includes(assignment));
  assert.ok(effect, "the actual list must keep its bounded scroll restoration effect");
  return effect[2].split(",").map(value => value.trim());
}

test("filtered directory scroll restoration includes late capability coverage and its active filters", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const dependencies = scrollEffectDependencies(browser, "element.scrollTop = directoryScrollTop");
  for (const metadata of ["materials.page", "coverage", "query", "materialType", "processingStatus", "directoryScrollTop"]) {
    assert.ok(dependencies.includes(metadata), `directory restoration must react to ${metadata}, not only its unfiltered material page`);
  }
});

test("filtered Gap scroll restoration includes late material coverage and its active filters", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const dependencies = scrollEffectDependencies(browser, "element.scrollTop = view.gapScrollTop");
  for (const metadata of ["gaps.page", "materials.page", "coverage", "view.gapFilters", "view.gapScrollTop"]) {
    assert.ok(dependencies.includes(metadata), `Gap restoration must react to ${metadata}, not only its unfiltered Gap page`);
  }
});

test("directory mounts keyboard-expandable admitted object hierarchy instead of a filename-only list", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const directory = await readFile(new URL("../app/deterministic-facts/directory-view.tsx", import.meta.url), "utf8").catch(() => "");
  assert.ok(browser.includes("<DirectoryView"), "the actual material directory must mount its independently testable object hierarchy");
  assert.ok(directory.includes("projectEvidenceDirectory("));
  assert.ok(directory.includes("<details") && directory.includes("<summary"), "native disclosure and nested lists must expose hierarchy without fake tree keyboard semantics");
  assert.ok(directory.includes("expandedDirectory") && directory.includes("onToggle"));
});

test("saved list and Inspector positions exclude layout-induced native scroll anchoring", async () => {
  const css = await readFile(new URL("../app/deterministic-facts/workbench.css", import.meta.url), "utf8");
  const rules = [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]+)\}/g)];
  for (const selector of [".f002-directory", ".f002-detail", ".f002-relation-list", ".f002-gap-list"]) {
    assert.ok(rules.some(([, selectors, body]) => selectors.split(",").map(value => value.trim()).includes(selector)
      && /\boverflow-anchor\s*:\s*none\s*;/.test(body)), `${selector} must not persist a browser layout adjustment as a new user position`);
  }
});

test("physical range selection is wired to independent page navigation and keyboard extension", async () => {
  const material = await readFile(new URL("../app/deterministic-facts/material-view.tsx", import.meta.url), "utf8");
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  assert.ok(material.includes("row.selected"), "actual rows must render the model's bounded selection, not only one line");
  assert.ok(material.includes("onRange") && material.includes("shiftKey") && material.includes('isEvidenceShortcut(event.nativeEvent, ["Enter", " "], true)'), "range extension must use the IME-aware guard with its declared Shift chord");
  assert.ok(material.includes("onWindowLine"), "paging must not replace the selected range");
  assert.ok(browser.includes("readingLineEnd") && browser.includes("readingWindowLine"), "real readers must persist authorized selection and page independently");
});

test("all F002 custom keyboard paths use the same IME-boundary and modifier guard", async () => {
  for (const file of ["delivery-panel.tsx", "relation-view.tsx", "record-detail.tsx", "material-view.tsx"]) {
    const source = await readFile(new URL(`../app/deterministic-facts/${file}`, import.meta.url), "utf8");
    assert.ok(source.includes('import { isEvidenceShortcut } from "./keyboard.ts";'));
    assert.ok(source.includes("isEvidenceShortcut(event.nativeEvent,"), `${file} must use the guard at the real event boundary`);
    assert.equal(source.includes("!event.nativeEvent.isComposing"), false, `${file} cannot retain an incomplete duplicated IME check`);
  }
});

test("Inspector uses readable server-bound rule premise evidence and Gap explanations without loading source bytes", async () => {
  const panel = await readFile(new URL("../app/deterministic-facts/record-detail.tsx", import.meta.url), "utf8");
  const explanation = await readFile(new URL("../app/deterministic-facts/evidence-explanation.tsx", import.meta.url), "utf8").catch(() => "");
  assert.ok(panel.includes("<EvidenceExplanation"), "the real Inspector must render the metadata explanation, not only a JSON dump");
  assert.ok(explanation.includes("explainEvidenceRecord("));
  assert.ok(panel.includes("/manifest") && panel.includes("/gaps?limit=100") && panel.includes("/coverage"));
  for (const heading of ["原文定位", "提取规则与前提", "已知限制与禁止外推"]) assert.ok(explanation.includes(heading));
  assert.equal(explanation.includes("localStorage"), false); assert.equal(panel.includes("/content"), false, "source reads stay in the independently controlled reader");
});

test("Inspector scroll restoration reacts to late readable context and limit metadata", async () => {
  const panel = await readFile(new URL("../app/deterministic-facts/record-detail.tsx", import.meta.url), "utf8");
  const dependencies = scrollEffectDependencies(panel, "element.scrollTop = scrollTop");
  for (const resource of ["manifest.data", "gaps.data", "coverage.data", "scrollTop"]) assert.ok(dependencies.includes(resource));
});

test("JSON Pointer source navigation consumes the same verified physical range as the Inspector", async () => {
  const browser = await readFile(new URL("../app/deterministic-facts/record-browser.tsx", import.meta.url), "utf8");
  const location = await readFile(new URL("../app/deterministic-facts/explanation-locations.ts", import.meta.url), "utf8");
  assert.ok(browser.includes("sourceAnchorTextRange("), "record, endpoint and directory navigation must unwrap actual TEXT ranges, not turn pointer strings into line numbers");
  assert.ok(location.includes("sourceAnchorTextRange(anchor)"), "readable positions and reader navigation share one validated coordinate contract");
  assert.ok(location.includes('anchor.kind === "JSON_POINTER"'));
  assert.equal(browser.includes('Number(record.payload.anchor'), false);
});
