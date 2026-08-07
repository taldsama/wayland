/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Team model policy: explicit model catalog the team leader is allowed to
 * offer, consumption tiers, optional authoring "pools" (named model groups
 * per backend), plus per-CLI profiles (own-model control, token plans).
 *
 * Motivation: ACP backends (CLI agents such as Hermes profiles) report their
 * ENTIRE model catalog at initialize (e.g. 448+ models incl. OpenRouter /
 * copilot / omniroute dumps), so the team leader proposes models the user
 * never registered in Wayland. This policy is the single source of truth for
 * what `team_list_models` returns and what `team_spawn_agent` accepts.
 */

export type ModelTier = 'free' | 'paygo' | 'token';

export interface TeamModelPolicyEntry {
  /** Consumption tier:free (rate-limited)paygo (metered, costly)token (quota-based plan). */
  tier: ModelTier;
  /**
   * Pay-go gating. false (default deactivated)a paygo model is NOT listed
   * offered. Leader must ask user before activating (avoids accidental
   * charges). Once activated user here true.
   */
  active?: boolean;
  /**
   * Optional: restrict model specific agent types/backends
   * (CLI-specific models, e.g. omniroute route only makes sense the
   * CLI owns it). Absent any agent type reports it.
   */
  agentTypes?: string[];
}

export type CliStatus = 'active' | 'off';
export type ModelControl = 'own' | 'imposed';

export interface CliProfile {
  /**
   * active -> recommended normally. off -> NOT recommended; the leader may
   * remind the user that the CLI exists but has no active token plan, so
   * they keep hitting limited free tiers. Pre-configured as a reminder.
   */
  status: CliStatus;
  /**
   * own -> the CLI uses its OWN model list and ignores models Wayland imposes
   * (Hermes profiles, kiro). Its pool list is INFORMATIONAL (validated against
   * what it reports); the leader does not fight it; spawn is soft (warn).
   * imposed -> the CLI accepts the model Wayland picks (wcore/gemini/BYOK);
   * spawn validation is STRICT.
   */
  modelControl: ModelControl;
  /** Whether CLI offersquota (token)plan. Drives "activate plan" reminder. */
  tokenPlan: boolean;
  /**
   * Model source modelControl. byok CLI only runs user-provided
   * API models (gemini/openrouter/omniroute). own CLI only uses its
   * OWN bundled model list ignores BYOK (hermes config.yaml, kiro,
   * copilot). hybrid accepts its own models AND BYOK (opencode).
   */
  source?: 'byok' | 'own' | 'hybrid';
  /** Pool ids apply CLI. */
  pools?: string[];
  note?: string;
}

export interface TeamModelPool {
  /**
   * Stable id (canonical across installs for API pools; per-install for
   * omniroute combos). The leader and templates reference pools by id.
   */
  id: string;
  label?: string;
  tier: ModelTier;
  /** Backends this pool's models are offered for (e.g. gemini, wcore, openrouter, kiro...). */
  agentTypes: string[];
  /**
   * Models in the pool. Cross-validated at compile time against what the
   * backends actually report today; unreported models are excluded with a
   * warning (unless the same id is in the explicit `catalog`).
   */
  models: string[];
  /** rotate -> on resource_exhausted, leader/teammate may advance to the next model. */
  fallback?: 'rotate';
  note?: string;
  /**
   * True -> skip cross-validation (keep even if not currently reported).
   * Intended for stable aliases such as "openrouter/free".
   */
  alwaysAvailable?: boolean;
}

export interface TeamModelPolicy {
  /**
   * Explicit allowlist: modelId -> tier (+ optional agent-type scoping).
   * Always honored (user/manual validation = authority). ACP backends only
   * source models the CLI reports AND that are listed here; unreported or
   * unlisted models are never offered (kills the full-catalog dump).
   */
  catalog: Record<string, TeamModelPolicyEntry>;
  /** Authoring layer: named model groups, compiled (flattened) into `catalog`. */
  pools?: TeamModelPool[];
  /** Per-CLI metadata: status, own-vs-imposed model control, token plans. */
  cliProfiles?: Record<string, CliProfile>;
  /**
   * Default tier per provider platform, provider name, or registry bridge tag
   * (e.g. 'groq' -> free, 'openrouter' -> paygo, 'copilot' -> token).
   * Resolution order: catalog entry > tierDefaults[bridgeTag] >
   * tierDefaults[platform] > tierDefaults[name] > undefined (no tag shown).
   */
  tierDefaults?: Record<string, ModelTier>;
}

export interface TeamPoolWarning {
  poolId: string;
  /** model id that was excluded (undefined = whole pool skipped). */
  model?: string;
  reason: string;
}

export interface CompiledTeamPolicy {
  /** false when no policy was provided (legacy unfiltered behavior). */
  enabled: boolean;
  /** Flattened catalog: explicit entries + cross-validated pool models. */
  catalog: Record<string, TeamModelPolicyEntry>;
  cliProfiles: Record<string, CliProfile>;
  tierDefaults: Record<string, ModelTier> | undefined;
  /** Models contributed by pools, keyed by agent type (for gemini/wcore filtering). */
  poolModelsByAgentType: Record<string, Set<string>>;
  poolWarnings: TeamPoolWarning[];
}

export const EMPTY_TEAM_MODEL_POLICY: TeamModelPolicy = {
  catalog: {},
  pools: [],
  cliProfiles: {},
  tierDefaults: {},
};

/**
 * Canonical install template: same pool ids across every install so the
 * leader, templates and the setup agent all speak the same names. The setup
 * agent fills `models` per install from what each backend actually reports.
 */
export const DEFAULT_TEAM_MODEL_POLICY_TEMPLATE: TeamModelPolicy = {
  catalog: {},
  pools: [
    {
      id: 'gemini-api-free',
      label: 'Gemini API (free)',
      tier: 'free',
      agentTypes: ['gemini', 'wcore'],
      models: [],
      note: 'Por instalación, ej. gemini-3.1-flash-lite, gemini-3.5-flash-lite',
    },
    {
      id: 'openrouter-free',
      label: 'OpenRouter free',
      tier: 'free',
      agentTypes: ['openrouter'],
      models: [],
      fallback: 'rotate',
      alwaysAvailable: true,
      note: 'Ej. nvidia/*:free + alias estable openrouter/free',
    },
    { id: 'omniroute-combo-1', label: 'Omniroute Combo 1', tier: 'free', agentTypes: ['omniroute'], models: [], fallback: 'rotate' },
    { id: 'omniroute-combo-2', label: 'Omniroute Combo 2', tier: 'free', agentTypes: ['omniroute'], models: [], fallback: 'rotate' },
    { id: 'omniroute-combo-3', label: 'Omniroute Combo 3', tier: 'free', agentTypes: ['omniroute'], models: [], fallback: 'rotate' },
    { id: 'opencode-free', label: 'Opencode free', tier: 'free', agentTypes: ['opencode'], models: [], fallback: 'rotate' },
    { id: 'openrouter-paygo', label: 'OpenRouter paygo (escogidos)', tier: 'paygo', agentTypes: ['openrouter'], models: [] },
  ],
  cliProfiles: {
    kiro: { status: 'off', modelControl: 'own', tokenPlan: true, pools: ['omniroute-combo-1', 'omniroute-combo-2', 'omniroute-combo-3'] },
    omniroute: { status: 'off', modelControl: 'own', tokenPlan: false, pools: ['omniroute-combo-1', 'omniroute-combo-2', 'omniroute-combo-3'] },
    opencode: { status: 'off', modelControl: 'imposed', tokenPlan: true, pools: ['opencode-free'] },
    claude: { status: 'off', modelControl: 'own', tokenPlan: true, pools: [] },
    codex: { status: 'off', modelControl: 'own', tokenPlan: true, pools: [] },
    gemini: { status: 'active', modelControl: 'imposed', tokenPlan: true, pools: ['gemini-api-free'] },
    wcore: { status: 'active', modelControl: 'imposed', tokenPlan: false, pools: ['gemini-api-free'] },
    openrouter: { status: 'active', modelControl: 'imposed', tokenPlan: true, pools: ['openrouter-free', 'openrouter-paygo'] },
  },
  tierDefaults: {
    groq: 'free',
    'tool:groq': 'free',
    'google-gemini': 'token',
    gemini: 'token',
    agnesai: 'paygo',
    'openai-compatible': 'paygo',
    openrouter: 'paygo',
    copilot: 'token',
    omniroute: 'free',
  },
};
