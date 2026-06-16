/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from 'vitest';
import type { IProvider } from '@/common/config/storage';
import {
  resolveActiveModelKey,
  resolveSelectedProvider,
} from '@renderer/components/model/modelSelector/resolveSelectedProvider';

const BRIDGE_TAG_KEY = '__waylandModelRegistryBridge';

/** Minimal provider fixture; only the fields the resolver reads matter. */
const provider = (over: Partial<IProvider>): IProvider =>
  ({
    id: 'storage-id',
    platform: 'openai',
    name: 'Provider',
    baseUrl: '',
    apiKey: '',
    model: [],
    enabled: true,
    ...over,
  }) as IProvider;

/** Stand-in for useModelProviderList's getAvailableModels: returns provider.model. */
const getAvailableModels = (p: IProvider): string[] => p.model ?? [];

describe('resolveSelectedProvider', () => {
  it('resolves a non-Flux model by membership when the flyout providerId (registry id) does not match the storage provider.id', () => {
    // Regression for #99/#102/#103/#104: the flyout emits the registry
    // ProviderId ('openai'), which is NOT the opaque storage provider.id, so a
    // pure id match returned undefined and the click was silently dropped.
    const openai = provider({ id: 'prov_a1b2', platform: 'openai', model: ['gpt-5.3', 'gpt-5.3-mini'] });
    const anthropic = provider({ id: 'prov_c3d4', platform: 'anthropic', model: ['claude-sonnet-4'] });

    const resolved = resolveSelectedProvider([anthropic, openai], getAvailableModels, 'gpt-5.3', 'openai');

    expect(resolved).toBe(openai);
  });

  it('prefers an exact storage id match when registry and storage ids align', () => {
    const a = provider({ id: 'openai', platform: 'openai', model: ['gpt-5.3'] });
    const b = provider({ id: 'other', platform: 'openai', model: ['gpt-5.3'] });

    // Both offer the model; the exact id wins over the membership fallback.
    const resolved = resolveSelectedProvider([b, a], getAvailableModels, 'gpt-5.3', 'openai');

    expect(resolved).toBe(a);
  });

  it('resolves a Flux routing alias by its flux-* catalog, ignoring providerId', () => {
    const flux = provider({ id: 'flux_opaque', platform: 'flux-router', model: ['flux-auto', 'flux-fast'] });
    const openai = provider({ id: 'prov_a1b2', platform: 'openai', model: ['gpt-5.3'] });

    const resolved = resolveSelectedProvider([openai, flux], getAvailableModels, 'flux-auto', 'flux-router');

    expect(resolved).toBe(flux);
  });

  it('matches a Flux alias even when getAvailableModels would filter the tiers out (non-function-calling)', () => {
    // Flux tiers are not function_calling models, so getAvailableModels() can
    // return []. The Flux branch must match on the raw provider.model catalog.
    const flux = provider({ id: 'flux_opaque', platform: 'flux-router', model: ['flux-auto'] });

    const resolved = resolveSelectedProvider([flux], () => [], 'flux-auto', 'flux-router');

    expect(resolved).toBe(flux);
  });

  it('returns undefined when no connected provider offers the model', () => {
    const openai = provider({ id: 'prov_a1b2', platform: 'openai', model: ['gpt-5.3'] });

    const resolved = resolveSelectedProvider([openai], getAvailableModels, 'grok-4', 'xai');

    expect(resolved).toBeUndefined();
  });
});

describe('resolveActiveModelKey (#124)', () => {
  it('recovers the registry ProviderId from the owning bridge row tag', () => {
    // The flyout keys rows by the registry ProviderId. The selection carries the
    // opaque legacy storage id, but the bridge row tags itself with the registry
    // id - so the active key must be `<registryProviderId>:<model>`, not
    // `<storageId>:<model>`.
    const gemini = provider({ id: 'prov_x', platform: 'gemini', [BRIDGE_TAG_KEY]: 'v2:google-gemini' } as Partial<IProvider>);
    const key = resolveActiveModelKey([gemini], { id: 'prov_x', useModel: 'gemini-3-pro-preview' });
    expect(key).toBe('google-gemini:gemini-3-pro-preview');
  });

  it('falls back to the legacy id when the owning row is untagged (non-bridge provider)', () => {
    const custom = provider({ id: 'prov_y', platform: 'openai-compatible', model: ['my-model'] });
    const key = resolveActiveModelKey([custom], { id: 'prov_y', useModel: 'my-model' });
    expect(key).toBe('prov_y:my-model');
  });

  it('keys a Flux routing alias off the canonical flux-router id, ignoring the selection id', () => {
    const key = resolveActiveModelKey([], { id: 'flux_opaque', useModel: 'flux-auto' });
    expect(key).toBe('flux-router:flux-auto');
  });

  it('returns null when nothing is selected', () => {
    expect(resolveActiveModelKey([], undefined)).toBeNull();
    expect(resolveActiveModelKey([], { id: 'x', useModel: undefined })).toBeNull();
  });

  it('falls back to the legacy id when the owner is not in model.config yet', () => {
    const key = resolveActiveModelKey(undefined, { id: 'prov_z', useModel: 'gpt-5.4' });
    expect(key).toBe('prov_z:gpt-5.4');
  });
});
