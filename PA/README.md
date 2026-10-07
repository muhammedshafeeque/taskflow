# WhatsApp PA

## Project support groups

1. Control Center → **Groups**: enable auto-reply and assign one or more Atrium projects.
2. That group becomes the **official support channel** — every message is processed (no @mention required).
3. Pipeline: Chat Analyzer → Support Engineer → (optional) QA Lead → Service Desk ticket → WhatsApp reply.
4. Live feed: Control Center → **Support** (SSE events + cases).

## Env

See `.env.example`. Required for tickets/context: `TASKFLOW_API_URL`, `TASKFLOW_INGEST_SECRET`, `TASKFLOW_ORG_ID` (must match server `PA_INGEST_SECRET` / `PA_DEFAULT_ORG_ID`).

## Tests

```bash
npm test
```
