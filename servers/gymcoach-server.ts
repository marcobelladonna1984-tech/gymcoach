/**
 * GymCoach MCP server (standalone, stdio transport).
 *
 * Generated from the OpenAPI spec in servers/openapi.json in the style of
 * gautamgb/mcp-server-generator: each tool maps to a real GymCoach API
 * operation and proxies to the running GymCoach server over HTTP.
 *
 * Scope: bodyweight, workout, import and the weekly health report.
 *
 * Configuration (environment variables):
 *   GYMCOACH_API_URL          Base URL of the GymCoach app. Default http://localhost:3030.
 *   GYMCOACH_SESSION_COOKIE   The raw GymCoach JWT session cookie value. The REST
 *                             routes authenticate with the httpOnly "gymcoach-session"
 *                             cookie, so this is sent back as the Cookie header.
 *   GYMCOACH_MCP_URL          MCP Streamable HTTP endpoint for the weekly report
 *                             delegation. Default GYMCOACH_API_URL + /api/mcp.
 *   GYMCOACH_MCP_TOKEN        A gmc_ MCP bearer token used against GYMCOACH_MCP_URL.
 *
 * Run: npx tsx servers/gymcoach-server.ts
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';

const BASE_URL = (process.env.GYMCOACH_API_URL ?? 'http://localhost:3030').replace(/\/$/, '');
const SESSION_COOKIE = process.env.GYMCOACH_SESSION_COOKIE ?? '';
const MCP_URL = (process.env.GYMCOACH_MCP_URL ?? `${BASE_URL}/api/mcp`).replace(/\/$/, '');
const MCP_TOKEN = process.env.GYMCOACH_MCP_TOKEN ?? '';

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

function headers(): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(SESSION_COOKIE ? { cookie: `gymcoach-session=${SESSION_COOKIE}` } : {}),
  };
}

function text(text: string) {
  return { content: [{ type: 'text' as const, text }] };
}

async function proxy(path: string, request: { method: string; body?: unknown }) {
  const url = `${BASE_URL}${path}`;
  const init: RequestInit = {
    method: request.method,
    headers: headers(),
  };
  if (request.body !== undefined) init.body = JSON.stringify(request.body);
  const res = await fetch(url, init);
  const raw = await res.text();
  if (!res.ok) {
    throw new Error(`GymCoach API ${res.status} ${path}: ${raw || res.statusText}`);
  }
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

// Calls the real GymCoach MCP endpoint (Streamable HTTP) for the weekly health
// report tool. This is the actual API surface: there is no /api/report REST
// route, the report is an MCP tool (get_weekly_health_report) on lib/mcp.
async function callReportTool(reportDate?: string) {
  if (!MCP_TOKEN) {
    throw new Error(
      'GYMCOACH_MCP_TOKEN is required to read the weekly health report (it delegates to the GymCoach MCP endpoint).',
    );
  }
  const params = reportDate ? { reportDate } : {};
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${MCP_TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: randomUUID(),
      method: 'tools/call',
      params: { name: 'get_weekly_health_report', arguments: params },
    }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`GymCoach MCP ${res.status}: ${JSON.stringify(body)}`);
  }
  const result = body?.result as { content?: { text?: string }[]; structuredContent?: unknown };
  if (result?.structuredContent !== undefined) return result.structuredContent;
  const first = result?.content?.[0]?.text;
  if (first !== undefined) return JSON.parse(first);
  return body;
}

// ---------------------------------------------------------------------------
// MCP server
// ---------------------------------------------------------------------------

const server = new McpServer(
  { name: 'gymcoach-rest', version: '1.0.0', websiteUrl: BASE_URL },
  {
    instructions:
      'GymCoach REST proxy. Read tools before recommending. Write tools (create/update/delete) change saved data. Ground every recommendation in returned GymCoach data.',
  },
);

// --- bodyweight -------------------------------------------------------------

server.registerTool(
  'list_bodyweight_entries',
  {
    description: 'Lists the user bodyweight history, newest first.',
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async () => text(JSON.stringify(await proxy('/api/bodyweight', { method: 'GET' }), null, 2)),
);

server.registerTool(
  'create_bodyweight_entry',
  {
    description: 'Logs a bodyweight measurement in kg. Re-syncs the current bodyweight to the newest entry.',
    inputSchema: {
      weightKg: z.number().min(20).max(300),
      note: z.string().max(500).optional(),
    },
    annotations: { idempotentHint: false, openWorldHint: false },
  },
  async ({ weightKg, note }) => {
    const created = await proxy('/api/bodyweight', {
      method: 'POST',
      body: { weightKg, note },
    });
    return text(JSON.stringify(created, null, 2));
  },
);

server.registerTool(
  'delete_bodyweight_entry',
  {
    description: 'Deletes one bodyweight entry by id and re-syncs the current bodyweight.',
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ id }) => text(JSON.stringify(await proxy(`/api/bodyweight/${encodeURIComponent(id)}`, { method: 'DELETE' }), null, 2)),
);

// --- workout -----------------------------------------------------------------

server.registerTool(
  'create_workout',
  {
    description: 'Adds a workout to a program. Order is computed as max + 1.',
    inputSchema: {
      programId: z.string(),
      name: z.string().min(1).max(120),
      dayOfWeek: z.number().int().min(1).max(7).optional(),
    },
    annotations: { idempotentHint: false, openWorldHint: false },
  },
  async ({ programId, name, dayOfWeek }) => {
    const created = await proxy(`/api/programs/${encodeURIComponent(programId)}/workouts`, {
      method: 'POST',
      body: { name, dayOfWeek },
    });
    return text(JSON.stringify(created, null, 2));
  },
);

server.registerTool(
  'update_workout',
  {
    description: 'Updates a workout name and day of week. Scoped to a program owned by the user.',
    inputSchema: {
      id: z.string(),
      name: z.string().min(1).max(120),
      dayOfWeek: z.number().int().min(1).max(7).optional(),
    },
    annotations: { idempotentHint: true, openWorldHint: false },
  },
  async ({ id, name, dayOfWeek }) => {
    const updated = await proxy(`/api/workouts/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: { name, dayOfWeek },
    });
    return text(JSON.stringify(updated, null, 2));
  },
);

server.registerTool(
  'delete_workout',
  {
    description: 'Deletes a workout by id.',
    inputSchema: { id: z.string() },
    annotations: { destructiveHint: true, idempotentHint: false, openWorldHint: false },
  },
  async ({ id }) => text(JSON.stringify(await proxy(`/api/workouts/${encodeURIComponent(id)}`, { method: 'DELETE' }), null, 2)),
);

// --- import ------------------------------------------------------------------

const FORMATS = ['health', 'gymcoach', 'strong', 'hevy', 'tcx', 'gpx', 'fit'] as const;
const modeSchema = z.enum(['preview', 'confirm']);

server.registerTool(
  'import_data',
  {
    description:
      'Imports training or health data through the GymCoach import API. mode=preview plans without writing; mode=confirm performs the import. Use the payload keys matching the chosen format: health|csv formats use csv (+ optional unit for strong); tcx uses xml; gpx uses gpx; fit uses fit or fits (base64).',
    inputSchema: {
      format: z.enum(FORMATS),
      mode: modeSchema,
      csv: z.string().optional(),
      unit: z.enum(['KG', 'LB']).optional(),
      xml: z.string().optional(),
      gpx: z.string().optional(),
      fit: z.string().optional(),
      fits: z.array(z.string()).optional(),
    },
    annotations: { idempotentHint: false, openWorldHint: false },
  },
  async ({ format, mode, csv, unit, xml, gpx, fit, fits }) => {
    let body: Record<string, unknown> = { mode };
    switch (format) {
      case 'health':
      case 'gymcoach':
      case 'strong':
      case 'hevy':
        if (!csv) throw new Error(`format ${format} requires csv`);
        body.csv = csv;
        if (format === 'strong' && unit) body.unit = unit;
        break;
      case 'tcx':
        if (!xml) throw new Error('format tcx requires xml');
        body.xml = xml;
        break;
      case 'gpx':
        if (!gpx) throw new Error('format gpx requires gpx');
        body.gpx = gpx;
        break;
      case 'fit':
        if (!fit && !fits) throw new Error('format fit requires fit or fits');
        if (fit) body.fit = fit;
        if (fits) body.fits = fits;
        break;
    }
    const result = await proxy(`/api/import/${format}`, { method: 'POST', body });
    return text(JSON.stringify(result, null, 2));
  },
);

// --- report -------------------------------------------------------------------

server.registerTool(
  'get_weekly_health_report',
  {
    description:
      'Builds the GymCoach weekly health report (bodyweight moving average, change vs previous period, steps, sleep, heart rate) over the 7 days ending on reportDate. Delegates to the real GymCoach MCP tool of the same name.',
    inputSchema: {
      reportDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
  },
  async ({ reportDate }) => text(JSON.stringify(await callReportTool(reportDate), null, 2)),
);

// -----------------------------------------------------------------------------
// Stdio bootstrap
// -----------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error('GymCoach MCP server failed to start:', err);
  process.exit(1);
});
