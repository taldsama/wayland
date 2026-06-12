/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { FLUX_AUTO_MODEL, FLUX_SURFACE } from '@/common/config/flux';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Materialize a Wayland-scoped HERMES_HOME for flux-routed hermes spawns and
 * return its directory path. The directory carries a self-contained
 * `config.yaml` that selects Flux within this scoped home (top-level
 * `model.provider = "custom"` pointed at the Flux surface). Pointing HERMES_HOME
 * at this dir (only for flux-routed spawns) makes hermes route through Flux
 * WITHOUT modifying the user's real `~/.hermes` config - native model picks keep
 * using the user's own config.
 *
 * The provider id MUST be the literal `custom` (hermes rejects an invented name)
 * and `api_mode` MUST be `chat_completions`.
 *
 * The flux key is written INLINE on the model block (`api_key`). This is required,
 * not a shortcut: hermes resolves a `custom` provider's key from config / its auth
 * store, NOT from a `FLUX_API_KEY` env var, so a `key_env` reference is ignored and
 * hermes falls back to a stale stored token (proven live against hermes v0.14.0 +
 * the Flux proxy: env/key_env -> HTTP 401 token_not_found; inline api_key -> 200,
 * and the inline key wins even when the scoped home carries a bootstrapped
 * auth.json). The key only lives in this app-private, ephemeral userData file
 * (regenerated each spawn), never the user's real ~/.hermes config.
 *
 * `userDataDir` is the app's userData path (the caller passes
 * `app.getPath('userData')`); kept as a parameter so this stays unit-testable
 * without importing electron here. `fluxKey` is the connected Flux key
 * (`ctx.fluxKey`, the same value injected as FLUX_API_KEY for other backends).
 */
export async function materializeFluxHermesHome(
  userDataDir: string,
  fluxKey: string,
  baseURL: string = FLUX_SURFACE.openai
): Promise<string> {
  const hermesHomeDir = join(userDataDir, 'flux-hermes-home');
  const configPath = join(hermesHomeDir, 'config.yaml');
  const content = [
    '# Wayland-managed HERMES_HOME for Flux-routed hermes spawns.',
    "# Selects Flux within this scoped home; the user's real ~/.hermes config is",
    '# never modified. Regenerated on each Flux-routed spawn. The key is written',
    '# inline because hermes ignores key_env for a custom provider (see source).',
    'model:',
    `  default: ${FLUX_AUTO_MODEL}`,
    '  provider: custom',
    `  base_url: ${baseURL}`,
    '  api_mode: chat_completions',
    `  api_key: '${fluxKey.replace(/'/g, "''")}'`,
    'providers: {}',
    '',
  ].join('\n');

  await mkdir(hermesHomeDir, { recursive: true });
  await writeFile(configPath, content, 'utf8');
  return hermesHomeDir;
}
