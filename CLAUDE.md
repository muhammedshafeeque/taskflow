@AGENTS.md

## Mandatory Rule: Record Every Change in `server/updates.txt`

Every change made to this repository (features, fixes, improvements, security updates, user-visible refactors, or config changes) **MUST** be recorded by appending a new line to `server/updates.txt` in the exact format:

`UPDATE_ID | DATE (YYYY-MM-DD) | TYPE | TITLE | DETAILS`

- Increment `UPDATE_ID` sequentially from the last entry in `server/updates.txt` (never reuse or renumber).
- `TYPE` must be one of `feature`, `improvement`, `fix`, `security`, `other`.
- Separate multiple points in `DETAILS` with ` ; `.
- Never edit or delete existing lines unless explicitly requested by the user.


## Mandatory Rule: Ticket Unrelated Issues in the AUT Project

If you find an issue that is **not related to the task you are working on** (a bug, failing or flaky test, security gap, broken UI, misleading behaviour, dead code that hides a problem, and so on), **do not fix it silently and do not ignore it**. Create a ticket for it in the **AUT** project automatically, without asking first.

- Use the Autrium MCP connection (`create_issue` with `project: "AUT"`). Read the project first (`get_project`) so type, status and priority are names that exist there. Default to status `Backlog`, assignee `me`, and type `Bug` for defects (`Task` or `Story` otherwise).
- Before creating it, search AUT (`search_issues` / `jql_search`) and skip it if an open ticket already covers the issue. Add a comment to the existing ticket instead if you have new evidence.
- The description must include:
  - **Problem:** what is wrong and who or what it affects.
  - **Evidence:** the exact code (file path with line numbers and a short snippet), the error message or test output, or a screenshot. Never file a ticket without evidence.
  - **Steps to reproduce**, when they apply.
  - **Done when:** the outcome that would close it.
  - **Found while:** the ticket or task you were working on.
- Keep working on the current task. Mention the new ticket keys in your final summary.
