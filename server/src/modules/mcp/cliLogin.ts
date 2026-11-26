import type { Request, Response } from 'express';
import { mcpPublicUrl, DEVICE_GRANT } from './mcpOAuth';

/**
 * A small POSIX sh + curl script that signs a terminal in with the device flow and prints a personal API token
 * (token on stdout, instructions on stderr), for CLI tools that take a bearer token: `TOKEN=$(sh atrium-login.sh)`.
 * Served with this installation's own MCP URL in it. Nothing is stored on the machine.
 */
const SCRIPT = `#!/bin/sh
# Sign in to Atrium from a terminal (OAuth device flow) and print a personal API token.
#   sh atrium-login.sh            -> prints the token
#   TOKEN=$(sh atrium-login.sh)   -> keep it in a variable
# Optional: ATRIUM_CLIENT_NAME="CI runner" names the connection (shown under Profile -> API tokens).
set -eu
MCP_URL="__MCP_URL__"
NAME="\${ATRIUM_CLIENT_NAME:-$(hostname 2>/dev/null || echo this) terminal}"
command -v curl >/dev/null 2>&1 || { echo "curl is required" >&2; exit 1; }
field() { printf '%s' "$1" | sed -n "s/.*\\"$2\\"[[:space:]]*:[[:space:]]*\\"\\{0,1\\}\\([^\\",}]*\\)\\"\\{0,1\\}.*/\\1/p"; }

R=$(curl -fsS -X POST "$MCP_URL/oauth/device_authorization" --data-urlencode "client_name=$NAME") || { echo "Could not reach $MCP_URL" >&2; exit 1; }
DEVICE=$(field "$R" device_code); CODE=$(field "$R" user_code); OPEN=$(field "$R" verification_uri)
CLIENT=$(field "$R" client_id); INTERVAL=$(field "$R" interval)
echo "" >&2
echo "  To connect this terminal to Atrium, open:  $OPEN" >&2
echo "  and enter the code:                         $CODE" >&2
echo "  (only enter it if you started this yourself; the code expires in 10 minutes)" >&2
echo "" >&2
while :; do
  sleep "\${INTERVAL:-5}"
  R=$(curl -sS -X POST "$MCP_URL/oauth/token" --data-urlencode "grant_type=${DEVICE_GRANT}" --data-urlencode "device_code=$DEVICE" --data-urlencode "client_id=$CLIENT")
  TOKEN=$(field "$R" access_token)
  [ -n "$TOKEN" ] && break
  case "$(field "$R" error)" in
    authorization_pending) ;;
    slow_down) INTERVAL=$((\${INTERVAL:-5} + 5)) ;;
    access_denied) echo "Sign-in was declined." >&2; exit 1 ;;
    expired_token) echo "The code expired. Run the script again." >&2; exit 1 ;;
    *) echo "Sign-in failed: $R" >&2; exit 1 ;;
  esac
done
echo "Signed in. Use the token as a bearer header, for example:" >&2
echo "  claude mcp add --transport http atrium $MCP_URL --header \\"Authorization: Bearer <token>\\"" >&2
echo "Revoke it any time under Profile -> API tokens." >&2
printf '%s\\n' "$TOKEN"
`;

export function cliLoginScript(req: Request, res: Response) {
  // The URL lands inside a shell script: allow URL characters only.
  const url = mcpPublicUrl(req).replace(/[^A-Za-z0-9.:/_%-]/g, '');
  res
    .status(200)
    .set('Content-Type', 'text/x-shellscript; charset=utf-8')
    .set('Content-Disposition', 'inline; filename="atrium-login.sh"')
    .set('Cache-Control', 'no-store')
    .set('X-Content-Type-Options', 'nosniff')
    .send(SCRIPT.replace('__MCP_URL__', url));
}
