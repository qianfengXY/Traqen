# Traqen

Traqen is an enterprise traceable-quality platform for legacy systems that do not have trustworthy product, design, or test assets.

The implementation follows one non-negotiable product vision:

> For every governed high-value feature, show an explainable chain from confirmed business intent to evidence produced against the actual deployment, and expose every missing, stale, conflicting, or failed link.

## Current implementation slice

The first executable slice is the framework-neutral domain kernel. It provides:

- immutable composite snapshot manifests;
- independent authority, conformance, verification, freshness, and conflict states;
- deterministic end-to-end trace-chain evaluation;
- explicit `TraceGap` detection;
- layered invalidation rules that do not invalidate business intent when code changes;
- a JSON command-line interface and automated tests.

It intentionally has no web framework, database driver, LLM, or scanner dependency yet. Those integrations will be added around this kernel after the first platform and scanner technology choices are confirmed.

## Run

Requires Node.js 20 or newer.

```bash
npm test
npm run example
```

Evaluate another trace-chain input:

```bash
node src/cli/evaluate-trace-chain.js path/to/input.json
```

The detailed design is in [docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md](docs/architecture/enterprise-traceable-quality-platform-design-v0.2.md).
1
