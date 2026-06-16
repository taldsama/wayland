/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IProvider, TProviderWithModel } from '@/common/config/storage';
import { useModelProviderList } from '@/renderer/hooks/agent/useModelProviderList';
import { isFluxModelId } from '@/common/config/flux';
import { useCallback, useEffect, useMemo, useState } from 'react';

export type WCoreModelSelection = {
  currentModel?: TProviderWithModel;
  providers: IProvider[];
  getAvailableModels: (provider: IProvider) => string[];
  handleSelectModel: (provider: IProvider, modelName: string) => Promise<void>;
  getDisplayModelName: (modelName?: string) => string;
};

export type UseAionrsModelSelectionOptions = {
  initialModel: TProviderWithModel | undefined;
  onSelectModel: (provider: IProvider, modelName: string) => Promise<boolean>;
};

export const useWCoreModelSelection = ({
  initialModel,
  onSelectModel,
}: UseAionrsModelSelectionOptions): WCoreModelSelection => {
  const [currentModel, setCurrentModel] = useState<TProviderWithModel | undefined>(initialModel);

  useEffect(() => {
    setCurrentModel(initialModel);
  }, [initialModel?.id, initialModel?.useModel]);

  const { providers: allProviders, getAvailableModels, formatModelLabel } = useModelProviderList();

  // WaylandCLI does not support Google Auth - filter it out
  const providers = useMemo(
    () => allProviders.filter((p) => !p.platform?.toLowerCase().includes('gemini-with-google-auth')),
    [allProviders]
  );

  // #64: drop a stale selection whose provider was disconnected/removed (the
  // composer otherwise keeps showing a dead model like "gpt-5.5" that fails on
  // send). flux-auto is exempt: the Flux Router provider is intentionally
  // filtered out of `providers` (no function_calling models) yet is always a
  // valid route, so never treat a flux id as stale.
  //
  // #124: validate by MODEL MEMBERSHIP across all connected providers, not by
  // `provider.id`. A freshly-spawned chat carries the model registry's
  // ProviderId (e.g. 'openai'), which never equals the opaque legacy storage
  // `provider.id`, so an id-only match wrongly cleared a perfectly valid model -
  // blanking the picker and blocking sends until a manual reselect. When the
  // model is still offered but under a different (registry) id, re-bind to the
  // owning legacy provider so send resolves real credentials.
  useEffect(() => {
    if (!currentModel) return;
    if (currentModel.useModel && isFluxModelId(currentModel.useModel)) return;
    const useModel = currentModel.useModel ?? '';
    const owner =
      providers.find((p) => p.id === currentModel.id && getAvailableModels(p).includes(useModel)) ??
      providers.find((p) => getAvailableModels(p).includes(useModel));
    if (!owner) {
      setCurrentModel(undefined);
    } else if (owner.id !== currentModel.id) {
      setCurrentModel({ ...(owner as unknown as TProviderWithModel), useModel });
    }
  }, [providers, currentModel, getAvailableModels]);

  const handleSelectModel = useCallback(
    async (provider: IProvider, modelName: string) => {
      const selected = {
        ...(provider as unknown as TProviderWithModel),
        useModel: modelName,
      } as TProviderWithModel;
      const ok = await onSelectModel(provider, modelName);
      if (ok) {
        setCurrentModel(selected);
      }
    },
    [onSelectModel]
  );

  const getDisplayModelName = useCallback(
    (modelName?: string) => {
      if (!modelName) return '';
      const label = formatModelLabel(currentModel, modelName);
      const maxLength = 20;
      return label.length > maxLength ? `${label.slice(0, maxLength)}...` : label;
    },
    [currentModel, formatModelLabel]
  );

  return {
    currentModel,
    providers,
    getAvailableModels,
    handleSelectModel,
    getDisplayModelName,
  };
};
