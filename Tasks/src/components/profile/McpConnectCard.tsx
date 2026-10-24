import { useMemo, useState } from "react";
import { absoluteApiUrl } from "../../lib/api";

type Client = "claude" | "claude-code" | "cursor" | "other";

const CLIENTS: Array<{ id: Client; label: string }> = [
  { id: "claude", label: "Claude (web, desktop, mobile)" },
  { id: "claude-code", label: "Claude Code" },
  { id: "cursor", label: "Cursor / VS Code" },
  { id: "other", label: "Other" },
];

const TOOLS = [
  ['Whole Atrium', 'every module you can open — CRM, HR, billing, accounts, service desk, assets, procurement, contracts, calendar, monitor, resources, projects, docs — through api_areas → api_endpoints → api_request'],
  ['Shortcuts', 'my work & agenda, issue search / JQL / details, comments, work logs, sprints, project health, docs pages; writes are hidden for read-only tokens'],
];

function CodeBlock({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-3 pr-16 text-[12px] leading-relaxed">
        <code>{code}</code>
      </pre>
      <button
        type="button"
        className="absolute right-2 top-2 rounded-md border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-2 py-0.5 text-[11px] text-[color:var(--text-muted)] hover:text-[color:var(--accent)]"
        onClick={() => {
          void navigator.clipboard?.writeText(code);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * How to connect an AI assistant to Atrium over MCP. The assistant signs in through Atrium (OAuth) or uses a
 * pasted personal API token; either way it can only see and do what the token's owner can.
 */
export default function McpConnectCard({ newToken }: { newToken?: string }) {
  const [client, setClient] = useState<Client>("claude");
  const url = useMemo(() => absoluteApiUrl("/mcp"), []);
  const token = newToken || "atr_YOUR_TOKEN";

  // Without a pasted token, clients sign in through Atrium (OAuth) and get a token of their own.
  const header = newToken ? ` \\\n  --header "Authorization: Bearer ${newToken}"` : "";
  const snippet = {
    claude: `Name: Atrium\nRemote MCP server URL: ${url}`,
    "claude-code": `claude mcp add --transport http atrium ${url}${header}`,
    cursor: JSON.stringify(
      {
        mcpServers: {
          atrium: newToken ? { url, headers: { Authorization: `Bearer ${newToken}` } } : { url },
        },
      },
      null,
      2,
    ),
    other: `Endpoint:  ${url}\nTransport: Streamable HTTP (POST, stateless)\nAuth:      OAuth 2.1 sign-in (discovered automatically)\n           or header Authorization: Bearer ${token}`,
  }[client];

  const hint = {
    claude:
      "Settings → Connectors → Add custom connector, paste the URL, then Connect and approve in Atrium. On Team / Enterprise plans an owner adds it under Organization settings → Connectors. It then works in Claude on the web, desktop and mobile.",
    "claude-code": newToken
      ? "Run in a terminal. Add --scope user to use it in every project. Then ask Claude things like “what’s assigned to me in APP?”."
      : "Run in a terminal (add --scope user for every project), then type /mcp in Claude Code and choose Authenticate — a browser opens to approve in Atrium.",
    cursor:
      'Cursor: ~/.cursor/mcp.json. VS Code: .vscode/mcp.json (use "servers" instead of "mcpServers" and add "type": "http"). Without a token header the editor asks you to sign in.',
    other:
      "Any MCP client that supports Streamable HTTP can connect — with OAuth sign-in, or with a token you create above.",
  }[client];

  return (
    <div className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-6 space-y-4">
      <div>
        <h2 className="text-base font-medium text-[color:var(--text-primary)]">
          Connect AI assistants (MCP)
        </h2>
        <p className="mt-1 text-sm text-[color:var(--text-muted)]">
          Let Claude, Claude Code or other MCP clients work with Atrium as you.
          The assistant only sees the projects, issues, docs and resources you
          can see, and only does what your permissions allow. Use a{" "}
          <strong>read-only</strong> token if it should never change anything.
          Connected assistants appear in the token list above; revoke one to cut
          its access at any time.
        </p>
      </div>

      <div className="inline-flex flex-wrap rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-page)] p-0.5">
        {CLIENTS.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => setClient(c.id)}
            className={`rounded-md px-3 py-1 text-xs font-medium transition ${client === c.id ? "bg-[color:var(--bg-elevated)] text-[color:var(--text-primary)] shadow-sm" : "text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]"}`}
          >
            {c.label}
          </button>
        ))}
      </div>

      <CodeBlock code={snippet} />
      <p className="text-xs text-[color:var(--text-muted)]">{hint}</p>
      {!newToken && client !== "claude" && (
        <p className="text-xs text-[color:var(--text-muted)]">
          Prefer a fixed token (scripts, CI, no browser)? Create one above — it is filled in here once.
        </p>
      )}

      <div className="grid gap-2 sm:grid-cols-2">
        {TOOLS.map(([k, v]) => (
          <div
            key={k}
            className="rounded-lg bg-[color:var(--bg-page)] px-3 py-2"
          >
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--text-muted)]">
              {k} tools
            </p>
            <p className="mt-0.5 text-xs text-[color:var(--text-primary)]">
              {v}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
