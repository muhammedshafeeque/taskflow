# PA CLI (remote PC agent)

## Install

```bash
cd ivx-cli && npm install && npm run build
npm link   # optional: puts `ivx` on PATH
```

## Pair + run

1. In Control Center mobile **Agent** tab, create a pairing code.
2. On the PC:

```bash
ivx login https://pa.example.com   # or your PA URL
ivx pair ABCD1234 --name "dev-laptop"
ivx workspace add --project APP --path /abs/path/to/repo
ivx allow-command add "./scripts/deploy.sh"
ivx allow-command add "npm test"
ivx ai doctor
ivx agent run
```

Keep `ivx agent run` running (or under systemd / Task Scheduler). Jobs from mobile are claimed via long-poll.

## Security

- Only exact `allowCommands` strings run for `run_command` / `deploy`.
- Workspace paths must be absolute; `..` rejected.
- Deploy only runs after mobile **Approve deploy**.
