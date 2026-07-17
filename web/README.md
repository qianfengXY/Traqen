> Language: **English** · [简体中文](README.zh-CN.md)

# Traqen Web

The product surface for Traqen's evidence-first Feature traceability model.

The default screen treats the Traqen repository itself as the first `SELF WORKSPACE`. Its Feature traceability capability is demonstrated with the repository's real design document, domain source, environment configuration contract, test design, and execution results. A changed `trace-chain.js` scenario shows how only implementation-derived layers become stale. The connection panel can load the same server-derived projection from a running Traqen API; the browser never computes a replacement trust score.

## Product surfaces

- Feature traceability with independent authority, conformance, verification, freshness, and conflict dimensions.
- A five-block Feature description → design/implementation → configuration → test cases → test results view. Feature description and test strategy each use one continuous document surface rather than a set of nested cards. Design/implementation loads the repository-backed Markdown design and switches between rendered design, raw Markdown, business code blocks, and the complete original source file. Configuration compares DEV/SIT/UAT/PROD; tests include expandable versioned cases; results group scenarios and drill failed executions down to the case, failed step, expected/actual values, error, and Evidence.
- An Apple-inspired visual system tuned for a 27-inch desktop display, with larger system typography, restrained colors, comfortable reading widths, and consistent layout across traceability, graph, review, impact, and metrics pages.
- A global 中文 / English switch controls navigation, page copy, and one shared dictionary for types, statuses, roles, relationships, policy values, and test outcomes. IDs, API values, configuration keys, and source code retain their canonical form; the design reader selects the matching Chinese or English Markdown file.
- A future Agent contract is reserved: Agents consume approved immutable TestSpec versions and return structured step/assertion results plus signed Evidence and runner identity. External Agent execution is not wired yet, and an Agent cannot rewrite business authority or decide the final trusted state.
- Visible TraceGap ownership and reasons that prevent a feature from being shown as complete.
- Statement-level review that loads a real Reverse Run candidate and submits an authenticated, server-validated Decision without accepting client-supplied reviewer identity.
- Historical Snapshot comparison backed by the immutable ChangeSet API, including preserved normative truth, invalidated derived layers, and a repair queue.
- Authorized implementation repair that links a new-Snapshot Reverse Candidate back to the existing Claim and restores only the implementation-conformance segment.

## Local development

Requires Node.js 22.13 or newer.

From the repository root, install dependencies once and then start both the Web application and local API with the unified commands:

```bash
npm run setup
npm run dev
```

Open `http://127.0.0.1:3000`. The API is already available at `http://127.0.0.1:3100`, matching the product's default connection value. `Ctrl+C` stops both processes.

To work on the Web package independently, run:

```bash
cd web
npm run dev
npm test
```

A separately deployed Web origin must still be listed explicitly in `CORS_ALLOWED_ORIGINS`; wildcard origins are rejected.

## Trust boundary

Demo review buttons never persist business truth and are labelled accordingly. After a real candidate is loaded, formal review requires a bearer token that remains in page memory and is cleared after success; reviewer identity and role still come only from the server. TestSpec approval, trace recomputation, and Evidence ingestion remain server-authorized workflows. The UI consumes server-derived Feature traceability and ChangeSet contracts instead of inferring completeness or impact from client data.
