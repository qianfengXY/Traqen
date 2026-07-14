# Order platform reference project

This synthetic system is Traqen's built-in, non-production reference target. It exposes `POST /orders/{id}/submit`, writes PostgreSQL-compatible state, reserves inventory, requires an allowed role and idempotency key, and guarantees cleanup/rollback behavior around controlled tests.

It exists to exercise the same Scanner, Reverse Skill, review, TestSpec, Runner, Evidence, change-impact, and repair protocols used for a real pilot. No Traqen production mechanism contains an order-domain special case.

Run the target tests with:

```bash
npm run test:reference
```

Run the complete vertical pilot with:

```bash
npm run pilot:order-submit
```
