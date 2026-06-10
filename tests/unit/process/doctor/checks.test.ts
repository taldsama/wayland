/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import { checkProviderConnectivity, checkModelRegistrySanity } from '@process/doctor/checks/providerChecks';
import type { ProviderRegistryReader, ConnectProbe } from '@process/doctor/checks/providerChecks';
import { checkEngineReachable, checkEngineRouting } from '@process/doctor/checks/engineChecks';
import { checkMcpServers } from '@process/doctor/checks/mcpChecks';
import { checkBackends } from '@process/doctor/checks/backendChecks';
import { checkWorkspaceDrift } from '@process/doctor/checks/workspaceChecks';
import { checkSecretStorage, checkEngineConfigIntegrity } from '@process/doctor/checks/configChecks';
import type { RegistryProvider, RegistryCredsResult } from '@process/providers/storage/ProviderRepository';
import type { ProviderId } from '@process/providers/types';
import type { IMcpServer } from '@/common/config/storage';
import type { DetectedAgent } from '@/common/types/detectedAgent';

// ── Provider connectivity ──────────────────────────────────────────────────

const makeReader = (
  providers: RegistryProvider[],
  creds: Record<string, RegistryCredsResult>,
  catalog: Record<string, number>
): ProviderRegistryReader => ({
  listRegistryProviders: () => providers,
  getRegistryProviderCreds: (id: ProviderId) => creds[id] ?? { status: 'not-found' },
  countRegistryCatalog: (id: ProviderId) => catalog[id] ?? 0,
});

const provider = (id: ProviderId): RegistryProvider => ({
  providerId: id,
  connectedVia: 'api-key',
  state: 'connected',
  credsEncrypted: 'enc',
});

describe('checkProviderConnectivity', () => {
  it('warns when no providers are connected', async () => {
    const result = await checkProviderConnectivity(makeReader([], {}, {}), { test: async () => ({ ok: true }) });
    expect(result.status).toBe('warn');
    expect(result.remediation).toBeDefined();
  });

  it('passes when every provider probes ok', async () => {
    const reader = makeReader(
      [provider('openai')],
      { openai: { status: 'ok', creds: { key: 'sk-test' } } },
      { openai: 5 }
    );
    const probe: ConnectProbe = { test: async () => ({ ok: true }) };
    const result = await checkProviderConnectivity(reader, probe);
    expect(result.status).toBe('pass');
  });

  it('fails on an auth error', async () => {
    const reader = makeReader(
      [provider('openai')],
      { openai: { status: 'ok', creds: { key: 'sk-bad' } } },
      { openai: 5 }
    );
    const probe: ConnectProbe = { test: async () => ({ ok: false, error: 'unauthorized' }) };
    const result = await checkProviderConnectivity(reader, probe);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('unauthorized');
  });

  it('fails when stored credentials are undecryptable', async () => {
    const reader = makeReader([provider('openai')], { openai: { status: 'undecryptable' } }, { openai: 5 });
    const probe: ConnectProbe = { test: async () => ({ ok: true }) };
    const result = await checkProviderConnectivity(reader, probe);
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('unreadable');
  });

  it('warns (not fails) on an offline host', async () => {
    const reader = makeReader(
      [provider('openai')],
      { openai: { status: 'ok', creds: { key: 'sk-test' } } },
      { openai: 5 }
    );
    const probe: ConnectProbe = { test: async () => ({ ok: false, error: 'offline' }) };
    const result = await checkProviderConnectivity(reader, probe);
    expect(result.status).toBe('warn');
  });

  it('probes a keyed provider with the key path, not the fields path', async () => {
    let received: unknown;
    const reader = makeReader(
      [provider('openai')],
      { openai: { status: 'ok', creds: { key: 'sk-test', other: 'x' } } },
      { openai: 1 }
    );
    const probe: ConnectProbe = {
      test: async (_id, creds) => {
        received = creds;
        return { ok: true };
      },
    };
    await checkProviderConnectivity(reader, probe);
    expect(received).toEqual({ key: 'sk-test' });
  });
});

// ── Model registry ─────────────────────────────────────────────────────────

describe('checkModelRegistrySanity', () => {
  it('fails when every connected provider has an empty catalog', async () => {
    const reader = makeReader([provider('openai')], { openai: { status: 'ok', creds: {} } }, { openai: 0 });
    const result = await checkModelRegistrySanity(reader);
    expect(result.status).toBe('fail');
  });

  it('warns when some providers are empty but a model exists', async () => {
    const reader = makeReader(
      [provider('openai'), provider('anthropic')],
      {},
      { openai: 3, anthropic: 0 }
    );
    const result = await checkModelRegistrySanity(reader);
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('anthropic');
  });

  it('passes when every provider lists models', async () => {
    const reader = makeReader([provider('openai')], {}, { openai: 4 });
    const result = await checkModelRegistrySanity(reader);
    expect(result.status).toBe('pass');
  });
});

// ── Engine ─────────────────────────────────────────────────────────────────

describe('checkEngineReachable', () => {
  it('fails when no binary is found', async () => {
    const result = await checkEngineReachable(() => ({ available: false }));
    expect(result.status).toBe('fail');
  });

  it('warns when the binary exists but reports no version', async () => {
    const result = await checkEngineReachable(() => ({ available: true, path: '/x/wayland-core' }));
    expect(result.status).toBe('warn');
  });

  it('passes when the binary reports a version', async () => {
    const result = await checkEngineReachable(() => ({ available: true, version: 'v0.10.0', path: '/x' }));
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('v0.10.0');
  });
});

describe('checkEngineRouting', () => {
  it('warns when no providers are connected', async () => {
    const result = await checkEngineRouting({ providerCount: () => 0, totalModelCount: () => 0 });
    expect(result.status).toBe('warn');
  });

  it('fails when no routable model exists', async () => {
    const result = await checkEngineRouting({ providerCount: () => 1, totalModelCount: () => 0 });
    expect(result.status).toBe('fail');
  });

  it('passes when a routable model exists', async () => {
    const result = await checkEngineRouting({ providerCount: () => 1, totalModelCount: () => 7 });
    expect(result.status).toBe('pass');
  });
});

// ── MCP ────────────────────────────────────────────────────────────────────

const mcpServer = (over: Partial<IMcpServer>): IMcpServer =>
  ({
    id: over.id ?? 'id',
    name: over.name ?? 'srv',
    enabled: over.enabled ?? true,
    transport: { type: 'stdio', command: 'x', args: [] } as IMcpServer['transport'],
    createdAt: 0,
    updatedAt: 0,
    originalJson: '{}',
    ...over,
  }) as IMcpServer;

describe('checkMcpServers', () => {
  it('passes when no servers are enabled', async () => {
    const result = await checkMcpServers({
      listServers: async () => [mcpServer({ enabled: false })],
      testConnection: async () => ({ success: true }),
    });
    expect(result.status).toBe('pass');
  });

  it('fails when an enabled server errors', async () => {
    const result = await checkMcpServers({
      listServers: async () => [mcpServer({ name: 'broken' })],
      testConnection: async () => ({ success: false, error: 'spawn failed' }),
    });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('broken');
  });

  it('warns when an enabled server needs auth', async () => {
    const result = await checkMcpServers({
      listServers: async () => [mcpServer({ name: 'needs-login' })],
      testConnection: async () => ({ success: false, needsAuth: true }),
    });
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('needs-login');
  });

  it('passes when every enabled server connects', async () => {
    const result = await checkMcpServers({
      listServers: async () => [mcpServer({ name: 'a' }), mcpServer({ name: 'b', id: 'b' })],
      testConnection: async () => ({ success: true, tools: [{ name: 't' }] }),
    });
    expect(result.status).toBe('pass');
  });
});

// ── Backends ───────────────────────────────────────────────────────────────

const agent = (name: string, available = true): DetectedAgent =>
  ({ id: name, name, kind: 'acp', available, backend: name }) as DetectedAgent;

describe('checkBackends', () => {
  it('warns when none are detected', async () => {
    const result = await checkBackends({ getDetectedAgents: () => [], getLoadErrors: () => [] });
    expect(result.status).toBe('warn');
  });

  it('warns when a sub-detector reported a load error', async () => {
    const result = await checkBackends({
      getDetectedAgents: () => [agent('claude')],
      getLoadErrors: () => ['remote db read failed'],
    });
    expect(result.status).toBe('warn');
    expect(result.detail).toContain('remote db read failed');
  });

  it('passes when backends are detected and there are no load errors', async () => {
    const result = await checkBackends({
      getDetectedAgents: () => [agent('claude'), agent('codex'), agent('dead', false)],
      getLoadErrors: () => [],
    });
    expect(result.status).toBe('pass');
    expect(result.detail).toContain('claude');
    expect(result.detail).not.toContain('dead');
  });
});

// ── Workspace drift ─────────────────────────────────────────────────────────

describe('checkWorkspaceDrift', () => {
  it('passes when no workspaces are configured', async () => {
    const result = await checkWorkspaceDrift({ listWorkspaces: async () => [], pathExists: async () => true });
    expect(result.status).toBe('pass');
  });

  it('fails when a configured path is missing', async () => {
    const result = await checkWorkspaceDrift({
      listWorkspaces: async () => [
        { label: 'Project "A"', path: '/exists' },
        { label: 'Project "B"', path: '/missing' },
      ],
      pathExists: async (path: string) => path === '/exists',
    });
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('/missing');
    expect(result.detail).not.toContain('/exists →');
  });

  it('passes when all paths exist', async () => {
    const result = await checkWorkspaceDrift({
      listWorkspaces: async () => [{ label: 'P', path: '/a' }],
      pathExists: async () => true,
    });
    expect(result.status).toBe('pass');
  });
});

// ── Config ─────────────────────────────────────────────────────────────────

describe('checkSecretStorage', () => {
  it('passes when the OS keychain is available', async () => {
    const result = await checkSecretStorage(() => true);
    expect(result.status).toBe('pass');
  });

  it('warns when only the file-key fallback is available', async () => {
    const result = await checkSecretStorage(() => false);
    expect(result.status).toBe('warn');
    expect(result.remediation).toBeDefined();
  });
});

describe('checkEngineConfigIntegrity', () => {
  it('passes when the config parses', async () => {
    const result = await checkEngineConfigIntegrity(async () => ({ status: 'ok', existed: true }));
    expect(result.status).toBe('pass');
  });

  it('passes (fresh install) when the config is absent', async () => {
    const result = await checkEngineConfigIntegrity(async () => ({ status: 'ok', existed: false }));
    expect(result.status).toBe('pass');
    expect(result.detail.toLowerCase()).toContain('fresh install');
  });

  it('fails when the config is corrupt', async () => {
    const result = await checkEngineConfigIntegrity(async () => ({ status: 'corrupt', message: 'bad toml at line 3' }));
    expect(result.status).toBe('fail');
    expect(result.detail).toContain('bad toml');
  });
});
