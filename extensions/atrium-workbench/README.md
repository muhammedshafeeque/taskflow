# Atrium Workbench

VS Code / Cursor extension for self-hosted Atrium: list and update your issues, then **Do** them with Cursor or Claude.

## Install

```bash
cd extensions/atrium-workbench
npm install
npm run package
```

In Cursor/VS Code: **Extensions → … → Install from VSIX…** → `atrium-workbench-0.1.1.vsix` → Reload.

## How to use (all from the extension)

After install, the extension opens the **Atrium** sidebar and runs **Get Started** once:

1. Enter your Atrium API URL (e.g. `http://localhost:5000`)
2. Choose **Sign in with Browser** or **Sign in with Email**
3. Your issues appear under **My Issues**
4. Click an issue → update status / comment → **Do** (branch + AI)

You can also click **Get Started** in the sidebar or status bar anytime.

No Command Palette required for normal use.

## Day-to-day

| In the Atrium sidebar | Action |
|------------------------|--------|
| Click an issue | Open detail panel |
| **Do** on an open issue | Branch (default = ticket key) → Cursor / Claude / Copy prompt |
| Refresh icon | Reload issues |
| `…` menu | Sign out, change org, change URL |

## Requirements

- Atrium API running (`POST /api/auth/ide/...` for browser login)
- Web app `/auth/ide` if using browser sign-in
- Git workspace for branch create
- Optional: `claude` CLI for **Do with Claude**

## Privacy

Tokens live in editor **Secret Storage**. Server URL / org id are in settings.
