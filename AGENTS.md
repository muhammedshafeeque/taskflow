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
