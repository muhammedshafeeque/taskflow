# Repository Agent Rules

## Mandatory Changelog Rule (`server/updates.txt`)

Every time you make a change to this project (new feature, bug fix, improvement, security update, user-visible refactor, or configuration change), you **MUST** append a new line to [`server/updates.txt`](server/updates.txt) before finishing your work.

### Format & Constraints

- **One update per line**, pipe-separated with **5 fields**:
  ```text
  UPDATE_ID | DATE (YYYY-MM-DD) | TYPE | TITLE | DETAILS
  ```
- **`UPDATE_ID`**: Sequential and unique (e.g., `UPD-0021`). Check the last entry in `server/updates.txt` and increment by 1. **Never reuse or renumber existing IDs.**
- **`DATE`**: Date of the change in `YYYY-MM-DD` format.
- **`TYPE`**: Must be one of: `feature`, `improvement`, `fix`, `security`, `other`.
- **`TITLE`**: Concise, user-friendly title (do not use `|` characters).
- **`DETAILS`**: Clear, user-friendly description; separate multiple bullet points with ` ; ` (do not use `|` characters).
- **Append-only**: Never edit or delete existing lines in `server/updates.txt` unless the user explicitly asks you to.
- **No `|` in text**: Never include pipe (`|`) characters inside `TITLE` or `DETAILS`.


## Mandatory Rule: Ticket Unrelated Issues (`AUT` project)

When you find an issue that is **not related to the task in progress** (a bug, failing or flaky test, security gap, broken UI, incorrect behaviour, and so on), you **MUST** create a ticket for it in the **AUT** project automatically, without asking, instead of fixing it silently or ignoring it.

### Requirements

- **Where**: the AUT project, through the Autrium MCP connection (`create_issue`, `project: "AUT"`). Check the project's types, statuses and priorities with `get_project`. Default: status `Backlog`, assignee `me`, type `Bug` for defects.
- **No duplicates**: search AUT first (`search_issues` / `jql_search`). If an open ticket already covers it, add a comment with any new evidence instead.
- **Description must contain**:
  - **Problem**: what is wrong and what it affects.
  - **Evidence**: exact code (file path, line numbers, snippet), error message or test output, or a screenshot. A ticket without evidence is not allowed.
  - **Steps to reproduce** (when applicable).
  - **Done when**: the expected outcome.
  - **Found while**: the ticket or task being worked on.
- **Do not derail**: continue the current task, and list the created ticket keys in your final summary.
