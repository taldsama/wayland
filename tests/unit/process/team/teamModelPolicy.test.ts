import { describe, it, expect } from 'vitest';

import { getTeamAvailableModels } from '@/common/utils/teamModelUtils';
import type { TeamModelPolicy } from '@/common/types/teamModelPolicy';

const sharedModels = [
  { id: 'custom:groq/qwen/qwen3.6-27b', label: 'qwen3.6-27b' },
  { id: 'openrouter:anthropic/claude-sonnet-5', label: 'claude-sonnet-5' },
  { id: 'custom:kiro/claude-sonnet-5', label: 'kiro claude' },
];

const cachedModels: Record<
  string,
  { availableModels: Array<{ id: string; label?: string }>; currentModelId?: string }
> = {
  'hermes-dev': {
    availableModels: sharedModels,
    currentModelId: 'custom:groq/qwen/qwen3.6-27b',
  },
  'hermes-homelab-ops': {
    availableModels: sharedModels,
    currentModelId: 'custom:groq/qwen/qwen3.6-27b',
  },
};

const policy: TeamModelPolicy = {
  catalog: {
    'custom:groq/qwen/qwen3.6-27b': { tier: 'free', agentTypes: ['hermes-dev'] },
    'openrouter:anthropic/claude-sonnet-5': { tier: 'paygo' },
  },
  tierDefaults: { groq: 'free', openrouter: 'paygo' },
};

describe('getTeamAvailableModels teams.modelPolicy', () => {
  it('v3 own list: free curated model listed; deactivated paygo hidden', () => {
    const models = getTeamAvailableModels('hermes-dev', cachedModels, [], false, policy);
    // qwen is free + scoped to hermes-dev -> listed.
    // claude-sonnet-5 is paygo with active != true -> NOT listed (avoids accidental charges).
    expect(models.map((m) => m.id)).toEqual(['custom:groq/qwen/qwen3.6-27b']);
    expect(models[0].tier).toBe('free');
  });

  it('v3: agentTypes scoping excludes model from other backends', () => {
    // qwen scoped to hermes-dev only; claude paygo deactivated -> nothing for this backend.
    const models = getTeamAvailableModels('hermes-homelab-ops', cachedModels, [], false, policy);
    expect(models).toEqual([]);
  });

  it('v3: empty catalog returns nothing (strict, wrap-around from cached dump)', () => {
    const empty: TeamModelPolicy = { catalog: {}, tierDefaults: {} };
    const models = getTeamAvailableModels('hermes-dev', cachedModels, [], false, empty);
    expect(models).toEqual([]);
  });

  it('legacy: policy absent keeps unfiltered reported behavior', () => {
    const models = getTeamAvailableModels('hermes-dev', cachedModels, [], false, null);
    expect(models).toHaveLength(3);
    expect(models[0].tier).toBeUndefined();
  });

  it('v3: wcore own list is curated only, providers ignored in enabled path', () => {
    const providers = [
      {
        id: 'p1',
        name: 'Groq',
        platform: 'openai-compatible',
        enabled: true,
        model: ['qwen/qwen3.6-27b', 'llama-3.3-70b-versatile'],
        modelEnabled: { 'qwen/qwen3.6-27b': true, 'llama-3.3-70b-versatile': true },
        __waylandModelRegistryBridge: 'v2:groq',
        never: true,
      },
    ];
    // In v3 the enabled path does not dump provider-reported models; it only
    // serves the curated own list (neither catalog entry is allowed for wcore
    // here), so the provider's models are NOT surfaced.
    const models = getTeamAvailableModels('wcore', null, providers, false, policy);
    expect(models).toEqual([]);
  });
});
