/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { AcpModelInfo } from '@/common/types/acpTypes';
import type { IProvider } from '@/common/config/storage';
import type {
  ModelTier,
  TeamModelPolicy,
  TeamModelPolicyEntry,
  CompiledTeamPolicy,
  TeamPoolWarning,
} from '@/common/types/teamModelPolicy';
import { flattenGeminiModeIds } from '@/common/utils/geminiModes';
import { hasSpecificModelCapability } from '@/common/utils/modelCapabilities';

export type TeamAvailableModel = {
  id: string;
  label: string;
  /** Consumption tier from teams.modelPolicy (free | paygo | token). Undefined = unclassified. */
  tier?: ModelTier;
};

/**
 * Registry-bridge tag stamped on ChatGPT-subscription provider rows
 * (`v2:${CHATGPT_SUBSCRIPTION_PROVIDER_ID}` by envBuilder / legacyModelConfigBridge).
 * Hardcoded because a common-layer util must not import @process.
 */
const CHATGPT_SUBSCRIPTION_BRIDGE_TAG = 'v2:chatgpt-subscription';

function isChatGptSubscriptionProvider(provider: IProvider): boolean {
  return (
    (provider as unknown as Record<string, unknown>).__waylandModelRegistryBridge ===
    CHATGPT_SUBSCRIPTION_BRIDGE_TAG
  );
}

/**
 * Check whether a model passes the capability filter used by the frontend.
 * A model is included when:
 *  - `function_calling` is `true` or `undefined` (unknown = allowed)
 *  - `excludeFromPrimary` is NOT `true`
 */
function passesCapabilityFilter(provider: IProvider, modelName: string): boolean {
  const fc = hasSpecificModelCapability(provider, modelName, 'function_calling');
  if (fc === false) return false;
  const excluded = hasSpecificModelCapability(provider, modelName, 'excludeFromPrimary');
  if (excluded === true) return false;
  return true;
}

/** Does the (compiled) catalog allow a model for a given backend? */
function policyAllowsModel(
  catalog: Record<string, TeamModelPolicyEntry>,
  modelId: string,
  backend: string,
): boolean {
  const entry = catalog[modelId];
  if (!entry) return false;
  if (entry.agentTypes && entry.agentTypes.length > 0) {
    return entry.agentTypes.includes(backend);
  }
  return true;
}

/**
 * Resolve tier for a model. Resolution order:
 *  1. Compiled catalog entry tier
 *  2. tierDefaults keyed by provider bridge tag (e.g. 'groq'), platform (e.g.
 *     'openai-compatible'), then provider name (e.g. 'Groq')
 *  3. undefined (unclassified - leader prompt treats it as unknown)
 */
function resolveModelTier(
  catalog: Record<string, TeamModelPolicyEntry>,
  tierDefaults: Record<string, ModelTier> | undefined,
  modelId: string,
  provider?: IProvider | null,
): ModelTier | undefined {
  const entry = catalog[modelId];
  if (entry?.tier) return entry.tier;
  if (provider && tierDefaults) {
    const bridge = (provider as unknown as Record<string, unknown>).__waylandModelRegistryBridge;
    const bridgeKey =
      typeof bridge === 'string' && bridge.startsWith('v2:') ? bridge.slice(3) : '';
    for (const key of [bridgeKey, provider.platform ?? '', provider.name ?? '']) {
      if (!key) continue;
      const t = tierDefaults[key];
      if (t) return t;
    }
  }
  return undefined;
}

/**
 * v3 curated-list model policy.
 *
 * The effective list is an EXPLICIT OWN LIST built from the policy's
 * `catalog` + `pools`. It is NOT derived from `acp.cachedModels` — those
 * cached lists are dumped from "universal" model registries (hundreds of
 * models per backend, most of which CLIs like Hermes ignore anyway). The
 * cached catalog is only used to VALIDATE that a pay-go model exists
 * (producing warnings), never to add models to the list.
 *
 * Pay-go gate via `entry.active`: a `paygo` model whose `active` is not
 * `true` is NOT listed/offered, so the leader cannot accidentally burn
 * charges. The leader must ask the user before setting `active: true`.
 */
export function compileTeamModelPolicy(
  policy: TeamModelPolicy | null | undefined,
  cachedModels?: Record<string, AcpModelInfo> | null,
  _providers?: IProvider[] | null,
): CompiledTeamPolicy {
  const empty: CompiledTeamPolicy = {
    enabled: false,
    catalog: {},
    cliProfiles: {},
    tierDefaults: undefined,
    poolModelsByAgentType: {},
    poolWarnings: [],
  };
  if (!policy) return empty;

  const catalog: Record<string, TeamModelPolicyEntry> = {};
  for (const [id, entry] of Object.entries(policy.catalog ?? {})) {
    catalog[id] = { ...entry };
  }

  const poolModelsByAgentType: Record<string, Set<string>> = {};
  const poolWarnings: TeamPoolWarning[] = [];

  for (const pool of policy.pools ?? []) {
    for (const at of pool.agentTypes) {
      (poolModelsByAgentType[at] ??= new Set()).add(pool.id);
    }
    for (const model of pool.models ?? []) {
      const existing = catalog[model];
      catalog[model] = {
        ...(existing ? existing : {}),
        tier: pool.tier,
        agentTypes: pool.agentTypes,
        active: existing?.active ?? (pool.tier === 'paygo' ? false : existing?.active),
      };
      // Pay-go existence check only. Never removes a curated model and never
      // adds unreported ones — the own list is authoritative.
      if (pool.tier === 'paygo' && !pool.alwaysAvailable && !modelExistsInCache(cachedModels, model)) {
        poolWarnings.push({
          poolId: pool.id,
          model,
          reason: 'paygo model not found in cached catalog; keep deactivated until user activates it',
        });
      }
    }
  }

  return {
    enabled: true,
    catalog,
    cliProfiles: policy.cliProfiles ?? {},
    tierDefaults: policy.tierDefaults ?? undefined,
    poolModelsByAgentType,
    poolWarnings,
  };
}

function modelExistsInCache(
  cachedModels: Record<string, AcpModelInfo> | null | undefined,
  model: string,
): boolean {
  if (!cachedModels) return false;
  for (const info of Object.values(cachedModels)) {
    if (info?.availableModels?.some((m) => m.id === model)) return true;
  }
  return false;
}

/**
 * Allowed (non-dropped) model ids for a backend, driven by that backend's
 * POOLS, used only in the legacy (no-policy) path. An explicit catalog entry
 * is always additionally allowed (it is a user-registered model, scoped or
 * global). Returns null when the backend has no pools (keep everything the
 * backend reports). Only pools narrow the set.
 */
function allowedIdsForBackend(
  compiled: CompiledTeamPolicy,
  backend: string,
): Set<string> | null {
  const poolSet = compiled.poolModelsByAgentType[backend];
  if (!poolSet || poolSet.size === 0) return null;
  const explicitForBackend = new Set<string>(
    Object.keys(compiled.catalog).filter((id) => policyAllowsModel(compiled.catalog, id, backend)),
  );
  return new Set<string>([...poolSet, ...explicitForBackend]);
}

/**
 * Return the curated own-list entries allowed for a backend.
 *
 * In v3 (policy enabled) this is the single source of truth for what
 * `team_list_models` returns: explicit catalog entries + pool models scoped
 * to the backend. Pay-go models whose `active !== true` are excluded so the
 * leader never offers (and never burns charges on) a model the user has not
 * explicitly activated.
 */
function curatedModelsForBackend(backend: string, compiled: CompiledTeamPolicy): TeamAvailableModel[] {
  const out: TeamAvailableModel[] = [];
  for (const [id, entry] of Object.entries(compiled.catalog)) {
    if (!policyAllowsModel(compiled.catalog, id, backend)) continue;
    if (entry.tier === 'paygo' && entry.active !== true) continue;
    out.push({ id, label: id, tier: entry.tier });
  }
  return out;
}

/**
 * Get the available models for an agent backend in a team context, given an
 * already-compiled policy (compile once per request via compileTeamModelPolicy).
 *
 * v3: when the policy is enabled, returns the curated own-list for the
 * backend (free models always + explicitly-activated pay-go), ignoring the
 * cached universal catalogs.
 *
 * Legacy (no policy configured): preserves the original behavior so existing
 * installs don't see an empty list before opting in.
 */
export function getTeamAvailableModelsFromCompiled(
  backend: string,
  compiled: CompiledTeamPolicy,
  cachedModels: Record<string, AcpModelInfo> | null | undefined,
  providers: IProvider[] | null | undefined,
  isGoogleAuth?: boolean,
): TeamAvailableModel[] {
  if (compiled.enabled) {
    return curatedModelsForBackend(backend, compiled);
  }

  // ---- Legacy path: no team model policy configured ----
  // ACP backends: use the cached model list ACP protocol.
  const acpModelInfo = cachedModels?.[backend];
  if (acpModelInfo?.availableModels && acpModelInfo.availableModels.length > 0) {
    return acpModelInfo.availableModels.map((m) => ({
      id: m.id,
      label: m.label || m.id,
      tier: resolveModelTier(compiled.catalog, compiled.tierDefaults, m.id),
    }));
  }

  // Gemini: Google Auth models (if authenticated) + ALL enabled providers'
  // models, restricted by the backend's pools when defined.
  if (backend === 'gemini') {
    const seen = new Set<string>();
    const merged: TeamAvailableModel[] = [];
    const addModel = (id: string, provider?: IProvider | null) => {
      if (seen.has(id)) return;
      seen.add(id);
      merged.push({
        id,
        label: id,
        tier: resolveModelTier(compiled.catalog, compiled.tierDefaults, id, provider),
      });
    };

    if (isGoogleAuth) {
      for (const id of flattenGeminiModeIds()) {
        addModel(id);
      }
    }

    const enabledProviders = (providers ?? []).filter(
      (p) => p.enabled !== false && p.model?.length && !isChatGptSubscriptionProvider(p),
    );
    for (const p of enabledProviders) {
      for (const m of p.model || []) {
        if (p.modelEnabled?.[m] !== false && passesCapabilityFilter(p, m)) {
          addModel(m, p);
        }
      }
    }

    const allow = allowedIdsForBackend(compiled, 'gemini');
    return allow ? merged.filter((m) => allow.has(m.id)) : merged;
  }

  // Wcore: all enabled providers' enabled models (deduplicated), excluding the
  // google-auth platform, restricted by the backend's pools when defined.
  if (backend === 'wcore') {
    const seen = new Set<string>();
    const result: TeamAvailableModel[] = [];
    const enabledProviders = (providers ?? []).filter(
      (p) =>
        p.enabled !== false && p.model?.length && !p.platform?.includes('gemini-with-google-auth'),
    );
    for (const provider of enabledProviders) {
      for (const m of provider.model) {
        if (provider.modelEnabled?.[m] !== false && !seen.has(m) && passesCapabilityFilter(provider, m)) {
          seen.add(m);
          result.push({
            id: m,
            label: m,
            tier: resolveModelTier(compiled.catalog, compiled.tierDefaults, m, provider),
          });
        }
      }
    }
    const allow = allowedIdsForBackend(compiled, 'wcore');
    return allow ? result.filter((m) => allow.has(m.id)) : result;
  }

  return [];
}

/**
 * Backward-compatible entry point: compiles the policy once and delegates.
 * Callers that also need poolWarnings / cliProfiles should compile once via
 * compileTeamModelPolicy and use getTeamAvailableModelsFromCompiled.
 */
export function getTeamAvailableModels(
  backend: string,
  cachedModels: Record<string, AcpModelInfo> | null | undefined,
  providers: IProvider[] | null | undefined,
  isGoogleAuth?: boolean,
  policy?: TeamModelPolicy | null,
): TeamAvailableModel[] {
  const compiled = compileTeamModelPolicy(policy, cachedModels, providers);
  return getTeamAvailableModelsFromCompiled(backend, compiled, cachedModels, providers, isGoogleAuth);
}


/**
 * Resolve the default model id for a backend.
 *  1. User's preferred model for the backend (acpConfig.preferredModelId)
 *  2. Cached current model from last ACP session (currentModelId)
 *  3. undefined
 */
export function getTeamDefaultModelId(
  backend: string,
  cachedModels: Record<string, AcpModelInfo> | null | undefined,
  acpConfig: Record<string, { preferredModelId?: string } | undefined> | null | undefined,
): string | undefined {
  // 1. User's preferred model for backend
  const preferred = acpConfig?.[backend]?.preferredModelId;
  if (preferred) return preferred;
  // 2. Cached current model from last ACP session
  const cached = cachedModels?.[backend]?.currentModelId;
  if (cached) return cached;
  return undefined;
}

/**
 * Resolve a friendly display label for a model.
 *
 * Lookup order:
 *  1. ACP cachedModels[backend].availableModels match on id, return its label
 *  2. Fall back to the raw model id
 * Synchronous: expects the data already fetched.
 */
export function resolveTeamModelLabel(
  modelId: string | undefined,
  backend: string,
  cachedModels: Record<string, AcpModelInfo> | null | undefined,
): string {
  if (!modelId) return '(default)';
  const acpModels = cachedModels?.[backend]?.availableModels;
  if (acpModels) {
    const match = acpModels.find((m) => m.id === modelId);
    if (match?.label) return match.label;
  }
  return modelId;
}
