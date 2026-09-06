# Ivorix PA Control Center (Android)

Expo React Native app for ops on the go. Talks to the same PA admin API as the web Control Center.

## Setup

1. Install deps: `npm install`
2. Optional env (defaults are production hosts):

```bash
# .env
EXPO_PUBLIC_PA_API_URL=https://pa.repod.online
EXPO_PUBLIC_ATRIUM_URL=https://taskflow.repod.online
```

3. Start: `npx expo start` then press `a` for Android emulator, or scan with Expo Go.

## Unlock

Use the same value as `PA_ADMIN_SECRET` on the PA server. API base defaults to `https://pa.repod.online`.

Server nginx must allow underscore headers (`underscores_in_headers on;` in the `http` block) so `x-pa-admin-secret` reaches PA.

## Features

- Dashboard: WhatsApp status, global pause, voice replies, STT language
- Chats: search, pause/resume, thread detail, reset memory
- Groups: auto-reply + Atrium project assignment
- Support: cases + live SSE feed
- Leads: local WhatsApp leads
- Atrium: Taskflow WebView
- Lock: clears SecureStore credentials

## Build APK

With EAS (recommended):

```bash
npm i -g eas-cli
eas login
eas build -p android --profile preview
```

Or locally (needs Android SDK):

```bash
npx expo prebuild -p android
npx expo run:android --variant release
```

Package id: `online.repod.pacontrol`
