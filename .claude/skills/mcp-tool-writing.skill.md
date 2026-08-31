# SKILL: MCP Tool Writing for GymCoach

## Location
`lib/mcp/server.ts` — all tools registered here.

## Minimal read tool

```ts
server.registerTool(
  'get_example',
  {
    title: 'Get Example',
    description: 'Returns example data for the current user.',
    inputSchema: {
      days: z.number().int().min(1).max(90).default(30),
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
  },
  async ({ days }) => {
    const data = await db.bodyweightEntry.findMany({
      where: { userId: principal.userId },
      take: days,
      orderBy: { measuredAt: 'desc' },
    });
    return result({ entries: data });
  },
);
```

## Minimal write tool

```ts
server.registerTool(
  'do_something',
  {
    title: 'Do Something',
    description: 'Performs a write action after explicit confirmation.',
    inputSchema: {
      confirmed: explicitConfirmation,
      name: z.string().trim().min(1).max(100),
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
  },
  async ({ name }) => {
    requireWrite(principal);
    const record = await db.someModel.create({
      data: { userId: principal.userId, name },
    });
    return result({ created: record });
  },
);
```

## Helpers already in scope (never redefine)

| Name | Type | Use |
|---|---|---|
| `result(data)` | function | Wrap every return value |
| `requireWrite(principal)` | function | First line of every write tool |
| `explicitConfirmation` | Zod literal | Required input on write tools |
| `principal.userId` | string | Scope all queries |
| `principal.canWrite` | boolean | Checked by requireWrite |
| `buildCoachPayload(userId)` | async fn | Full coach context |
| `getOwnedProgram(userId, id?)` | async fn | Safe program lookup |
| `db` | Prisma client | Direct DB access |

## Checklist before committing a new tool

- [ ] readOnlyHint matches actual behavior
- [ ] All db queries scoped to principal.userId
- [ ] Write tools call requireWrite(principal) as first line
- [ ] Write tools have confirmed: explicitConfirmation input
- [ ] Returns result({ ... }) helper
- [ ] bash scripts/verify.sh is green
