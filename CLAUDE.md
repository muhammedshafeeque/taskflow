@AGENTS.md

## Mandatory Rule: Record Every Change in `server/updates.txt`

Every change made to this repository (features, fixes, improvements, security updates, user-visible refactors, or config changes) **MUST** be recorded by appending a new line to `server/updates.txt` in the exact format:

`UPDATE_ID | DATE (YYYY-MM-DD) | TYPE | TITLE | DETAILS`

- Increment `UPDATE_ID` sequentially from the last entry in `server/updates.txt` (never reuse or renumber).
- `TYPE` must be one of `feature`, `improvement`, `fix`, `security`, `other`.
- Separate multiple points in `DETAILS` with ` ; `.
- Never edit or delete existing lines unless explicitly requested by the user.
