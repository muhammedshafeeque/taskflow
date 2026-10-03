# Ivorix PA Control (Mobile) · v2

Expo React Native app for running PA + Atrium ops from your phone. Talks to the PA admin API; PA proxies Atrium (Taskflow) — including **Atrium Monitor** — so the phone only ever needs the PA admin secret.

## Setup

1. Install deps: `npm install`
2. Optional env (defaults are production hosts):

```bash
# .env
EXPO_PUBLIC_PA_API_URL=https://pa.repod.online
EXPO_PUBLIC_ATRIUM_URL=https://taskflow.repod.online
```

3. New native modules were added in v2 (notifications, biometrics, audio, background tasks), so **Expo Go is not enough** — rebuild the dev client:

```bash
npx expo prebuild -p android --clean
npx expo run:android
```

### Server requirements (PA)

| Need | Where |
| --- | --- |
| `PA_ADMIN_SECRET` | PA `.env` — same value you type on the unlock screen |
| `TASKFLOW_API_TOKEN` (or `TASKFLOW_EMAIL` + `TASKFLOW_PASSWORD`) for a user with **Monitor read / alert manage** permissions | PA `.env` |
| `MONITOR_WATCH_INTERVAL_SEC` (default 60) | PA `.env` — how often PA checks Atrium for new alerts to push |
| `underscores_in_headers on;` | nginx `http` block, so `x-pa-admin-secret` reaches PA |

### Remote push (optional but recommended)

Remote push works even when the app is closed. It needs a real EAS project:

```bash
npm i -g eas-cli && eas login
eas init            # writes a UUID into app.json → extra.eas.projectId
```

Then open **Settings → Register device** in the app. Without it, the app falls back to in-app polling plus background polling (about every 15 min, OS-scheduled).

## Navigation

`Home · Inbox · Monitor · Alerts · More` — everything else (Groups, Support, Leads, Requests, Agent, Atrium web, Settings) lives under **More**, with the tab bar still visible.

## Features

- **Home**: live system health hero, quick actions, pulse KPIs (chats, errors, live users, alerts, approvals, agent reviews), service heartbeats, latest alerts, bot controls
- **Monitor (Atrium)**: per-project overview, web vitals, and tabs for errors (resolve/reopen, stack trace, copy/share), uptime (heartbeat bar, latency sparkline, add/delete checks), logs (level filter, search, expandable meta), HTTP (4xx/5xx), performance (p95 per transaction), live users, and releases
- **Alerts**: a unified inbox (rule deliveries, open errors, outages) with severity and source filters and unread tracking; full alert-rule CRUD with all 9 trigger types and their conditions, enable toggle, and send-test; delivery history
- **Notifications**: server push from PA (new deliveries, new errors, outage plus recovery), background polling fallback, in-app toasts. Tapping a notification deep-links to the error or alert. Configurable kinds, critical-only, and refresh interval.
- **Ask PA**: chat with the PA ops assistant; hold-to-talk voice (Whisper), optional spoken replies (TTS)
- **Inbox**: debounced search, filters (active / paused / leads), avatars, long-press quick actions; chat thread with call / WhatsApp deep links and copy message
- **Groups**: collapsible cards, auto-reply toggle, customer org, capability flags, Atrium projects
- **Support**: live SSE feed, open/closed cases, escalation KPIs
- **Requests**: approval sheet (billable / fix), ticket status, priority, and comments
- **Agent**: job filters, review banner, fix or run-command jobs, live logs, approve deploy, follow-up, pairing with copyable command, revoke
- **Leads**: 14-day trend, search, call / WhatsApp / open chat / copy
- **Atrium web**: section shortcuts, progress bar, back/forward/home, open in browser
- **Security & UX**: biometric lock with re-lock timeout, haptics, skeleton loaders, pull-to-refresh everywhere

See [FEATURES.md](./FEATURES.md) for the full catalogue of integrated and candidate advanced features.

## Build APK

```bash
eas build -p android --profile preview
# or locally
npx expo prebuild -p android && npx expo run:android --variant release
```

Package id: `online.repod.pacontrol`
