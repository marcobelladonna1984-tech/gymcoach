import { NextResponse } from 'next/server';
import { corsHeadersFor, mcpCorsPolicyFromEnv } from '@/lib/mcp/cors';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public, unauthenticated OpenAPI 3.1 schema for ChatGPT Custom GPT Actions
// (and any HTTP client that wants a machine-readable contract for the MCP
// endpoint). It exposes no private data and needs no bearer token.
export async function GET(req: Request) {
  const origin = req.headers.get('origin');
  const base = new URL(req.url).origin;
  return NextResponse.json(
    {
      openapi: '3.1.0',
      info: { title: 'GymCoach MCP', version: '1.0.0' },
      servers: [{ url: base }],
      paths: {
        '/mcp': {
          post: {
            summary: 'MCP endpoint - send MCP JSON-RPC requests here',
            security: [{ bearerAuth: [] }],
            requestBody: {
              required: true,
              content: {
                'application/json': {
                  schema: {
                    type: 'object',
                    description:
                      'An MCP JSON-RPC message (initialize, tools/list, tools/call, ...).',
                  },
                },
              },
            },
            responses: {
              '200': { description: 'MCP response' },
            },
          },
        },
        '/mcp/info': {
          get: {
            summary: 'Public discovery endpoint - no auth required',
            responses: {
              '200': { description: 'Server info and tool list' },
            },
          },
        },
        '/mcp/openapi.json': {
          get: {
            summary: 'This OpenAPI schema - no auth required',
            responses: {
              '200': { description: 'OpenAPI 3.1 schema for GymCoach MCP' },
            },
          },
        },
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type: 'http',
            scheme: 'bearer',
            bearerFormat: 'gmc_TOKEN',
          },
        },
      },
    },
    {
      headers: corsHeadersFor(mcpCorsPolicyFromEnv(), origin),
    },
  );
}
