# Atrium Workbench

VS Code / Cursor extension for self-hosted Atrium: list and update your issues, then **Do** them with Cursor or Claude.

## Install

```bash
cd extensions/atrium-workbench
npm install
npm run package
```

In Cursor/VS Code: **Extensions → … → Install from VSIX…** → `atrium-workbench-0.1.9.vsix` → Reload.

## How to use (all from the extension)

After install, the extension opens the **Atrium** sidebar and runs **Get Started** once:

1. Enter your Atrium API URL (e.g. `http://localhost:5000`)
2. Choose **Sign in with Browser** or **Sign in with Email**
3. On first use in a workspace folder, pick the Atrium project for that folder (saved to `.atrium/project.json`)
4. **My Issues** shows only issues assigned to you in that project
5. Click an issue → update status / comment → **Do** (one branch choice → Agent starts)

You can also click **Get Started** in the sidebar or status bar anytime.

No Command Palette required for normal use.

## Day-to-day

| In the Atrium sidebar | Action |
|------------------------|--------|
| Click an issue | Open detail panel |
| **Open in Browser** (panel or right-click) | Open the issue in Atrium web |
| **Do** on an open issue | One branch QuickPick → attachments downloaded → Cursor Agent starts automatically |
| Refresh icon | Reload issues |
| `…` menu | Set project for folder, sign out, change org, change URL |

## Folder ↔ project

Each workspace folder can bind to one Atrium project via `.atrium/project.json`. First open prompts you to choose from projects you belong to; later opens reuse that binding. Use **Atrium: Set Project for Folder** (or the `…` menu) to change it.

**Do** downloads **PNG/JPEG** screenshots only into `.atrium/attachments/`, lists them in `.atrium/current-issue.md`, opens Cursor composer as an editor/pane (not the empty Agents Window), pastes the prompt, attaches those images, and **auto-submits**. The extension keeps `.atrium/` in the workspace `.gitignore`. When you mark that issue **Done** / closed in the panel, local Do context (`current-issue.md`, attachments, active meta) is cleared automatically; `project.json` is kept.

## Requirements

- Atrium API running (`POST /api/auth/ide/...` for browser login)
- Web app `/auth/ide` if using browser sign-in
- Open workspace folder (needed for project binding and Do packet file)
- Git workspace for branch create
- Optional: `claude` CLI (used automatically when not in Cursor)

## Privacy

Tokens live in editor **Secret Storage**. Server URL / org id are in settings. Folder project id lives in `.atrium/project.json` in the workspace.
