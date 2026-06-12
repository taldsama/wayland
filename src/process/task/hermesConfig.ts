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
 * and `api_mode` MUST be `chat_completions`. hermes reads its bearer from the
 * `FLUX_API_KEY` env var at request time (via the `key_env` field), so no key is
 * written into this file (R13-safe: the secret stays out of config).
 *
 * `userDataDir` is the app's userData path (the caller passes
 * `app.getPath('userData')`); kept as a parameter so this stays unit-testable
 * without importing electron here.
 */
export async function materializeFluxHermesHome(
  userDataDir: string,
  baseURL: string = FLUX_SURFACE.openai
): Promise<string> {
  const hermesHomeDir = join(userDataDir, 'flux-hermes-home');
  const configPath = join(hermesHomeDir, 'config.yaml');
  const content = [
    '# Wayland-managed HERMES_HOME for Flux-routed hermes spawns.',
    "# Selects Flux within this scoped home; the user's real ~/.hermes config is",
    '# never modified. Regenerated on each Flux-routed spawn. The flux key is read',
    '# from the FLUX_API_KEY env var at request time (R13-safe: no secret in file).',
    'model:',
    `  default: ${FLUX_AUTO_MODEL}`,
    '  provider: custom',
    `  base_url: ${baseURL}`,
    '  api_mode: chat_completions',
    '  key_env: FLUX_API_KEY',
    'providers: {}',
    '',
  ].join('\n');

  await mkdir(hermesHomeDir, { recursive: true });
  await writeFile(configPath, content, 'utf8');
  return hermesHomeDir;
}
