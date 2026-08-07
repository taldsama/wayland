/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Shared handler for listing available models.
 * Used by both TeamMcpServer (team_list_models) and TeamGuideMcpServer (aion_list_models).
 */

import { isTeamCapableBackend } from '@/common/types/teamTypes';
import { compileTeamModelPolicy, getTeamAvailableModelsFromCompiled } from '@/common/utils/teamModelUtils';
import type { CliProfile } from '@/common/types/teamModelPolicy';
import { ProcessConfig } from '@process/utils/initStorage';
import { getMergedModelProviders } from '@process/bridge/modelBridge';
import { hasGeminiOauthCreds } from '../googleAuthCheck';
import { agentRegistry } from '@process/agent/AgentRegistry';

const TIER_LEGEND =
  'Tier legend: [tier:free] free but rate-limited (retry on resource_exhausted/429); ' +
  '[tier:paygo] metered, can get expensive (verify credit); [tier:token] plan with daily/weekly quota; ' +
  '(no tag) tier unknown. Only registered/pooled models are listed.';

function formatModelLine(id: string, tier?: string): string {
  return `${id}${tier ? ` [tier:${tier}]` : ''}`;
}

/**
 * Render a per-backend CLI section including profile markers (status, model
 * control, token plan) so the leader knows which CLIs are off, which own
 * their models (informational only), and which have token plans.
 */
function formatCliHeader(name: string, backend: string, profile?: CliProfile): string {
  let tags = '';
  if (profile) {
    if (profile.status === 'off') tags += ' ⚠ off (no active plan)';
    if (profile.modelControl === 'own') tags += ' [own models — informational]';
    else tags += ' [imposed model control]';
    if (profile.tokenPlan) tags += ' [token plan available]';
    if (profile.note) tags += ` (${profile.note})`;
  }
  return `### ${name} (\`${backend}\`)${tags}`;
}

export async function handleListModels(args: Record<string, unknown>): Promise<string> {
  const agentType = typeof args.agent_type === 'string' ? args.agent_type : undefined;

  const [cachedModels, providers, isGoogleAuth, policy] = await Promise.all([
    ProcessConfig.get('acp.cachedModels'),
    getMergedModelProviders(),
    hasGeminiOauthCreds(),
    ProcessConfig.get('teams.modelPolicy'),
  ]);

  const compiled = compileTeamModelPolicy(policy, cachedModels, providers);

  // Surface pool cross-validation warnings so the leader understands why a
  // model it expected is missing (and can move it to explicit catalog if wanted).
  const warnLines = compiled.poolWarnings.map(
    (w) => `- pool ${w.poolId}: ${w.model ?? 'sin modelos avalados'} — ${w.reason}`,
  );
  const warningsBlock = warnLines.length > 0 ? `\n## Pool warnings (cross-validation)\n${warnLines.join('\n')}\n` : '';

  if (agentType) {
    const models = getTeamAvailableModelsFromCompiled(agentType, compiled, cachedModels, providers, isGoogleAuth);
    const profile = compiled.cliProfiles[agentType];
    const header = formatCliHeader(agentType, agentType, profile);
    if (models.length === 0) {
      const base = `No models available for agent type "${agentType}".`;
      if (!policy) return base;
      return `${header}\n\n${base} Add entries to teams.modelPolicy.catalog or a pool in Settings config.${warningsBlock}`;
    }
    const lines = models.map((m) => formatModelLine(m.id, m.tier)).join('\n');
    return `${header}\n\n${TIER_LEGEND}\n${lines}${warningsBlock}`;
  }

  // List models for all team-capable backends.
  const cachedInitResults = await ProcessConfig.get('acp.cachedInitializeResult');
  const detectedAgents = agentRegistry
    .getDetectedAgents()
    .filter((a) => isTeamCapableBackend(a.backend, cachedInitResults));

  if (detectedAgents.length === 0) {
    return 'No team-capable agent types detected.';
  }

  const sections = detectedAgents.map((a) => {
    const models = getTeamAvailableModelsFromCompiled(a.backend, compiled, cachedModels, providers, isGoogleAuth);
    const profile = compiled.cliProfiles[a.backend];
    const modelLines =
      models.length > 0
        ? models.map((m) => formatModelLine(m.id, m.tier)).join('\n')
        : '(no registered models)';
    return `${formatCliHeader(a.name, a.backend, profile)}\n${modelLines}`;
  });

  return `## Available Models by Agent Type\n\n${TIER_LEGEND}\n\n${sections.join('\n\n')}${warningsBlock}`;
}
