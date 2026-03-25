<p align="center">
  <img src="https://img.shields.io/badge/TaskFlow-Project%20Management-6366f1?style=for-the-badge&logo=trello&logoColor=white" alt="TaskFlow" />
</p>

<h1 align="center">TaskFlow</h1>
<p align="center">
  <strong>A modern, Jira-like project management platform</strong>
</p>
<p align="center">
  Plan, track, and ship software with ease. Built for teams.
</p>

---

## ✨ Overview

**TaskFlow** is a full-featured project management application built for development teams. Create issues, manage sprints, visualize work on boards, track time, and collaborate—all in one place. Supports dark mode, real-time notifications, and role-based permissions.

---

## 🚀 Features

### Core

| Feature | Description |
|---------|-------------|
| **Issues** | Create and manage tasks, bugs, stories, and epics with custom fields, labels, and checklists |
| **Kanban Boards** | Drag-and-drop boards for sprint and backlog management |
| **Sprints** | Plan, start, and complete sprints with velocity tracking |
| **Backlog** | Prioritize and groom your backlog with drag-and-drop |
| **Gantt** | Visual timeline with Gantt charts |
| **Roadmap** | Milestone-based roadmaps and planning |

### Collaboration

| Feature | Description |
|---------|-------------|
| **Comments** | Discuss issues with rich text (Markdown, tables, images) |
| **Watchers** | Watch issues and get notified of updates |
| **Issue Links** | Link related issues (blocks, duplicates, etc.) |
| **Attachments** | Upload files to issues |
| **Work Logs** | Log time spent on issues with Jira-style time tracking |

### Project Management

| Feature | Description |
|---------|-------------|
| **Versions** | Version management with release rules and environments |
| **Milestones** | Track project milestones and due dates |
| **Custom Fields** | Define project-specific custom fields |
| **Project Templates** | Start from templates for common project types |
| **Permissions** | Global and project-scoped role-based permissions |

### QA & Test Management

| Feature | Description |
|---------|-------------|
| **Test Cases** | Create and manage test cases linked to issues |
| **Test Plans** | Organize test cases into plans |
| **Test Cycles** | Run test cycles and record pass/fail/skip results |
| **Traceability** | Trace requirements to test cases |
| **Defect Metrics** | Bug density, status, and priority analytics |

### Analytics & Reporting

| Feature | Description |
|---------|-------------|
| **Dashboard** | Personal dashboard with issue stats and recent activity |
| **Workload** | View issues and story points per assignee |
| **Portfolio** | Overview of all projects and progress |
| **Executive Dashboard** | High-level stats for admins |
| **Usage Analytics** | Daily active users, actions by type, top users |
| **Custom Reports** | Create and save reports (issues by status, workload, defects) |
| **Cost/Usage Reports** | Work log totals by project and user |
| **Defect Metrics** | Bug analytics by status and priority |

### Enterprise

| Feature | Description |
|---------|-------------|
| **Audit Logs** | Track who did what and when |
| **Licensing** | Optional user limit enforcement |
| **Web Push** | Browser push notifications for assignments and updates |
| **Inbox** | In-app notifications for invitations and mentions |

---

## 🛠 Tech Stack

| Layer | Technologies |
|-------|--------------|
| **Backend** | Node.js, Express, TypeScript, Mongoose (MongoDB) |
| **Frontend** | React 19, Vite 7, TypeScript, React Router 7 |
| **Styling** | Tailwind CSS 4 |
| **Auth** | JWT (access + refresh), bcryptjs |
| **Real-time** | Socket.IO |
| **Rich Text** | TipTap (tables, images, Markdown) |
| **Charts** | Recharts |
| **Other** | @dnd-kit (drag-and-drop), frappe-gantt, jspdf, exceljs, web-push |

---

## 📋 Prerequisites

- **Node.js** 18+ 
- **MongoDB** 6+ (local or Atlas)
- **npm** or **pnpm**

---

## ⚡ Quick Start

### 1. Clone the repository

```bash
git clone <repository-url>
cd Tasks
```

### 2. Install dependencies

```bash
# Backend
cd server && npm install

# Frontend (from project root)
cd ../Tasks && npm install
```

### 3. Configure environment

Create a `.env` file in the `server` directory:

```bash
cd server
cp .env.example .env
```

Edit `.env` with your settings:

```env
PORT=5000
NODE_ENV=development
MONGODB_URI=mongodb://localhost:27017/pm-tool
JWT_SECRET=your-super-secret-jwt-key-change-in-production
JWT_EXPIRES_IN=7d
APP_URL=http://localhost:5173
```

### 4. Create super admin (first run)

```bash
cd server
npm run create-super-admin
```

Follow the prompts to create your first admin user.

### 5. Start the application

**Terminal 1 – Backend:**

```bash
cd server
npm run dev
```

**Terminal 2 – Frontend:**

```bash
cd Tasks
npm run dev
```

### 6. Open in browser

Navigate to **http://localhost:5173** and log in with your super admin credentials.

---

## 🏗 Project Structure

```
Tasks/
├── server/                 # Backend API
│   ├── src/
│   │   ├── config/         # Environment config
│   │   ├── middleware/     # Auth, permissions, validation
│   │   ├── modules/        # Feature modules
│   │   │   ├── auth/
│   │   │   ├── issues/
│   │   │   ├── projects/
│   │   │   ├── boards/
│   │   │   ├── sprints/
│   │   │   ├── dashboard/
│   │   │   ├── analytics/
│   │   │   ├── reports/
│   │   │   ├── testPlans/
│   │   │   └── ...
│   │   ├── routes/         # API route aggregation
│   │   └── utils/
│   └── package.json
│
└── Tasks/                  # Frontend (React)
    ├── src/
    │   ├── components/     # Reusable UI components
    │   ├── contexts/       # Auth, Notifications
    │   ├── lib/            # API client, types
    │   └── pages/          # Route-level pages
    └── package.json
```

---

## 🚢 Production Build

```bash
# Backend
cd server
npm run build
npm start

# Frontend
cd Tasks
npm run build
```

Serve the `Tasks/dist` folder with a static server (e.g. Nginx, Vercel, Netlify). Set `VITE_API_URL` to your API URL when building.

---

## 🔐 Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment | `development` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/pm-tool` |
| `JWT_SECRET` | JWT signing secret | **Required in production** |
| `JWT_EXPIRES_IN` | Access token expiry | `7d` |
| `APP_URL` | Frontend URL (for emails, links) | `http://localhost:5173` |
| `MAX_USERS` | Optional user limit (enterprise) | — |
| `SMTP_HOST` | Email host (forgot password, etc.) | — |
| `SMTP_PORT` | Email port | — |
| `SMTP_USER` | Email username | — |
| `SMTP_PASS` | Email password | — |
| `VAPID_PUBLIC_KEY` | Web push public key | — |
| `VAPID_PRIVATE_KEY` | Web push private key | — |

---

## 📜 Scripts

| Command | Location | Description |
|---------|----------|-------------|
| `npm run dev` | server | Start dev server with hot reload |
| `npm run build` | server | Compile TypeScript |
| `npm start` | server | Run production server |
| `npm run create-super-admin` | server | Create first admin user |
| `npm run dev` | Tasks | Start Vite dev server |
| `npm run build` | Tasks | Build for production |
| `npm run preview` | Tasks | Preview production build |

---

## 📄 License

This project is licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0). See [CONTRIBUTING.md](CONTRIBUTING.md) for how to contribute.

## Contributors

See [CONTRIBUTORS.md](CONTRIBUTORS.md) for the contributor list and how to add yourself.

---

<p align="center">
  <sub>Built with ❤️ for teams</sub>
</p>
