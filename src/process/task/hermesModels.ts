/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { ACP_BACKENDS_ALL, type AcpBackendAll, type AcpModelInfo } from '@/common/types/acpTypes';
import { hermesHome } from '@process/services/import/migration/hermesSource';
import { existsSync, readFileSync } from 'fs';
import yaml from 'js-yaml';
import { join } from 'path';

type HermesFallbackProvider = {
  provider?: string;
  model?: string;
};

type HermesConfig = {
  model?: { default?: string; provider?: string };
  fallback_providers?: HermesFallbackProvider[];
  model_catalog?: { url?: string };
};

type ModelCatalog = {
  providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>;
};

const MAX_AVAILABLE_MODELS = 30;

/** Extract the profile name from a hermes backend's acpArgs (['acp','--profile','secretaria']). */
function profileNameForBackend(backend: string): string | null {
  const config = ACP_BACKENDS_ALL[backend as AcpBackendAll];
  const args = config?.acpArgs;
  if (!args) return null;
  const idx = args.indexOf('--profile');
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1] ?? null;
}

function parseHermesConfig(configPath: string): HermesConfig | null {
  if (!existsSync(configPath)) return null;
  try {
    const parsed = yaml.load(readFileSync(configPath, 'utf8'), { schema: yaml.CORE_SCHEMA });
    if (!parsed || typeof parsed !== 'object') return null;
    return parsed as HermesConfig;
  } catch {
    return null;
  }
}

function readModelCatalog(catalogUrl: string | undefined): Array<{ provider: string; id: string; label: string }> {
  if (!catalogUrl || !catalogUrl.startsWith('file://')) return [];
  const catalogPath = catalogUrl.slice('file://'.length);
  if (!existsSync(catalogPath)) return [];
  try {
    const catalog = JSON.parse(readFileSync(catalogPath, 'utf8')) as ModelCatalog;
    const models: Array<{ provider: string; id: string; label: string }> = [];
    for (const [provider, entry] of Object.entries(catalog.providers ?? {})) {
      for (const model of entry.models ?? []) {
        if (model.id) models.push({ provider, id: model.id, label: model.name || model.id });
      }
    }
    return models;
  } catch {
    return [];
  }
}

function readProviderModelsCache(home: string): Record<string, string[]> {
  const cachePath = join(home, 'provider_models_cache.json');
  if (!existsSync(cachePath)) return {};
  try {
    const raw = JSON.parse(readFileSync(cachePath, 'utf8')) as Record<
      string,
      { models?: string[] } | string[] | undefined
    >;
    const out: Record<string, string[]> = {};
    for (const [provider, entry] of Object.entries(raw)) {
      const models = Array.isArray(entry) ? entry : (entry?.models ?? []);
      out[provider] = models.filter((m): m is string => typeof m === 'string');
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Map a fallback entry's shorthand model id to an id hermes can actually route.
 * set_model for an id absent from every provider catalog falls back to the
 * default provider and 401s, so prefer the exact id, then a catalog id that
 * extends the shorthand (gemini-3.1-flash-lite -> gemini-3.1-flash-lite-preview).
 */
function resolveFallbackModelId(
  provider: string | undefined,
  model: string | undefined,
  cache: Record<string, string[]>
): string | undefined {
  if (!model) return undefined;
  const providerKey = provider?.split(':')[0] ?? '';
  const catalog = cache[providerKey] ?? cache[provider ?? ''];
  if (!catalog?.length) return model;
  if (catalog.includes(model)) return model;
  return catalog.find((id) => id.startsWith(`${model}-`) || id.endsWith(model)) ?? model;
}

/**
 * Encode a model choice the way hermes' ACP set_session_model expects:
 * "provider:model" (or "custom:name:model" for named custom endpoints).
 * A bare model id would stay on the session's current provider, mis-routing
 * the request (e.g. a gemini model sent to the custom endpoint → HTTP 401).
 */
function encodeModelChoice(provider: string | undefined, model: string): string {
  const p = provider?.trim().toLowerCase();
  return p ? `${p}:${model}` : model;
}

/**
 * Read hermes' native model configuration and build an AcpModelInfo for the ACP
 * model picker. Hermes does not advertise models via the ACP session/new API, so
 * its switchable catalog is derived offline from the profile config.yaml
 * (model.default + fallback_providers) plus the model catalog JSON referenced by
 * model_catalog.url. Returns null when the config is missing or has no model.
 */
export function readHermesModelInfo(backend: string): AcpModelInfo | null {
  const home = hermesHome();
  const profile = profileNameForBackend(backend);

  const mainConfig = parseHermesConfig(join(home, 'config.yaml'));
  const profileConfig = profile ? parseHermesConfig(join(home, 'profiles', profile, 'config.yaml')) : null;
  const config = profileConfig ?? mainConfig;
  const currentModel = config?.model?.default;
  if (!currentModel) return null;

  const defaultProvider = config.model?.provider ?? mainConfig?.model?.provider;

  const seen = new Set<string>();
  const availableModels: Array<{ id: string; label: string }> = [];
  const addModel = (provider: string | undefined, model: string | undefined) => {
    if (!model) return;
    const id = encodeModelChoice(provider, model);
    if (seen.has(id)) return;
    seen.add(id);
    const providerTag = provider?.trim().toLowerCase();
    availableModels.push({ id, label: providerTag ? `${model} — ${providerTag}` : model });
  };

  addModel(defaultProvider, currentModel);

  const cache = readProviderModelsCache(home);
  const fallbacks = config.fallback_providers?.length
    ? config.fallback_providers
    : (mainConfig?.fallback_providers ?? []);
  for (const fb of fallbacks) addModel(fb.provider, resolveFallbackModelId(fb.provider, fb.model, cache));

  for (const model of readModelCatalog(config.model_catalog?.url ?? mainConfig?.model_catalog?.url)) {
    addModel(model.provider, model.id);
  }

  if (availableModels.length === 0) return null;

  const currentId = encodeModelChoice(defaultProvider, currentModel);
  return {
    currentModelId: currentId,
    currentModelLabel: availableModels.find((m) => m.id === currentId)?.label ?? currentModel,
    availableModels: availableModels.slice(0, MAX_AVAILABLE_MODELS),
    canSwitch: true,
    source: 'models',
    sourceDetail: 'hermes-config',
  };
}
