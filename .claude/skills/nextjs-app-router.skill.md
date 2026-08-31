# SKILL: Next.js App Router Patterns for GymCoach

## Stack
- Next.js 15, App Router, TypeScript strict
- All API routes live in `app/api/**/route.ts`
- MCP endpoints live in `app/mcp/**/route.ts`

## Route handler template

```ts
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';

const InputSchema = z.object({
  field: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = InputSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // ... logic
  return NextResponse.json({ ok: true });
}
```

## Dynamic routes — disable static caching

```ts
export const dynamic = 'force-dynamic';
```
Add this at top of any route that reads live DB data.

## Server Component data fetching

```ts
// app/dashboard/page.tsx
export default async function DashboardPage() {
  const data = await db.session.findMany({ where: { userId } });
  return <Dashboard data={data} />;
}
```

## UI primitives

Always use existing Shadcn components in `components/ui/`:
`Button`, `Card`, `Dialog`, `Input`, `Label`, `Select`, `Skeleton`, `Table`, `Tabs`, `Toast`

Never install new UI libraries without approval.

## Never do
- `'use client'` on a component that only reads data
- `fetch()` inside a Server Component for internal API routes (use `db` directly)
- `any` type in TypeScript
- Em-dashes or en-dashes (use hyphen `-`)
