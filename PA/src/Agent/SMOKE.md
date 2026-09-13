# Remote PC agent — manual smoke checklist

1. **PA** running with `PA_ADMIN_SECRET`, Mongo, and TaskFlow ingest env (`TASKFLOW_*`).
2. Mobile Control Center unlocked → **Agent** tab → **Create pairing code**.
3. On PC: `cd ivx-cli && npm i && npm run build && node dist/index.js login <PA_URL>` then `pair <CODE>`.
4. `workspace add --project <KEY> --path /abs/repo` and `allow-command add "./scripts/deploy.sh"` (or your script).
5. `ai doctor` then `agent run`.
6. Mobile: **New fix job** with issue key + project id → see job queued.
7. CLI claims job; mobile job detail shows live logs / summary / diffStat → status `needs_review`.
8. **Follow-up** with more instructions → new job runs.
9. **Approve deploy** with exact allowlisted command → deploy job runs on PC → `done`.
10. **Cancel** a queued/running job; **Revoke** device (admin API) stops further claims.

Security checks: non-allowlisted command fails; path with `..` rejected at heartbeat/workspace add.
