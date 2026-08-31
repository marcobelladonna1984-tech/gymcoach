import { NextResponse } from 'next/server';
import { corsHeadersFor, mcpCorsPolicyFromEnv } from '@/lib/mcp/cors';
import { MCP_TOOL_NAMES, GYMCOACH_MCP_INSTRUCTIONS } from '@/lib/mcp/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public discovery endpoint: lets MCP clients (and humans) learn the transport,
// endpoint and available tools without authenticating. It exposes no private
// data and needs no bearer token (issue #331).
export async function GET(req: Request) {
  const origin = req.headers.get('origin');
  const base = new URL(req.url).origin;
  return NextResponse.json(
    {
      name: 'GymCoach',
      transport: 'streamable-http',
      endpoint: '/mcp',
      instructions: GYMCOACH_MCP_INSTRUCTIONS,
      toolCount: MCP_TOOL_NAMES.length,
      clients: {
        chatgpt: {
          type: 'custom-gpt-action',
          endpoint: `${base}/mcp`,
          openapi: `${base}/mcp/openapi.json`,
          auth: 'bearer token from the connector URL (query token or Authorization: Bearer)',
          notes: 'Configure as a Custom GPT Action using the OpenAPI schema at /mcp/openapi.json, or as an MCP server if your client supports the streamable HTTP transport.',
        },
        'claude-desktop': {
          type: 'mcp-client',
          endpoint: `${base}/mcp`,
          transport: 'streamable-http',
          auth: 'bearer token from the connector URL (query token or Authorization: Bearer)',
          notes: 'Add as a Streamable HTTP MCP server with the private token.',
        },
        cursor: {
          type: 'mcp-client',
          endpoint: `${base}/mcp`,
          transport: 'streamable-http',
          auth: 'bearer token from the connector URL (query token or Authorization: Bearer)',
          notes: 'Add as an MCP server under Settings > MCP with the private token.',
        },
        opencode: {
          type: 'mcp-client',
          endpoint: `${base}/mcp`,
          transport: 'streamable-http',
          auth: 'bearer token from the connector URL (query token or Authorization: Bearer)',
          notes: 'Register as an MCP server in the opencode config with the private token.',
        },
        copilot: {
          type: 'mcp-client',
          endpoint: `${base}/mcp`,
          transport: 'streamable-http',
          auth: 'bearer token from the connector URL (query token or Authorization: Bearer)',
          notes: 'Register as an MCP server with the private token where Copilot supports MCP servers.',
        },
      },
      tools: [
        {
          name: 'read',
          tools: [
            'get_training_context',
            'list_exercises',
            'list_programs',
            'get_program',
            'get_weekly_health_report',
            'get_dashboard_summary',
            'get_weekly_report',
            'get_bodyweight_history',
            'get_next_session',
            'get_health_summary',
          ],
        },
        {
          name: 'write',
          tools: [
            'create_program',
            'update_program_metadata',
            'add_program_exercise',
            'update_program_exercise',
            'remove_program_exercise',
            'activate_program',
            'log_quick_workout',
          ],
        },
      ],
      health: '/mcp/health',
    },
    {
      headers: corsHeadersFor(mcpCorsPolicyFromEnv(), origin),
    },
  );
}
