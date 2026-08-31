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
  return NextResponse.json(
    {
      name: 'GymCoach',
      transport: 'streamable-http',
      endpoint: '/mcp',
      instructions: GYMCOACH_MCP_INSTRUCTIONS,
      toolCount: MCP_TOOL_NAMES.length,
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
