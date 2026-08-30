# OpenCode setup for GymCoach

This file documents how to use OpenCode (the local AI coding agent) on this repo.

## Quick start

```bash
# 1. Install OpenCode globally (if not already installed)
npm install -g opencode-ai

# 2. From the repo root - OpenCode picks up opencode.json automatically
opencode
```

## MCP servers bundled in opencode.json

| Server | Purpose |
|---|---|
| `gymcoach-db` | Direct Postgres access - query the DB, inspect schema, debug migrations |
| `context7` | Live docs for Next.js 15, Prisma, Tailwind, Shadcn, Zod |
| `filesystem` | Read/write project files |

## Recommended plugins (install once globally)

```bash
# Live documentation (Next.js, Prisma, Tailwind, Shadcn, Zod)
npx @upstash/context7-mcp --help

# Composio - 250+ API integrations with OAuth (YouTube, Google, etc.)
# opencode mcp auth composio
```

## Workflow

1. OpenCode reads `CLAUDE.md` automatically via `instructions` in `opencode.json`.
2. Before any commit run the green-gate: `bash scripts/verify.sh`.
3. Never commit to `main` - always work on a feature branch.
4. The `gymcoach-db` MCP lets OpenCode inspect the real schema without guessing.

## Environment variables required

Copy `.env.example` to `.env` and fill in:
- `DATABASE_URL` - used by `gymcoach-db` MCP server
- `YOUTUBE_API_KEY` - for `/nutrition/recipes` video search
- `LLM_PROVIDER` + matching key (`ANTHROPIC_API_KEY` or `OPENROUTER_API_KEY`)
