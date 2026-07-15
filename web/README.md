> Language: **English** · [简体中文](README.zh-CN.md)

# Traqen Web

The product surface for Traqen's evidence-first Feature traceability model.

The default screen is an explicitly labelled synthetic demonstration of the order-submission vertical slice. It shows a complete current-deployment proof chain and a changed-code scenario where only implementation-derived layers become stale. The connection panel can load the server-derived Feature traceability view from a real Traqen API; the browser never computes a replacement trust score.

## Product surfaces

- Feature traceability with independent authority, conformance, verification, freshness, and conflict dimensions.
- Ordered Claim → Scope → Decision → implementation/data/config → TestSpec → assertions → execution → Evidence chain.
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
