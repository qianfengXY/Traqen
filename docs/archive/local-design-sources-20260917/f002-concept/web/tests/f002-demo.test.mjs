import test from "node:test";
import assert from "node:assert/strict";
import {
	resolveFact,
	createPacket,
	advanceScene,
} from "../app/demo/f002/model.ts";

const ref = {
	workspaceId: "ws_demo_orders",
	graphVersionId: "gv_demo_orders_03",
	factId: "fact_cfg_ref_v1",
};
test("full coordinates resolve a fact, not an unqualified display alias", () => {
	assert.equal(resolveFact("orders", ref)?.alias, "FACT-023");
	assert.throws(
		() => resolveFact("orders", { ...ref, factId: "FACT-023" }),
		/NOT_FOUND/,
	);
});
test("foreign workspace and graph references fail closed", () => {
	assert.throws(() => resolveFact("inventory", ref), /WORKSPACE_MISMATCH/);
	assert.throws(
		() => resolveFact("orders", { ...ref, graphVersionId: "gv_unknown" }),
		/GRAPH_MISMATCH/,
	);
});
test("sealed scope packet contains qualified facts, evidence and gaps", () => {
	const p = createPacket("orders", true);
	assert.equal(p.workspaceId, ref.workspaceId);
	assert.equal(p.graphVersionId, ref.graphVersionId);
	assert.ok(p.facts.some((f) => f.factId === ref.factId));
	assert.ok(p.gaps.some((g) => g.code === "RASTER_SEMANTICS_UNSUPPORTED"));
	for (const f of p.facts) {
		assert.ok(p.objects.some((o) => o.entityId === f.subjectId));
		if (f.object.entityId)
			assert.ok(p.objects.some((o) => o.entityId === f.object.entityId));
		for (const id of f.sourceEvidenceIds)
			assert.ok(p.evidence.some((e) => e.sourceEvidenceId === id));
	}
	assert.equal(p.access.directSourceAccess, false);
	assert.deepEqual(createPacket("orders", true), p);
});
test("pending scope has no consumable packet", () => {
	assert.throws(() => createPacket("orders", false), /SCOPE_NOT_SEALED/);
});
test("every object, including derived API nodes, has resolvable source evidence", () => {
	const packet = createPacket("orders", true);
	for (const object of packet.objects) {
		assert.ok(object.sourceEvidenceIds?.length > 0, object.alias);
		for (const id of object.sourceEvidenceIds)
			assert.ok(packet.evidence.some((e) => e.sourceEvidenceId === id));
	}
});
test("pause freezes timeline and end does not loop", () => {
	assert.equal(advanceScene(2, false), 2);
	assert.equal(advanceScene(2, true), 3);
	assert.equal(advanceScene(5, true), 5);
});
