import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { absoluteApiUrl } from '../lib/api';
import { APP_NAME } from '../brand';
import { AtriumMarkSvg } from '../components/AtriumLogo';
import { CodeBlock } from '../components/profile/McpConnectCard';

type Client = 'claude' | 'claude-code' | 'cursor' | 'other';

const CLIENTS: Array<{ id: Client; label: string }> = [
  { id: 'claude', label: 'Claude (web, desktop, mobile)' },
  { id: 'claude-code', label: 'Claude Code' },
  { id: 'cursor', label: 'Cursor / VS Code' },
  { id: 'other', label: 'Other clients' },
];

type Tool = [name: string, what: string];

/** Mirrors server/src/modules/mcp/mcp.tools.ts — keep in step when tools change. */
const TOOL_GROUPS: Array<{ title: string; note: string; write?: boolean; tools: Tool[] }> = [
  {
    title: 'You and your work',
    note: 'Start here.',
    tools: [
      ['whoami', 'The user the connection acts as, the workspace, and whether access is read-only.'],
      ['my_work', 'Open issues assigned to you, with overdue and due-soon items.'],
      ['my_agenda', 'Your calendar events for the next few days.'],
      ['my_allocations', 'Your project allocations (needs resource-allocation access).'],
    ],
  },
  {
    title: 'Projects and issues',
    note: 'Only projects you are a member of.',
    tools: [
      ['list_projects', 'Projects you belong to in the workspace.'],
      ['get_project', 'One project, with its statuses, issue types and priorities.'],
      ['list_project_members', 'People on a project — handy for finding an assignee.'],
      ['list_sprints', 'Planned, active and completed sprints.'],
      ['project_overview', 'Health, completion, overdue work and workload for one project or all of yours.'],
      ['search_issues', 'Free-text or filtered issue search (assignee, status, type, priority, sprint…).'],
      ['jql_search', 'JQL-style queries, e.g. project = APP AND status != Done ORDER BY updated DESC.'],
      ['get_issue', 'Full issue: description, people, dates, estimates, subtasks, links and recent comments.'],
      ['list_work_logs', 'Time logged on an issue.'],
    ],
  },
  {
    title: 'Docs',
    note: 'Only spaces you can open.',
    tools: [
      ['docs_list_spaces', 'Knowledge spaces and your role in each.'],
      ['docs_search', 'Search pages by title, text, label or issue key.'],
      ['docs_get_page', 'Read a page as text, with linked issues, projects and child pages.'],
      ['docs_for_issue', 'Specs, notes and designs linked to an issue or mentioning its key.'],
    ],
  },
  {
    title: `The rest of ${APP_NAME}`,
    note: 'CRM, HR, billing, accounts, service desk, assets, procurement, contracts, calendar, monitor, resources…',
    tools: [
      ['api_areas', 'The areas your role can use, with how many endpoints each has.'],
      ['api_endpoints', 'Endpoints you may call, filtered by area or a word in the path.'],
      ['api_request', `Call one of those endpoints as you. ${APP_NAME} re-checks your permissions on every call.`],
    ],
  },
  {
    title: 'Changes',
    note: 'Hidden when access is read-only.',
    write: true,
    tools: [
      ['create_issue', 'Create an issue using the project’s own types, priorities and statuses.'],
      ['update_issue', 'Change status, assignee, priority, title, description, labels, dates or estimate.'],
      ['add_comment', 'Comment on an issue as you.'],
      ['log_work', 'Log time on an issue.'],
      ['docs_create_page', 'Create a page (a draft unless asked to publish). Markdown is fine.'],
      ['docs_update_page', 'Replace or append to a page; the previous version stays in history.'],
    ],
  },
];

const PROMPTS = [
  'What’s assigned to me that’s overdue or due this week?',
  'Summarise the health of project APP and who is overloaded.',
  'Find every open bug in APP about login and group them by cause.',
  'Read the spec linked to APP-42 and list what is still missing from the issue.',
  'Create a task in APP for the export bug, assign it to me, priority High.',
  'Which deals in the CRM are expected to close this month?',
];

const SECTIONS = [
  ['access', 'What the assistant can access'],
  ['connect', 'Connect'],
  ['tools', 'Tools'],
  ['prompts', 'Things to ask'],
  ['manage', 'Manage and disconnect'],
  ['troubleshooting', 'Troubleshooting'],
  ['admins', 'For administrators'],
  ['reference', 'Technical reference'],
] as const;

function H2({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <h2 id={id} className="scroll-mt-24 text-xl font-semibold text-[color:var(--text-primary)]">
      <a href={`#${id}`} className="hover:underline">
        {children}
      </a>
    </h2>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-[color:var(--bg-surface)] px-1.5 py-0.5 text-[12px] text-[color:var(--text-primary)]">{children}</code>;
}

function Steps({ items }: { items: React.ReactNode[] }) {
  return (
    <ol className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex gap-3 text-sm text-[color:var(--text-primary)]">
          <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[color:var(--accent)]/15 text-[11px] font-semibold text-[color:var(--accent)]">{i + 1}</span>
          <span className="min-w-0">{it}</span>
        </li>
      ))}
    </ol>
  );
}

/**
 * Public guide (no sign-in) to connecting AI assistants to Atrium over MCP. URLs are this site's own,
 * so the page is correct for whichever installation serves it.
 */
export default function McpDocs() {
  const url = useMemo(() => absoluteApiUrl('/mcp'), []);
  const origin = useMemo(() => new URL(url).origin, [url]);
  const [client, setClient] = useState<Client>('claude');

  useEffect(() => {
    document.title = `Connect AI assistants (MCP) · ${APP_NAME}`;
  }, []);

  const connect: Record<Client, { code: string; steps: React.ReactNode[] }> = {
    claude: {
      code: `Name: ${APP_NAME}\nRemote MCP server URL: ${url}`,
      steps: [
        <>In Claude, open <strong>Settings → Connectors</strong> and choose <strong>Add custom connector</strong>.</>,
        <>Enter the name and URL above. Leave the OAuth Client ID and secret empty — Claude registers itself.</>,
        <>Click <strong>Connect</strong>. {APP_NAME} opens; sign in, choose the workspace, read-only or full access and how long access lasts, then <strong>Allow</strong>.</>,
        <>The connector now works in Claude on the web, the desktop app and mobile. On Team and Enterprise plans an owner adds it once under <strong>Organization settings → Connectors</strong>, then each member connects their own account.</>,
      ],
    },
    'claude-code': {
      code: `claude mcp add --transport http atrium ${url} --scope user`,
      steps: [
        <>Run the command in a terminal. <Code>--scope user</Code> makes it available in every project; drop it to add it to the current project only.</>,
        <>Start Claude Code, type <Code>/mcp</Code>, select <strong>atrium</strong> and choose <strong>Authenticate</strong>.</>,
        <>A browser tab opens on {APP_NAME}. Approve, and return to the terminal.</>,
        <>No browser available (CI, servers)? Create a token under <strong>Profile → API tokens</strong> and add <Code>--header "Authorization: Bearer atr_…"</Code> to the command instead.</>,
      ],
    },
    cursor: {
      code: JSON.stringify({ mcpServers: { atrium: { url } } }, null, 2),
      steps: [
        <>Cursor: add this to <Code>~/.cursor/mcp.json</Code> (or <Code>.cursor/mcp.json</Code> in a project).</>,
        <>VS Code: add it to <Code>.vscode/mcp.json</Code>, using <Code>"servers"</Code> instead of <Code>"mcpServers"</Code> and adding <Code>"type": "http"</Code>.</>,
        <>The editor asks you to sign in the first time a tool is used; approve in {APP_NAME}.</>,
        <>To use a token instead, add <Code>"headers": {'{'} "Authorization": "Bearer atr_…" {'}'}</Code>.</>,
      ],
    },
    other: {
      code: `Endpoint:   ${url}\nTransport:  Streamable HTTP (POST, stateless, JSON responses)\nAuth:       OAuth 2.1 with PKCE, discovered from the 401 response\n            or header  Authorization: Bearer atr_…`,
      steps: [
        <>Any MCP client that supports remote (Streamable HTTP) servers can connect.</>,
        <>Clients with OAuth support discover sign-in automatically from the server’s <Code>WWW-Authenticate</Code> header.</>,
        <>Clients without OAuth can send a personal API token as a bearer header.</>,
        <>Clients that only run local (stdio) servers can bridge with <Code>npx -y mcp-remote {url}</Code>.</>,
      ],
    },
  };

  return (
    <div className="min-h-screen bg-[color:var(--bg-page)] text-[color:var(--text-primary)]">
      <header className="sticky top-0 z-10 border-b border-[color:var(--border-subtle)] bg-[color:var(--bg-page)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <AtriumMarkSvg className="h-7 w-7" />
            <span>{APP_NAME}</span>
            <span className="hidden text-sm font-normal text-[color:var(--text-muted)] sm:inline">· Developers</span>
          </Link>
          <Link to="/profile" className="btn-primary rounded-lg px-3 py-1.5 text-sm">
            Open {APP_NAME}
          </Link>
        </div>
      </header>

      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-10 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav className="hidden lg:block">
          <ul className="sticky top-20 space-y-1 text-sm">
            {SECTIONS.map(([id, label]) => (
              <li key={id}>
                <a href={`#${id}`} className="block rounded-md px-2 py-1 text-[color:var(--text-muted)] hover:bg-[color:var(--bg-surface)] hover:text-[color:var(--text-primary)]">
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <main className="min-w-0 space-y-14">
          <section className="space-y-4">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-[color:var(--accent)]">Model Context Protocol</p>
            <h1 className="text-3xl font-bold leading-tight sm:text-4xl">Use {APP_NAME} from Claude and other AI assistants</h1>
            <p className="max-w-2xl text-[15px] leading-relaxed text-[color:var(--text-muted)]">
              Connect Claude, Claude Code, Cursor or any MCP client to {APP_NAME}. Ask about your work, search issues and docs, check project health, look things up
              across the CRM, HR and billing — and, if you allow it, create issues, comment, log time and write docs. The assistant works as you, with exactly your
              permissions.
            </p>
            <div className="max-w-2xl space-y-1.5">
              <p className="text-xs font-medium text-[color:var(--text-muted)]">Your server URL</p>
              <CodeBlock code={url} />
            </div>
          </section>

          <section className="space-y-4">
            <H2 id="access">What the assistant can access</H2>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Only what you can see', `Every request runs as you. Projects you’re not a member of, doc spaces you can’t open and modules your role doesn’t include stay invisible — ${APP_NAME} checks each call, not the assistant.`],
                ['Read-only if you want', 'Choose read-only when you connect and the assistant can look things up but never create, change or delete anything — write tools aren’t even offered to it.'],
                ['You approve each assistant', `Connecting opens ${APP_NAME}, shows which app is asking and where access goes, and waits for you to click Allow. Access expires after 30, 90 or 365 days.`],
                ['Some areas are always off', 'API tokens, sign-in and password flows, internal service endpoints, the customer portal and incoming webhooks can never be reached by an assistant.'],
              ].map(([t, d]) => (
                <div key={t} className="rounded-xl border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-4">
                  <p className="text-sm font-semibold">{t}</p>
                  <p className="mt-1 text-sm leading-relaxed text-[color:var(--text-muted)]">{d}</p>
                </div>
              ))}
            </div>
            <p className="text-sm text-[color:var(--text-muted)]">
              Assistants are told to ask before changing data, but they can make mistakes. Use read-only access when you only need answers, and review what an
              assistant proposes before it acts.
            </p>
          </section>

          <section className="space-y-4">
            <H2 id="connect">Connect</H2>
            <div className="flex flex-wrap gap-1 rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] p-1">
              {CLIENTS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClient(c.id)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium transition sm:text-sm ${client === c.id ? 'bg-[color:var(--bg-page)] text-[color:var(--text-primary)] shadow-sm' : 'text-[color:var(--text-muted)] hover:text-[color:var(--text-primary)]'}`}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <CodeBlock code={connect[client].code} />
            <Steps items={connect[client].steps} />
          </section>

          <section className="space-y-5">
            <H2 id="tools">Tools</H2>
            <p className="text-sm text-[color:var(--text-muted)]">
              You don’t call these yourself — the assistant picks them. They’re listed so you know what it can do. Refer to projects by key (<Code>APP</Code>) and
              issues by key (<Code>APP-12</Code>).
            </p>
            {TOOL_GROUPS.map((g) => (
              <div key={g.title} className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)]">
                <div className="flex flex-wrap items-baseline justify-between gap-2 bg-[color:var(--bg-surface)] px-4 py-2.5">
                  <p className="text-sm font-semibold">
                    {g.title}
                    {g.write && <span className="ml-2 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-amber-600">writes</span>}
                  </p>
                  <p className="text-xs text-[color:var(--text-muted)]">{g.note}</p>
                </div>
                <ul className="divide-y divide-[color:var(--border-subtle)]">
                  {g.tools.map(([name, what]) => (
                    <li key={name} className="grid gap-1 px-4 py-2.5 text-sm sm:grid-cols-[180px_minmax(0,1fr)] sm:gap-4">
                      <code className="text-[12px] font-medium text-[color:var(--accent)]">{name}</code>
                      <span className="text-[color:var(--text-muted)]">{what}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </section>

          <section className="space-y-4">
            <H2 id="prompts">Things to ask</H2>
            <div className="grid gap-2 sm:grid-cols-2">
              {PROMPTS.map((p) => (
                <p key={p} className="rounded-lg border border-[color:var(--border-subtle)] bg-[color:var(--bg-surface)] px-3 py-2.5 text-sm">
                  “{p}”
                </p>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <H2 id="manage">Manage and disconnect</H2>
            <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed">
              <li>
                Every connected assistant appears under <strong>Profile → API tokens</strong> with an <em>AI assistant</em> badge, its expiry and when it was last used.
              </li>
              <li>
                <strong>Revoke</strong> it there to cut access immediately. Reconnecting the same app replaces its old access rather than adding another.
              </li>
              <li>Access belongs to one workspace. To use another, connect again and pick that workspace on the approval screen.</li>
              <li>When access expires, the assistant asks you to sign in again.</li>
            </ul>
          </section>

          <section className="space-y-3">
            <H2 id="troubleshooting">Troubleshooting</H2>
            <dl className="divide-y divide-[color:var(--border-subtle)] rounded-xl border border-[color:var(--border-subtle)]">
              {[
                ['“Couldn’t register with … sign-in service”', <>The server isn’t answering MCP sign-in. Opening <Code>{origin}/.well-known/oauth-authorization-server</Code> should show JSON — if it shows a web page or 404, ask your administrator (see below). Then remove the connector and add it again.</>],
                ['Claude can’t reach the server', <>Claude on the web, desktop and mobile connects from the internet, so the URL must be public HTTPS — <Code>localhost</Code> only works for Claude Code and editors on the same machine.</>],
                ['Signed in, but tools say 401', 'The access was revoked or has expired. Reconnect (Claude: Settings → Connectors → Connect; Claude Code: /mcp → Authenticate).'],
                ['“This token is read-only”', 'You chose read-only when connecting. Reconnect and leave read-only unticked to allow changes.'],
                ['A project or record is missing', `The assistant sees what you see. Check you’re a member of the project or have the role for that module in ${APP_NAME}, and that the right workspace was chosen.`],
              ].map(([q, a], i) => (
                <div key={i} className="px-4 py-3">
                  <dt className="text-sm font-semibold">{q}</dt>
                  <dd className="mt-1 text-sm leading-relaxed text-[color:var(--text-muted)]">{a}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="space-y-3">
            <H2 id="admins">For administrators</H2>
            <p className="text-sm text-[color:var(--text-muted)]">Self-hosted installations need the API reachable over HTTPS and the sign-in discovery documents proxied.</p>
            <Steps
              items={[
                <>
                  Set the public address in the API’s <Code>.env</Code> and restart: <Code>MCP_PUBLIC_URL={url}</Code>. Without it the address is taken from the
                  proxy’s <Code>Host</Code> and <Code>X-Forwarded-Proto</Code> headers, so make sure your proxy sends both.
                </>,
                <>
                  <Code>APP_URL</Code> must be the web app’s address — the approval screen opens there.
                </>,
                <>Proxy the discovery documents at the site root to the API, next to the existing <Code>/api/</Code> location:</>,
              ]}
            />
            <CodeBlock
              code={`location ~ ^/\\.well-known/(oauth-authorization-server|oauth-protected-resource|openid-configuration) {\n  proxy_pass http://127.0.0.1:5000;\n  proxy_set_header Host $host;\n  proxy_set_header X-Forwarded-Proto $scheme;\n}`}
            />
            <p className="text-sm text-[color:var(--text-muted)]">Check it:</p>
            <CodeBlock
              code={`curl -i -X POST ${url} -H 'Content-Type: application/json' -d '{}'\n# → 401 with  WWW-Authenticate: Bearer resource_metadata="…"\n\ncurl ${origin}/.well-known/oauth-authorization-server\n# → JSON with "issuer": "${url}"`}
            />
          </section>

          <section className="space-y-3">
            <H2 id="reference">Technical reference</H2>
            <div className="overflow-hidden rounded-xl border border-[color:var(--border-subtle)]">
              {[
                ['MCP endpoint', `POST ${url}`],
                ['Transport', 'Streamable HTTP, stateless (no sessions), JSON responses; GET/DELETE return 405'],
                ['Authentication', 'Authorization: Bearer atr_… (from OAuth or Profile → API tokens)'],
                ['Protected resource metadata', `${url}/.well-known/oauth-protected-resource (RFC 9728)`],
                ['Authorization server', `issuer ${url} · metadata at ${origin}/.well-known/oauth-authorization-server/api/mcp`],
                ['Client registration', `POST ${url}/oauth/register (RFC 7591, public clients only)`],
                ['Authorize / token', `${url}/oauth/authorize · ${url}/oauth/token`],
                ['Grant', 'authorization_code with PKCE S256; codes last 10 minutes and work once; no refresh tokens'],
                ['Redirect URIs', 'https, http://localhost (any port) or an app’s own scheme'],
              ].map(([k, v]) => (
                <div key={k} className="grid gap-1 border-b border-[color:var(--border-subtle)] px-4 py-2.5 text-sm last:border-b-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
                  <span className="font-medium">{k}</span>
                  <span className="break-words font-mono text-[12px] text-[color:var(--text-muted)]">{v}</span>
                </div>
              ))}
            </div>
          </section>

          <footer className="border-t border-[color:var(--border-subtle)] pt-6 text-xs text-[color:var(--text-muted)]">
            {APP_NAME} · <Link to="/profile" className="hover:underline">Profile → API tokens</Link> to manage connected assistants.
          </footer>
        </main>
      </div>
    </div>
  );
}
