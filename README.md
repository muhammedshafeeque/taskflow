# Atrium

**Modular work hub for delivery, sales, finance, people, and operations.**

Atrium is a multi-tenant business platform: one login, one workspace, many modules. Enable what you need (Project Management, CRM, Billing, HRMS, Assets, Service Desk, and more), brand it with your company name and logo, and manage access with fine-grained roles and permissions.

> The repository folder is still named `Tasks` / `taskflow` in places for historical compatibility. The **user-facing product name is Atrium**.

| | |
|---|---|
| **Frontend** | React 19 · Vite 7 · TypeScript · Tailwind CSS 4 · React Router 7 |
| **Backend** | Node.js · Express · TypeScript · MongoDB (Mongoose) |
| **Realtime** | Socket.IO · Web Push |
| **Auth** | JWT · email/password · Microsoft & Google OAuth |
| **License** | [GPL-3.0](LICENSE) |

---

## Table of contents

1. [Why Atrium](#why-atrium)
2. [Modules](#modules)
3. [Feature guide](#feature-guide)
4. [Architecture](#architecture)
5. [Prerequisites](#prerequisites)
6. [Quick start](#quick-start)
7. [Environment configuration](#environment-configuration)
8. [Scripts](#scripts)
9. [Project structure](#project-structure)
10. [API overview](#api-overview)
11. [Permissions & module access](#permissions--module-access)
12. [Production](#production)
13. [Testing & quality](#testing--quality)
14. [Contributing](#contributing)
15. [License](#license)

---

## Why Atrium

- **Modular** — turn modules on/off for the whole platform from Core → Modules.
- **Multi-tenant** — organizations (workspaces) with company branding and base currency.
- **Permission-first** — hub tiles and APIs respect both module enablement and user permissions.
- **Delivery-ready PM** — issues, sprints, boards, QA, timesheets, and reports in one place.
- **CRM through close** — deals, quotations (PDF + email), and contracts.
- **Fast local setup** — MongoDB + two `npm run dev` processes.

---

## Modules

| ID | Module | Role |
|----|--------|------|
| `core` | **Core** | Company profile, currencies, exchange rates, platform module toggles *(always on)* |
| `auth` | **Auth** | Users, roles, permission assignment *(always on)* |
| `inbox` | **Inbox** | In-app notifications |
| `pm` | **Project Manager** | Projects, issues, boards, sprints, QA, reports, timesheets |
| `crm` | **CRM** | Leads, accounts, contacts, deals, quotes, activities, CRM contracts |
| `contracts` | **Contracts** | Contract lifecycle |
| `billing` | **Billing** | Tax rules, subscriptions, invoices |
| `accounts` | **Accounts** | Finance / accounts workflows |
| `hrms` | **HRMS** | Leave, attendance, people ops |
| `resources` | **Resources** | Resource allocation |
| `assets` | **Assets** | Asset registry |
| `procurement` | **Procurement** | Vendors, purchase orders |
| `service` | **Service Desk** | Tickets & SLA |
| `mail` | **Mail** | Mailbox sync / CRM mail |
| `calendar` | **Calendar** | Events |
| `documents` | **Documents** | Document records |
| `portal-admin` | **Portal admin** | Customer organization administration |
| — | **Customer Portal** | External customer login & request tracking |

Always-on: **Core**, **Auth**. Other modules are toggleable; disabled modules hide hub tiles and reject module API routes.

---

## Feature guide

### Core

- Company name, legal name, logo, address, website, tax ID, timezone, notes
- Base currency (used as default on new CRM quotations)
- Global currency catalog (activate/deactivate)
- Day-wise exchange rates (ROE) with search, filters, pagination
- Platform-wide enable/disable for product modules

### Auth & access

- Users and system roles
- Permission catalog grouped by module / resource
- Dedicated pages: user permissions, role permissions
- JWT sessions; optional Microsoft and Google OAuth
- Optional public signup (`IS_PUBLIC_SIGNUP_ENABLED`)

### Project Manager (PM)

| Area | Capabilities |
|------|----------------|
| **Work items** | Issues & subtasks (task, bug, story, epic), custom fields, labels, checklists |
| **Planning** | Backlog, sprints, velocity-oriented workflows |
| **Boards** | Drag-and-drop Kanban |
| **Timeline** | Gantt, roadmaps, milestones, versions / releases |
| **Views** | List, table, Kanban; saved & quick filters |
| **Collaboration** | TipTap comments, mentions, watchers, attachments, issue links |
| **Time** | Work logs, team timesheet, exports |
| **QA** | Test cases, plans, cycles; pass/fail/skip/blocked; defect metrics; traceability |
| **Reporting** | Personal / project / executive dashboards; custom, performance, cost, sprint, workload reports |
| **Admin** | Project templates, field schemes, audit logs, Azure DevOps sync / import |

### CRM

- Leads, accounts, contacts, deals (pipelines), activities
- **Quotations**: full-page create/edit, line items (hourly / fixed / milestone), tax, discounts
- Searchable currency picker (Core catalog); defaults to company base currency
- Quote list: filters (title, deal, status, customer) with Search / Clear, paginated table
- Quote detail: PDF download, email send (optional PDF attachment), accept / reject
- Contracts from accepted commercial flow

### Billing & ops modules

- Billing tax rules power quote tax defaults
- HRMS, assets, procurement, service desk, mail, calendar, documents — module shells gated by enablement + permissions

### Customer portal

- Separate customer auth and request lifecycle
- Portal admin manages customer orgs (when `portal-admin` is enabled)

---

## Architecture

```text
Browser (Vite / React)
    │  REST + JWT + X-Organization-Id
    │  Socket.IO (inbox / live updates)
    ▼
Express API (server/)
    ├── auth, users, roles, organizations
    ├── core (company, currencies, ROE, modules)
    ├── pm routes (projects, issues, boards, …)  ← requireModuleEnabled('pm')
    ├── crm, billing, hrms, …                    ← per-module gate
    └── customer/* portal routes
    ▼
MongoDB
```

- **Frontend** lives in `Tasks/` (React app).
- **Backend** lives in `server/`.
- Active workspace is sent as `X-Organization-Id` on API calls.
- Company display name/logo come from the active organization (synced with Core company settings).

---

## Prerequisites

- **Node.js** 18 or newer
- **MongoDB** 6+ (local or Atlas)
- **npm** (or pnpm/yarn)

---

## Quick start

### 1. Clone

```bash
git clone https://github.com/muhammedshafeeque/taskflow.git
cd taskflow
```

### 2. Backend

```bash
cd server
npm install
cp .env.example .env
# Edit .env — at least MONGODB_URI and JWT_SECRET
```

### 3. Frontend

```bash
cd ../Tasks
npm install
cp .env.example .env   # optional; defaults target local API
```

`Tasks/.env.example`:

```env
VITE_API_URL=http://localhost:5000/api
VITE_WS_URL=http://localhost:5000
```

> If your API uses another port, match `VITE_API_URL` / `VITE_WS_URL` to `server` `PORT`.

### 4. Seed & admin

```bash
cd ../server
npm run create-super-admin
npm run seed-taskflow-roles
npm run seed-currencies
```

| Script | Purpose |
|--------|---------|
| `create-super-admin` | First platform admin (prompts, or use `SUPER_ADMIN_*` env vars) |
| `seed-taskflow-roles` | System roles + permission catalogs |
| `seed-currencies` | Global currency list for Core |

Optional:

```bash
npm run seed-org-customer-roles   # customer portal roles
```

### 5. Run

**Terminal 1 — API**

```bash
cd server
npm run dev
```

**Terminal 2 — UI**

```bash
cd Tasks
npm run dev
```

Open **http://localhost:5173**, sign in, then:

1. **Core → Company** — set company name, logo, base currency  
2. **Core → Modules** — enable CRM / Billing / etc. as needed  
3. **Auth → Users / Roles** — invite people and assign permissions  

Health check: `GET http://localhost:5000/api/health`

---

## Environment configuration

### Backend (`server/.env`)

Copy from [`server/.env.example`](server/.env.example). Important groups:

#### Core

| Variable | Description | Typical default |
|----------|-------------|-----------------|
| `PORT` | API listen port | `5000` |
| `NODE_ENV` | `development` / `production` | `development` |
| `MONGODB_URI` | Mongo connection string | `mongodb://localhost:27017/pm-tool` |
| `JWT_SECRET` | Sign access tokens | **required in production** |
| `JWT_EXPIRES_IN` | Token lifetime | `7d` |
| `INTEGRATION_ENCRYPTION_KEY` | Encrypt stored integration secrets | — |
| `IS_PUBLIC_SIGNUP_ENABLED` | Allow self-registration | `false` |
| `IS_EMAIL_PASSWORD_AUTH_ENABLED` | Email/password login | `true` |
| `APP_URL` | App base (emails, redirects) | `http://localhost:5173` |
| `FRONTEND_URL` | SPA origin for invite links | `http://localhost:5173` |
| `MAX_USERS` | Optional user cap | — |

#### Email (pick one primary transport)

| Flag | Transport |
|------|-----------|
| `IS_SMTP_ENABLED` | Nodemailer SMTP (`SMTP_*` / legacy `EMAIL_*`) |
| `IS_AZURE_GRAPH_ENABLED` | Microsoft Graph send mail (`AZURE_GRAPH_*`) |
| `IS_SENDGRID_ENABLED` | SendGrid API |
| `IS_BYTEMAIL_ENABLED` | ByteMail HTTP API (`BYTEMAIL_API_KEY`, optional `BYTEMAIL_API_URL` / `BYTEMAIL_FROM_EMAIL`). Also enables the Email column on Notification preferences. |

If none are enabled, outbound mail is skipped. Priority when several are on: **SMTP → Azure Graph → SendGrid → ByteMail**.

Poste.io-style IMAP/SMTP for CRM mail: `POSTE_IMAP_*`, `POSTE_SMTP_*`, `MAIL_SYNC_INTERVAL_MS`.

#### Auth providers

- Google: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALLBACK_URL`
- Microsoft: `AZURE_AD_*`, `MICROSOFT_CALLBACK_URL`

#### Push

- Web Push: `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`
- Optional Firebase: `IS_FIREBASE_PUSH_ENABLED`, `FIREBASE_*`

#### Integrations (optional)

Telegram, Teams, Slack, Discord, WhatsApp, S3, Azure Blob, SMS (Twilio / Fast2SMS / …), Jira, Azure DevOps, GitHub, and AI providers (OpenAI, Claude, Groq, Mistral) — see `.env.example` for flags and keys.

#### CLI helpers

| Variable | Used by |
|----------|---------|
| `SUPER_ADMIN_EMAIL` / `PASSWORD` / `NAME` | `npm run create-super-admin` |
| `AZURE_DEVOPS_*`, `IMPORT_REPORTER_EMAIL` | `npm run import-ado` |

### Frontend (`Tasks/.env`)

| Variable | Description |
|----------|-------------|
| `VITE_API_URL` | REST base including `/api` |
| `VITE_WS_URL` | Socket.IO origin |

---

## Scripts

### `server/`

| Command | Description |
|---------|-------------|
| `npm run dev` | Dev API with reload (`ts-node-dev`) |
| `npm run build` | Compile TypeScript → `dist/` (runs tests via `prebuild`) |
| `npm start` | Run `node dist/index.js` |
| `npm test` | Jest |
| `npm run test:coverage` | Coverage report |
| `npm run create-super-admin` | Create platform admin |
| `npm run seed-taskflow-roles` | Seed roles / permissions |
| `npm run seed-currencies` | Seed currency catalog |
| `npm run seed-org-customer-roles` | Seed customer-portal roles |
| `npm run accept-invitations` | Invitation helper |
| `npm run migrate-permissions-to-dot` | Legacy permission migration |
| `npm run import-ado` | Import Azure DevOps work items |

### `Tasks/`

| Command | Description |
|---------|-------------|
| `npm run dev` | Vite dev server (default port 5173) |
| `npm run build` | Typecheck + production bundle (`prebuild` runs tests) |
| `npm run preview` | Preview production build |
| `npm run lint` | ESLint |
| `npm test` | Jest |

---

## Project structure

```text
taskflow/                         # repository root
├── README.md
├── CONTRIBUTING.md
├── CONTRIBUTORS.md
├── LICENSE
├── server/                       # API
│   ├── package.json
│   ├── .env.example
│   └── src/
│       ├── index.ts
│       ├── config/
│       ├── middleware/           # auth, permissions, requireModuleEnabled
│       ├── modules/
│       │   ├── core/
│       │   ├── crm/              # quotes, deals, accounts, …
│       │   ├── auth|users|roles|organizations/
│       │   ├── projects|issues|boards|sprints|…
│       │   ├── billing|hrms|assets|procurement|…
│       │   ├── mail|calendar|documents|resources|service-desk/
│       │   └── customer-portal/
│       ├── routes/               # mounts modules under /api
│       ├── scripts/              # seed & CLI
│       ├── services/             # email, etc.
│       └── shared/constants/     # permissions, moduleAccess
│
└── Tasks/                        # SPA
    ├── package.json
    ├── .env.example
    ├── index.html
    ├── public/brand/             # Atrium marks
    └── src/
        ├── brand.ts              # APP_NAME = 'Atrium'
        ├── App.tsx               # routes
        ├── components/
        ├── contexts/             # Auth, Notifications, PlatformModules
        ├── hooks/                # useAppDisplayName, …
        ├── lib/                  # api.ts, quotePdf, dateFormat
        ├── pages/                # Home, PM, crm/, core/, auth, portal, …
        └── utils/                # moduleAccess, permissions
```

---

## API overview

- Base path: `/api`
- Auth: `Authorization: Bearer <token>`
- Workspace: `X-Organization-Id: <orgId>`
- Health: `GET /api/health` → `{ success, data: { status, timestamp } }`

Examples (non-exhaustive):

| Area | Prefix |
|------|--------|
| Auth | `/api/auth` |
| Users / roles | `/api/users`, `/api/roles` |
| Core | `/api/core/company`, `/api/core/currencies`, `/api/core/modules`, … |
| PM | `/api/projects`, `/api/issues`, `/api/boards`, `/api/sprints`, … |
| CRM | `/api/crm/...` (quotes, deals, accounts, …) |
| Billing | `/api/billing/...` |
| Customer portal | `/api/customer/...` |

Module-gated routes return errors when the module is disabled for the platform.

---

## Permissions & module access

Access requires **both**:

1. Module enabled (Core → Modules / platform settings), and  
2. User has at least one matching permission for that module (or is platform `admin`).

Permission strings use dot notation (e.g. `taskflow.crm.quote.create`, `project.project.list`).  
Effective permissions are resolved from the user’s role plus any per-user grants.

Hub home only shows modules the signed-in user can actually open.

---

## Production

```bash
# API
cd server
npm run build
npm start

# UI
cd Tasks
VITE_API_URL=https://api.example.com/api VITE_WS_URL=https://api.example.com npm run build
```

Serve `Tasks/dist` behind Nginx, Caddy, Vercel, Netlify, etc. Point the SPA at your API via `VITE_*` at build time.

Checklist:

- Strong `JWT_SECRET` (and `INTEGRATION_ENCRYPTION_KEY` if using integrations)
- `APP_URL` / `FRONTEND_URL` set to public HTTPS origins
- Email transport configured if you need invites / quote emails
- MongoDB backups and indexes appropriate for load
- CORS / reverse proxy WebSocket support for Socket.IO

---

## Testing & quality

```bash
cd server && npm test
cd Tasks && npm test && npm run lint
```

Builds run tests first (`prebuild`). Prefer extending existing modules and shared helpers (`moduleAccess`, permission catalogs, API client) over parallel implementations.

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for branch naming, PR expectations, and security notes.

Add yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) when you contribute.

---

## License

[GNU General Public License v3.0](LICENSE) (GPL-3.0).

---

**Atrium** — Projects · CRM · HRMS · Billing · Assets · Service
