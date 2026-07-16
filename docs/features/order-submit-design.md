> Language: **English** · [简体中文](order-submit-design.zh-CN.md)

# Order submission feature design

- Document ID: `DESIGN-ORDER-SUBMIT-001`
- Version: `2.1`
- Status: `APPROVED`
- Owner: `order-platform-architect`

## Design objective

The order-submission capability lets an authorized order owner safely move a standard draft order from `DRAFT` to `SUBMITTED`. The design must preserve authorization boundaries, state-machine constraints, idempotency, order/inventory consistency, and traceable execution Evidence.

## Request entry and validation order

1. Accept `POST /orders/{id}/submit` and establish a request correlation ID.
2. Check `order.submit.enabled`; return `FEATURE_DISABLED` when it is off.
3. Validate identity, the `order:submit` permission, and order ownership.
4. Require an idempotency key; the same order and key return the stored response without another write.
5. Lock the order in a transaction and require the current state to be `DRAFT`.
6. Reserve inventory, update the order state, and store the idempotent response.
7. Commit the transaction and emit structured logs, Trace, and Evidence references.

## Consistency and failure handling

- The only allowed transition is `DRAFT → SUBMITTED`; all other states return a stable business conflict.
- Inventory reservation and order-state mutation belong to one controlled business lifecycle.
- Any database failure rolls the transaction back, and an existing reservation must be released.
- Cleanup or compensation failure cannot be hidden by an ordinary business failure and produces separate `ERROR` Evidence.
- Historical failed executions remain immutable; a fixed PASS is appended as a new Execution.

## Authorization and security boundary

- An ordinary user may submit only an owned order and must hold `order:submit`.
- Administrative force submission is a separate Feature, Claim, Scope, and approval flow.
- The UI, an Agent, and a Runner cannot elevate permissions or rewrite business confirmation.
- Sensitive configuration is resolved only through secret references and never enters UI, logs, or Evidence in plaintext.

## Configuration and environments

- `order.submit.enabled`: submission master switch.
- `order.submit.idempotencyTtlSeconds`: idempotent response retention.
- `inventory.reserve.timeoutMs`: inventory reservation timeout.
- `database.orders.connection`: order-database secret reference.

Every value is bound to a concrete DEV, SIT, UAT, or PROD Snapshot and cannot be inferred across environments.

## Observability and Evidence

The correlation ID crosses the API, order service, database operations, inventory call, logs, and Trace. A successful execution emits HTTP, DATABASE, ASSERTION, LOG, TRACE, and LIFECYCLE Evidence. Any missing item becomes an explicit `TraceGap`.

## Implementation locations

- Order-submission business logic: `examples/order-platform/src/order-service.js`
- HTTP route: `examples/order-platform/src/router.js`
- Environment configuration: `examples/order-platform/src/environment.js`
- End-to-end tests: `examples/order-platform/tests/order-submit.test.js`

## Acceptance conditions

- Every current-deployment P0 TestSpec passes.
- No unexplained `ERROR` or `INSUFFICIENT_EVIDENCE` remains.
- Fixture and Cleanup lifecycles are complete.
- Evidence binds the current TestSpec version, Snapshot, deployment, and Runner identity.
- Business authority, implementation conformance, verification, freshness, and conflict remain independent.
