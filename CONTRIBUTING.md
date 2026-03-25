# Contributing to TaskFlow

Thanks for your interest in contributing. This document explains how to report issues, propose changes, and submit pull requests.

## License

By contributing to this project, you agree that your contributions will be licensed under the [GNU General Public License v3.0](LICENSE) (GPL-3.0), the same license that covers the project as a whole.

## Before you start

- Check existing issues and pull requests on this repository to avoid duplicate work.
- For larger features, consider opening an issue first to discuss design and scope.

## Development setup

1. **Clone** the repository and create a branch from the default branch (usually `main`).

2. **Backend** (`server/`):

   ```bash
   cd server
   npm install
   cp .env.example .env
   # Edit .env (MongoDB URI, JWT secret, etc.)
   npm run dev
   ```

3. **Frontend** (`Tasks/`):

   ```bash
   cd Tasks
   npm install
   npm run dev
   ```

4. **First-time admin**: from `server/`, run `npm run create-super-admin` if you need an admin user locally.

See the main [README.md](README.md) for environment variables and production build steps.

## Pull request workflow

1. **Branch**: Use a short, descriptive branch name (e.g. `fix/login-redirect`, `feature/board-filters`).

2. **Commits**: Write clear commit messages in the present tense (e.g. “Add sprint filter to backlog”).

3. **Scope**: Keep changes focused on one concern per PR when possible. Avoid unrelated refactors in the same PR as a bugfix unless necessary.

4. **Quality**:
   - Match existing code style, naming, and patterns in the touched files.
   - Run the frontend linter where relevant: `cd Tasks && npm run lint`.
   - Run `npm run build` in `server/` and `Tasks/` if your change affects compilation.

5. **Description**: Explain *what* changed and *why*, and note any breaking changes or follow-up work.

## Code and project layout

- **Backend**: Express + TypeScript under `server/src/` (modules, routes, middleware).
- **Frontend**: React + Vite + TypeScript under `Tasks/src/` (pages, components, contexts).

When adding features, prefer extending existing modules and shared utilities rather than duplicating logic.

## Security

Do not commit secrets, API keys, or production `.env` files. If you discover a security vulnerability, report it responsibly (private channel to maintainers if available; otherwise use GitHub Security Advisories where enabled).

## Documentation and contributors list

- User-facing or developer docs belong in `README.md` or focused markdown files in the repo root unless the team prefers another layout.
- If you want credit for your work, add yourself to [CONTRIBUTORS.md](CONTRIBUTORS.md) in the same PR or a follow-up.

## Questions

Open an issue on the repository or start a discussion if something in this guide is unclear or outdated.
