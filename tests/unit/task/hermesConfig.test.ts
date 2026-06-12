/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tests for `materializeFluxHermesHome`: the scoped HERMES_HOME that makes a
 * flux-routed hermes spawn select Flux via the literal `custom` provider against
 * the Flux openai surface, with `api_mode: chat_completions` and the bearer read
 * from the FLUX_API_KEY env var at request time. The user's real ~/.hermes config
 * is never touched - only files under the provided userData dir are written.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'fs';
import { readFile, rm } from 'fs/promises';
import { homedir, tmpdir } from 'os';
import { join } from 'path';
import { FLUX_SURFACE } from '@/common/config/flux';
import { materializeFluxHermesHome } from '@process/task/hermesConfig';

const tmpDirs: string[] = [];
afterEach(async () => {
  await Promise.all(tmpDirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function makeUserData(): string {
  const dir = mkdtempSync(join(tmpdir(), 'wl-hermescfg-'));
  tmpDirs.push(dir);
  return dir;
}

describe('materializeFluxHermesHome', () => {
  it('returns <userData>/flux-hermes-home and writes config.yaml there', async () => {
    const userData = makeUserData();
    const dir = await materializeFluxHermesHome(userData);
    expect(dir).toBe(join(userData, 'flux-hermes-home'));
    expect(existsSync(join(dir, 'config.yaml'))).toBe(true);
  });

  it('writes the Flux schema with the default openai surface base_url', async () => {
    const userData = makeUserData();
    const dir = await materializeFluxHermesHome(userData);
    const yaml = await readFile(join(dir, 'config.yaml'), 'utf8');
    expect(yaml).toContain('provider: custom');
    expect(yaml).toContain('default: flux-auto');
    expect(yaml).toContain('api_mode: chat_completions');
    expect(yaml).toContain('key_env: FLUX_API_KEY');
    expect(yaml).toContain(`base_url: ${FLUX_SURFACE.openai}`);
    expect(yaml).toContain('base_url: https://api.fluxrouter.ai/v1');
  });

  it('never writes a raw flux secret into the file (key stays in env)', async () => {
    const userData = makeUserData();
    const dir = await materializeFluxHermesHome(userData);
    const yaml = await readFile(join(dir, 'config.yaml'), 'utf8');
    expect(yaml).not.toContain('sk-flux');
    expect(yaml).not.toContain('sk-');
  });

  it('honors an explicit Flux Desktop daemon base_url', async () => {
    const userData = makeUserData();
    const dir = await materializeFluxHermesHome(userData, 'http://127.0.0.1:7878/v1');
    const yaml = await readFile(join(dir, 'config.yaml'), 'utf8');
    expect(yaml).toContain('base_url: http://127.0.0.1:7878/v1');
    expect(yaml).not.toContain('base_url: https://api.fluxrouter.ai/v1');
  });

  it('writes only under userData - never creates the real ~/.hermes', async () => {
    const userData = makeUserData();
    const realHermes = join(homedir(), '.hermes');
    const existedBefore = existsSync(realHermes);

    await materializeFluxHermesHome(userData);

    // The function must not create ~/.hermes if it was absent.
    if (!existedBefore) {
      expect(existsSync(realHermes)).toBe(false);
    }
  });
});
