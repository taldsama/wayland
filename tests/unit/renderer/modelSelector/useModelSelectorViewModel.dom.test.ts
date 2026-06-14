/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CuratedModel } from '@process/providers/types';
import { useModelSelectorViewModel } from '@renderer/components/model/modelSelector/useModelSelectorViewModel';

const mockCuratedForAgent = vi.fn();
const mockUseFluxConnected = vi.fn();
const mockUsePinnedModels = vi.fn();
const mockQueryRecent = vi.fn();

vi.mock('@renderer/hooks/useModelRegistry', () => ({
  useModelRegistry: () => ({ curatedForAgent: mockCuratedForAgent, registryVersion: 0 }),
}));

vi.mock('@renderer/hooks/useFluxConnected', () => ({
  useFluxConnected: () => mockUseFluxConnected(),
}));

vi.mock('@renderer/hooks/usage/usePinnedModels', () => ({
  pinKey: (providerId: string, modelId: string) => `${providerId}:${modelId}`,
  usePinnedModels: () => mockUsePinnedModels(),
}));

vi.mock('@renderer/hooks/usage/useRecentlyUsedModels', () => ({
  useRecentlyUsedModels: () => mockQueryRecent(),
}));

const model = (over: Partial<CuratedModel>): CuratedModel => ({
  id: 'm',
  providerId: 'anthropic',
  displayName: 'M',
  family: 'claude',
  kind: 'text',
  enriched: true,
  tags: [],
  recommended: false,
  enabled: true,
  ...over,
});

const opus = model({
  id: 'claude-opus-4-8',
  displayName: 'Opus 4.8',
  contextWindow: 200000,
  recommended: true,
  role: 'flagship',
});
const sonnet = model({ id: 'claude-sonnet-4-5', displayName: 'Sonnet 4.5', contextWindow: 200000 });

describe('useModelSelectorViewModel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUsePinnedModels.mockReturnValue({ pinned: new Set<string>(), toggle: vi.fn() });
    mockQueryRecent.mockReturnValue({ models: [], loading: false });
    mockUseFluxConnected.mockReturnValue(false);
    mockCuratedForAgent.mockResolvedValue([]);
  });

  it('composes flux hero + pinned + recommended zones when connected', async () => {
    mockCuratedForAgent.mockResolvedValue([opus, sonnet]);
    mockUseFluxConnected.mockReturnValue(true);
    mockUsePinnedModels.mockReturnValue({ pinned: new Set(['anthropic:claude-opus-4-8']), toggle: vi.fn() });

    const { result } = renderHook(() => useModelSelectorViewModel('wcore'));

    // Flux makes `empty` false immediately; wait for the async curated load to
    // land before asserting on provider zones.
    await waitFor(() => expect(result.current.zones.length).toBeGreaterThan(0));

    expect(result.current.fluxHero?.id).toBe('flux-auto');
    expect(result.current.zones.find((z) => z.id === 'pinned')?.rows.map((r) => r.key)).toContain(
      'anthropic:claude-opus-4-8'
    );
    const recommended = result.current.zones.find((z) => z.id.startsWith('recommended'));
    expect(recommended?.rows.some((r) => r.id === 'claude-opus-4-8')).toBe(true);
    expect(result.current.empty).toBe(false);
  });

  it('is empty when no provider connected and flux disconnected', async () => {
    mockCuratedForAgent.mockResolvedValue([]);
    mockUseFluxConnected.mockReturnValue(false);

    const { result } = renderHook(() => useModelSelectorViewModel('wcore'));

    await waitFor(() => expect(result.current.empty).toBe(true));
    expect(result.current.fluxHero).toBeUndefined();
    expect(result.current.zones).toEqual([]);
  });

  it('marks effortSupported for codex/wcore/claude only', async () => {
    mockCuratedForAgent.mockResolvedValue([opus]);
    const { result: wcore } = renderHook(() => useModelSelectorViewModel('wcore'));
    await waitFor(() => expect(wcore.current.zones.length).toBeGreaterThan(0));
    expect(wcore.current.effortSupported).toBe(true);

    const { result: gemini } = renderHook(() => useModelSelectorViewModel('gemini'));
    await waitFor(() => expect(gemini.current.zones.length).toBeGreaterThan(0));
    expect(gemini.current.effortSupported).toBe(false);
  });

  it('resolves activeKey from the passed current model key', async () => {
    mockCuratedForAgent.mockResolvedValue([opus, sonnet]);
    const { result } = renderHook(() => useModelSelectorViewModel('wcore', 'anthropic:claude-sonnet-4-5'));
    await waitFor(() => expect(result.current.zones.length).toBeGreaterThan(0));
    expect(result.current.activeKey).toBe('anthropic:claude-sonnet-4-5');
  });
});
