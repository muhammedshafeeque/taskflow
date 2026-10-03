# Advanced feature catalogue

Status: ✅ integrated in v2 · 🧩 backend exists, mobile UI candidate · 💡 needs new backend work

## Monitoring & alerting (Atrium Monitor)

| Feature | Status | Notes |
| --- | --- | --- |
| Cross-project health feed (errors, live users, HTTP failures, uptime) | ✅ | `GET /api/admin/monitor/feed` on PA |
| Error groups: list, search, open/resolved, detail with stack, resolve/reopen, copy/share | ✅ | |
| Uptime checks: heartbeat bar, latency sparkline, success %, create/delete | ✅ | |
| Logs with level filter, search, expandable meta | ✅ | |
| HTTP calls with 4xx/5xx filter | ✅ | |
| Transactions: p95/avg per route, response-time sparkline | ✅ | |
| Web vitals (LCP/INP/CLS/TTFB) with good/poor rating | ✅ | |
| Live users / sessions, releases | ✅ | |
| Alert rules CRUD (9 triggers + conditions), enable toggle, send test | ✅ | |
| Alert delivery history | ✅ | |
| Server-side Expo push (new deliveries, new errors, outage + recovery) | ✅ | PA watcher, `MONITOR_WATCH_INTERVAL_SEC` |
| Background polling + local notifications fallback | ✅ | `expo-background-task` |
| Notification deep links (error → detail, others → alerts) | ✅ | |
| Per-device notification filters (kinds, critical-only) | ✅ | |
| Environment/app scoping for rules and views | 🧩 | API supports `environmentId`/`appId` |
| Monitor project / environment / app setup, API key rotation | 🧩 | Staff endpoints already proxied |
| Acknowledge / snooze / assign incidents | 💡 | Needs an incident model on Atrium |
| On-call schedules & escalation policies | 💡 | |
| Push as an Atrium alert *channel* (instead of PA polling) | 💡 | Add `push` recipients to `MonitorAlertRule` |
| Release health: crash-free sessions, regressions per release | 💡 | Needs session aggregation |
| Create Atrium issue from an error group (one tap) | 💡 | Needs issue-create via ingest |
| Send error group to Agent "fix on my PC" | 💡 | Map error → issue key first |

## Ops & automation

| Feature | Status | Notes |
| --- | --- | --- |
| Ask PA assistant (text) with ops actions | ✅ | `/voice/command` |
| Hold-to-talk voice commands (Whisper) | ✅ | `/voice/transcribe` |
| Spoken replies (TTS, Malayalam/English) | ✅ | `/voice/speak` |
| Agent: fix / run-command jobs, live logs, approve deploy, follow-up, revoke | ✅ | |
| Home quick actions (pause bot, Ask PA, fix job, approvals) | ✅ | |
| Android home-screen widget (status + pause toggle) | 💡 | Native module |
| App shortcuts (long-press icon → Pause bot / Alerts) | 💡 | Config plugin |
| Scheduled bot pause (quiet hours) | 💡 | PA settings field + scheduler |
| Saved assistant macros | 💡 | |

## WhatsApp & CRM

| Feature | Status | Notes |
| --- | --- | --- |
| Inbox search, filters, long-press actions | ✅ | |
| Chat thread, call / WhatsApp deep links, copy message | ✅ | |
| Leads trend chart, call / WhatsApp / copy | ✅ | |
| Group capability flags, customer org, Atrium projects | ✅ | |
| Support live SSE feed, cases, escalations | ✅ | |
| Reply to a customer from the phone (human takeover) | 💡 | PA needs a send-message admin endpoint |
| Push on new lead / escalated support case | 💡 | Extend PA watcher |
| CRM pipeline view (deals, stages) | 🧩 | Atrium `/api/crm/*` |

## Atrium work management

| Feature | Status | Notes |
| --- | --- | --- |
| Portal request approvals (billable / fix) | ✅ | |
| Service tickets: status, priority, comments | ✅ | |
| Atrium web with section shortcuts | ✅ | |
| Native issues list / my work / sprint board | 🧩 | Atrium issues API (proxy needed in PA) |
| Timesheet quick log | 🧩 | Atrium `workLogs` |
| Calendar / meetings agenda | 🧩 | Atrium `calendar` |
| Executive dashboard KPIs | 🧩 | Atrium `dashboard` / `analytics` |

## App platform

| Feature | Status | Notes |
| --- | --- | --- |
| New design system (tokens, gradients, sheets, toasts, skeletons, charts) | ✅ | `src/ui/*` |
| 5-tab navigation + More hub | ✅ | |
| Biometric lock with re-lock timeout | ✅ | |
| Haptics (toggleable) | ✅ | |
| Pull-to-refresh, offline-tolerant unlock | ✅ | |
| Offline cache of last feed / chats | 💡 | Persist with MMKV or SQLite |
| Light theme | 💡 | Tokens are centralized in `src/theme.ts` |
| Tablet split-view layout | 💡 | |
| Per-user auth (Atrium SSO) instead of shared admin secret | 💡 | Security upgrade |
