/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */
import { FLUX_AUTO_MODEL, FLUX_SURFACE, isFluxModelId } from '@/common/config/flux';
import { PROVIDER_ENV_VARS } from '@process/providers/detection/KeyDiscovery';

/** Every native provider key var (OPENROUTER_API_KEY, GROQ_API_KEY, ...) -- stripped
 *  before applying the Flux surface so a flux-routed spawn is mutually exclusive. */
const NATIVE_PROVIDER_KEY_VARS: string[] = Array.from(
  new Set(Object.values(PROVIDER_ENV_VARS).flat().filter(Boolean) as string[])
);

/**
 * Per-backend ENV that, injected at spawn, makes a generic ACP backend route
 * through Flux WITHOUT writing any CLI config file (R13-safe). Every entry gets
 * the shared OPENAI_* surface (added in `resolveFluxRouting`); the value here is
 * the EXTRA, backend-specific env that selects the openai-compatible provider +
 * the flux-auto model for that particular CLI.
 *
 * Membership = empirically verified against a local OpenAI-compatible capture
 * server (2026-06-05), each confirmed to send `flux-auto` and return an answer:
 *
 *  - qwen: the shared OPENAI_BASE_URL + OPENAI_MODEL=flux-auto is enough; it
 *    posts to `/v1/chat/completions`. (No extra env.)
 *  - goose: also needs GOOSE_PROVIDER=openai + GOOSE_MODEL=flux-auto, otherwise
 *    it bails with "No provider configured" and never reads OPENAI_BASE_URL.
 *
 * Shared caveat: a CLI whose own config already pins an openai baseUrl/provider
 * may let the config win over these env vars (verified for an existing
 * `~/.qwen/settings.json`). That is additive/safe - the backend runs natively,
 * never stranded or rewritten - so the common clean-config user still gets Flux.
 *
 * NOT here, by design:
 *  - opencode / qoder: openai-capable but cannot be pointed at Flux env-only
 *    (opencode defaults to a non-openai provider + rejects flux-auto from its
 *    catalog; qoder routes through its own login). They need the config-writing
 *    setup assistant (backup -> write flux provider -> report -> rollback).
 *  - droid / auggie / copilot / kiro / vibe: vendor-locked to their own service
 *    (Factory / Augment / GitHub / AWS / Mistral); not Flux-routable. They stay
 *    native and the routing badge says so.
 *  - codex / codebuddy: openai/responses-surface npx backends, routing handled
 *    separately (codex uses the responses surface; not in this set).
 *
 * claude is NOT here either: it routes via the Anthropic surface, tracked in the
 * separate `ANTHROPIC_FLUX_BACKENDS` set below.
 */
const BACKEND_FLUX_ENV: Record<string, Record<string, string>> = {
  qwen: {},
  goose: { GOOSE_PROVIDER: 'openai', GOOSE_MODEL: FLUX_AUTO_MODEL },
};

/** Generic ACP backends that route through Flux via R13-safe env injection. */
export const GENERIC_FLUX_BACKENDS = Object.keys(BACKEND_FLUX_ENV) as readonly string[];

/**
 * Backends that route through the Anthropic surface (R1) instead of the OpenAI
 * one. claude's npx ACP bridge speaks the Anthropic wire protocol: it honors
 * ANTHROPIC_BASE_URL + ANTHROPIC_AUTH_TOKEN and POSTs to `<base>/v1/messages`
 * (empirically proven 2026-06-05). It is kept separate from the OpenAI-surface
 * generic backends because the env it emits is ANTHROPIC_*, not OPENAI_*.
 */
export const ANTHROPIC_FLUX_BACKENDS = ['claude'] as const;

/**
 * Backends that route through the Responses surface (R1). codex's CLI POSTs
 * `model=flux-auto` to `<base_url>/v1/responses` and reads its bearer from the
 * `FLUX_API_KEY` env var (empirically proven against the real codex CLI +
 * capture server, 2026-06-05). codex cannot be pointed at Flux by env alone:
 * it needs a `[model_providers.flux]` table (written by the codex connector)
 * plus `model_provider = "flux"` selected. Selection is done per-spawn via a
 * Wayland-scoped CODEX_HOME (materialized by AcpAgentManager) so the user's
 * global config is never pinned to flux. The routing decision here only emits
 * the `FLUX_API_KEY` the codex CLI reads at request time and strips native
 * OpenAI/Codex keys for mutual exclusivity.
 */
export const RESPONSES_FLUX_BACKENDS = ['codex'] as const;

/**
 * Backends that route through Flux via a Wayland-scoped config HOME (R13-safe)
 * rather than env alone. hermes speaks the OpenAI chat_completions surface but
 * cannot be pointed at Flux by env: it selects its provider from
 * `<HERMES_HOME>/config.yaml` (`model.provider = "custom"`, `base_url` = the
 * Flux openai surface, `api_mode = "chat_completions"`, `key_env =
 * FLUX_API_KEY`). The scoped HERMES_HOME is materialized + injected per-spawn by
 * AcpAgentManager (mirroring codex's CODEX_HOME), so the user's real ~/.hermes
 * config is never pinned to flux. The routing decision here only emits the
 * `FLUX_API_KEY` hermes reads at request time and strips native provider keys
 * for mutual exclusivity. Proven end-to-end against hermes v0.14.0 (2026-06-12).
 */
export const SCOPED_HOME_FLUX_BACKENDS = ['hermes'] as const;

/**
 * Native codex/OpenAI key vars stripped before a flux-routed codex spawn, so it
 * never also carries the user's native credentials (mutual exclusivity).
 * FLUX_API_KEY is deliberately NOT here.
 */
const NATIVE_CODEX_KEY_VARS = ['OPENAI_API_KEY', 'CODEX_API_KEY'] as const;

/** Native Anthropic env vars stripped before applying the Flux anthropic surface. */
const NATIVE_ANTHROPIC_KEY_VARS = [
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
] as const;

export type RoutingDecision = 'flux' | 'native' | 'unknown';

export type FluxRoutingContext = {
  backend: string;
  selectedModelId: string | undefined;
  fluxConnected: boolean;
  fluxKey: string | undefined;
  routeThroughFlux: boolean;
};

export type FluxRoutingResult = {
  routing: RoutingDecision;
  env: Record<string, string>;
  stripKeys: string[];
};

const NATIVE = (): FluxRoutingResult => ({ routing: 'native', env: {}, stripKeys: [] });
const UNKNOWN = (): FluxRoutingResult => ({ routing: 'unknown', env: {}, stripKeys: [] });

/**
 * Single precedence rule (R5): per-chat flux model > global toggle > native.
 * Mutual exclusivity: flux env replaces (never co-exists with) the native
 * OPENAI key. Backends not on the generic list resolve 'unknown' (we cannot
 * apply the surface to them in Phase 1) so the routing badge tells the truth.
 */
export function resolveFluxRouting(_ctx: FluxRoutingContext): FluxRoutingResult {
  // Flux routing is permanently disabled. All agents execute natively using
  // their own CLI configs or provider keys. The Flux banner and toggle have
  // been hidden from the UI; this function always returns NATIVE so no agent
  // is ever routed through Flux regardless of any persisted toggle state.
  return NATIVE();
}
