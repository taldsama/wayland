/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * MCP server Doctor check.
 *
 * Each enabled MCP server is reached with the SAME `testMcpConnection` probe the
 * MCP Library "Test" button uses. A server that errors on startup is a real
 * break (its tools never reach the agent), so it FAILs; a server flagged as
 * needing auth WARNs (it is configured but not yet logged in). Disabled servers
 * are skipped — they are not installed to any agent.
 */

import type { IMcpServer } from '@/common/config/storage';
import type { DoctorCheckOutcome } from '../types';

/** The MCP connection test result shape (subset of `McpConnectionTestResult`). */
export type McpTestResult = {
  success: boolean;
  error?: string;
  needsAuth?: boolean;
  tools?: Array<{ name: string }>;
};

/** Dependencies for the MCP check — the server list and the connection probe. */
export type McpCheckDeps = {
  listServers: () => Promise<IMcpServer[]>;
  testConnection: (server: IMcpServer) => Promise<McpTestResult>;
};

/**
 * MCP servers — every ENABLED server can be reached and loads its tools. FAIL on
 * a server that errors; WARN on a server that needs auth (configured but not
 * logged in). PASS when all enabled servers connect (or none are enabled).
 */
export async function checkMcpServers(deps: McpCheckDeps): Promise<DoctorCheckOutcome> {
  const all = await deps.listServers();
  const enabled = all.filter((server) => server.enabled);
  if (enabled.length === 0) {
    return { status: 'pass', detail: 'No MCP servers are enabled.' };
  }

  const errored: string[] = [];
  const needAuth: string[] = [];
  let okCount = 0;

  // Probe sequentially: connection tests can spawn CLIs / open sockets, and a
  // burst of parallel spawns is a worse failure mode than a slightly slower run.
  for (const server of enabled) {
    const result = await deps.testConnection(server);
    if (result.success) {
      okCount += 1;
    } else if (result.needsAuth) {
      needAuth.push(server.name);
    } else {
      errored.push(`${server.name}${result.error ? ` (${result.error})` : ''}`);
    }
  }

  if (errored.length > 0) {
    return {
      status: 'fail',
      detail: `${errored.length} of ${enabled.length} enabled MCP server(s) failed to load: ${errored.join(', ')}.`,
      remediation: 'Fix or disable the failing server(s) in Settings → MCP Library → Installed.',
    };
  }
  if (needAuth.length > 0) {
    return {
      status: 'warn',
      detail: `${okCount} MCP server(s) OK; ${needAuth.length} need authentication: ${needAuth.join(', ')}.`,
      remediation: 'Log in to the server(s) from Settings → MCP Library → Installed.',
    };
  }
  return { status: 'pass', detail: `${okCount} enabled MCP server(s) connected.` };
}
