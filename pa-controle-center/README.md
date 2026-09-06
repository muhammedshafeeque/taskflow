# Ivorix PA Control Center

Manual ops UI for the WhatsApp PA bot (`../PA`), with embedded Atrium.

## Run

1. Start PA (`cd ../PA && npm run dev`) with `PA_ADMIN_SECRET` set.
2. Start Atrium frontend (`cd ../Tasks && npm run dev`) on port 5173.
3. Copy the admin secret into `pa-controle-center/.env` as `VITE_PA_ADMIN_SECRET`.
4. `npm run dev` — http://localhost:5174 (proxies `/api` → PA `:3000`).

## Features

- Global bot pause / resume
- WhatsApp voice-note replies on/off + STT language
- Per-chat pause / resume auto-reply
- WhatsApp **Groups**: enable support auto-reply (@mention), assign Atrium project
- Chat memory reset
- Local WhatsApp leads list
- **Atrium:** full Taskflow UI embedded (sign in inside the iframe)

## Env

```
VITE_PA_API_URL=
VITE_PA_ADMIN_SECRET=
VITE_ATRIUM_URL=http://localhost:5173
```
