import { describe, it, expect } from 'vitest';

import {
  compileTeamModelPolicy,
  getTeamAvailableModelsFromCompiled,
} from '@/common/utils/teamModelUtils';
import type { TeamModelPolicy } from '@/common/types/teamModelPolicy';

const cached = {
  'hermes-dev': {
    availableModels: [{ id: 'custom:groq/qwen/qwen3.6-27b' }],
  },
};

describe('teamModelPolicy v2 pools compile', () => {
  it('v3: pool model kept (own list authority); paygo defaults inactive; warn paygo-not-found', () => {
    const policy: TeamModelPolicy = {
      pools: [
        {
          id: 'omniroute-combo-1',
          tier: 'paygo',
          agentTypes: ['hermes-dev'],
          models: ['custom:groq/qwen/qwen3.6-27b', 'custom:kiro/ghost'],
        },
      ],
    };
    const compiled = compileTeamModelPolicy(policy, cached, []);
    // pool model kept with pool tier/agentTypes
    expect(compiled.catalog['custom:groq/qwen/qwen3.6-27b']?.tier).toBe('paygo');
    expect(compiled.catalog['custom:groq/qwen/qwen3.6-27b']?.agentTypes).toEqual(['hermes-dev']);
    // unreported pool model is KEPT (own list authoritative, not cross-validated away)
    expect(compiled.catalog['custom:kiro/ghost']).toBeDefined();
    expect(compiled.catalog['custom:kiro/ghost']?.active).toBe(false); // paygo defaults inactive
    // paygo-not-found validated against cached catalog -> warning, but model still present
    expect(compiled.poolWarnings.length).toBe(1);
    expect(compiled.poolWarnings[0]).toMatchObject({ poolId: 'omniroute-combo-1', model: 'custom:kiro/ghost' });
    // poolModelsByAgentType tracks pool IDs per agent type (not model ids)
    expect([...compiled.poolModelsByAgentType['hermes-dev']]).toEqual(['omniroute-combo-1']);
  });

  it('explicit catalog entry kept even if not reported (user authority)', () => {
    const policy: TeamModelPolicy = {
      catalog: { 'custom:kiro/ghost': { tier: 'token' } },
    };
    const compiled = compileTeamModelPolicy(policy, cached, []);
    expect(compiled.catalog['custom:kiro/ghost']?.tier).toBe('token');
    expect(compiled.poolWarnings).toEqual([]);
  });

  it('gemini restricted to pool models when pools defined for gemini', () => {
    const policy: TeamModelPolicy = {
      tierDefaults: { 'google-gemini': 'token' },
      pools: [
        {
          id: 'gemini-api-free',
          tier: 'free',
          agentTypes: ['gemini', 'wcore'],
          models: ['gemini-3.5-flash-lite'],
          alwaysAvailable: true,
        },
      ],
    };
    const providers = [
      { id: 'p1', name: 'Gemini', platform: 'google-gemini', enabled: true, model: ['gemini-3.5-flash-lite', 'gemini-2.5-pro'] },
    ];
    const compiled = compileTeamModelPolicy(policy, null, providers);
    const models = getTeamAvailableModelsFromCompiled('gemini', compiled, null, providers, true);
    const ids = models.map((m) => m.id);
    // pool sets the allowed subset
    expect(ids).toContain('gemini-3.5-flash-lite');
    expect(ids).not.toContain('gemini-2.5-pro');
    const flash = models.find((m) => m.id === 'gemini-3.5-flash-lite');
    expect(flash?.tier).toBe('free');
  });

  it('v3: without catalog entries wcore returns empty (providers ignored, no dump)', () => {
    const policy: TeamModelPolicy = { tierDefaults: { groq: 'free' } };
    const providers = [
      { id: 'p1', name: 'Groq', platform: 'openai-compatible', enabled: true, model: ['qwen/qwen3.6-27b', 'llama-3.3-70b'] },
    ];
    const compiled = compileTeamModelPolicy(policy, null, providers);
    const models = getTeamAvailableModelsFromCompiled('wcore', compiled, null, providers, false);
    // v3 own list: no curated entries for wcore -> empty, even with providers reporting models.
    expect(models).toEqual([]);
  });

  it('cliProfiles surfaced in compiled policy (own / off / tokenPlan)', () => {
    const policy: TeamModelPolicy = {
      cliProfiles: {
        'hermes-dev': { status: 'active', modelControl: 'own', tokenPlan: false },
        wcore: { status: 'off', modelControl: 'imposed', tokenPlan: true },
      },
    };
    const compiled = compileTeamModelPolicy(policy, cached, []);
    expect(compiled.cliProfiles['hermes-dev']?.modelControl).toBe('own');
    expect(compiled.cliProfiles.wcore).toMatchObject({ status: 'off', modelControl: 'imposed', tokenPlan: true });
  });
});
