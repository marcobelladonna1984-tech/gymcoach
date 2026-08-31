# GymCoach MCP and ChatGPT

GymCoach exposes a Streamable HTTP MCP endpoint at `/mcp`. It lets external AI
agents read the trainee context and, with an explicitly write-enabled token,
create or edit training programs.

## Connect ChatGPT

1. Sign in to GymCoach and open **Settings -> ChatGPT and MCP**.
2. Create a connection. Leave write access enabled only when ChatGPT should be
   allowed to change saved programs.
3. Copy the connector URL immediately. Its secret token is shown only once.
4. In ChatGPT Developer Mode, create a custom connector and paste the URL.
5. Select **No authentication**. The private query token in the URL is the
   authentication credential for this personal deployment.

The public URL must use HTTPS. A local or LAN URL is not suitable for ChatGPT.

## Security model

- Raw tokens are never stored; PostgreSQL contains only their SHA-256 hashes.
- Tokens belong to one GymCoach user and can be revoked from Settings.
- Read-only tokens cannot call program-writing tools.
- Every write tool requires an explicit `confirmed: true` argument and is
  annotated as changing saved data.
- The agent never receives direct database, filesystem or shell access.
- The connector URL carries the token as a query string, so treat the URL
  itself as a secret: query strings routinely end up in reverse-proxy and
  access logs and in browser history. Disable or scrub query-string logging
  on any proxy in front of GymCoach, and prefer the `Authorization: Bearer`
  or `X-GymCoach-Token` header (both are supported) for MCP clients that can
  send headers.

For a shared or publicly distributed ChatGPT app, replace personal query-token
authentication with OAuth before submission.

## MCP capabilities

Resources:

- `gymcoach://instructions/agent`

Prompts:

- `build-training-program`

Read tools (10 total):

- `get_training_context`
- `list_exercises`
- `list_programs`
- `get_program`
- `get_weekly_health_report`
- `get_dashboard_summary`
- `get_weekly_report`
- `get_bodyweight_history`
- `get_next_session`
- `get_health_summary`

Write tools (7 total, all require `confirmed: true`):

- `create_program`
- `update_program_metadata`
- `add_program_exercise`
- `update_program_exercise`
- `remove_program_exercise`
- `activate_program`
- `log_quick_workout`

In total the server exposes **17 tools** (10 read + 7 write) plus the
`gymcoach://instructions/agent` resource and the `build-training-program` prompt.

## Discovery endpoint

`GET /mcp/info` is a public, unauthenticated endpoint that reports the MCP
transport, the endpoint path, the agent instructions, the number of exposed
tools and their names grouped by read/write. It is meant to be fetched before a
client connects (or by a human).

## OpenAPI Schema

URL: `GET /mcp/openapi.json` (served by `app/mcp/openapi/route.ts`)

A minimal OpenAPI 3.1 schema describing the `/mcp` endpoint for ChatGPT
Custom GPT Actions (and any HTTP client that wants a machine-readable
contract). It is public and unauthenticated - it never exposes the private
token.

To use it as a Custom GPT Action in ChatGPT:

1. Create a Custom GPT and open **Actions > Create new action**.
2. Paste `https://YOUR_DOMAIN/mcp/openapi.json` as the OpenAPI schema URL.
3. Add the authentication header. ChatGPT Maps Actions supports API-key auth;
   map it to `Authorization: Bearer <token-from-the-connector-URL>` or
   `X-GymCoach-Token: <token>`.
4. Keep the action read-only unless the connecting token has write access.

The public URL must use HTTPS. See the "Security model" section above before
exposing a write-enabled token.

## Health check

`GET /mcp/health` returns `401` without a token and `200` for an active token.
