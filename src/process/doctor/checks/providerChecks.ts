/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Provider + model-registry Doctor checks.
 *
 * These read the model registry (the same `ProviderRepository` the Models
 * settings page persists to) and re-run the REAL `ConnectionTester` probe — the
 * identical code path the Settings "Test connection" button and the release
 * connect-smoke gate use. This catches the class of breakage that has actually
 * bitten the app: a stale/revoked provider key, a billing wall, a connected
 * provider whose catalog is empty, and credentials that can no longer be
 * decrypted (the headless/keychain-rotation class).
 */

import type { ProviderId } from '@process/providers/types';
import type { RegistryProvider, RegistryCredsResult } from '@process/providers/storage/ProviderRepository';
import type { ConnectionTester } from '@process/providers/detection/ConnectionTester';
import type { DoctorCheckOutcome } from '../types';

/** The slice of `ProviderRepository` these checks read. */
export type ProviderRegistryReader = {
  listRegistryProviders: () => RegistryProvider[];
  getRegistryProviderCreds: (providerId: ProviderId) => RegistryCredsResult;
  countRegistryCatalog: (providerId: ProviderId) => number;
};

/** The connect-probe surface — `ConnectionTester.test` (narrowed for tests). */
export type ConnectProbe = Pick<ConnectionTester, 'test'>;

/** Humanize a provider id into a short label for diagnostic copy. */
function providerLabel(id: ProviderId): string {
  return String(id);
}

/**
 * Pull a single API key out of a decrypted creds record, or `undefined`. Mirrors
 * the field names `ConnectionTester.extractKey` accepts so a keyed provider is
 * probed with a real inference call rather than the degraded auth-only path.
 */
function keyFromCreds(creds: Record<string, unknown>): string | undefined {
  for (const name of ['key', 'apiKey', 'api_key', 'token']) {
    const value = creds[name];
    if (typeof value === 'string' && value.trim().length > 0) return value;
  }
  return undefined;
}

/** Read a custom base URL out of a decrypted creds record, if present. */
function baseUrlFromCreds(creds: Record<string, unknown>): string | undefined {
  const value = creds.baseUrl ?? creds.base_url;
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

/**
 * Provider connectivity — for every connected provider, run the real probe and
 * classify the worst outcome. FAIL on auth/credit/undecryptable errors; WARN on
 * a provider that cannot be probed (no key, offline host) so it is surfaced
 * without crying wolf.
 */
export async function checkProviderConnectivity(
  reader: ProviderRegistryReader,
  probe: ConnectProbe
): Promise<DoctorCheckOutcome> {
  const providers = reader.listRegistryProviders();
  if (providers.length === 0) {
    return {
      status: 'warn',
      detail: 'No providers are connected.',
      remediation: 'Connect at least one provider in Settings → Models so the app can run inference.',
    };
  }

  const failed: string[] = [];
  const warned: string[] = [];
  let okCount = 0;

  for (const provider of providers) {
    const credsResult = reader.getRegistryProviderCreds(provider.providerId);
    if (credsResult.status === 'undecryptable') {
      failed.push(`${providerLabel(provider.providerId)} (credentials unreadable)`);
      continue;
    }
    if (credsResult.status === 'not-found') {
      warned.push(`${providerLabel(provider.providerId)} (no stored credentials)`);
      continue;
    }

    const key = keyFromCreds(credsResult.creds);
    const creds = key
      ? { key }
      : { fields: credsResult.creds as Record<string, string> };
    const result = await probe.test(provider.providerId, creds, baseUrlFromCreds(credsResult.creds));

    if (result.ok) {
      okCount += 1;
      continue;
    }
    // An auth/credit failure is a real, actionable break; an offline/unknown
    // result is "could not verify" — surfaced as a warning, not a failure.
    if (result.error === 'unauthorized' || result.error === 'no-credit' || result.error === 'no-models') {
      failed.push(`${providerLabel(provider.providerId)} (${result.error})`);
    } else {
      warned.push(`${providerLabel(provider.providerId)} (${result.error ?? 'unverified'})`);
    }
  }

  if (failed.length > 0) {
    return {
      status: 'fail',
      detail: `${failed.length} of ${providers.length} provider(s) failed: ${failed.join(', ')}.`,
      remediation: 'Re-enter the key (or top up billing) for the failing provider in Settings → Models.',
    };
  }
  if (warned.length > 0) {
    return {
      status: 'warn',
      detail: `${okCount} provider(s) OK; could not verify: ${warned.join(', ')}.`,
      remediation: 'Check the provider host is reachable and the credentials are present in Settings → Models.',
    };
  }
  return { status: 'pass', detail: `${okCount} of ${providers.length} connected provider(s) passed the live probe.` };
}

/**
 * Model registry sanity — the registry loads and at least one connected
 * provider exposes a usable model. WARN when a connected provider has an empty
 * catalog (the "Connected · No models" class), FAIL when no usable model exists
 * anywhere.
 */
export async function checkModelRegistrySanity(reader: ProviderRegistryReader): Promise<DoctorCheckOutcome> {
  const providers = reader.listRegistryProviders();
  if (providers.length === 0) {
    return {
      status: 'warn',
      detail: 'No providers connected, so the model catalog is empty.',
      remediation: 'Connect a provider in Settings → Models to populate the model catalog.',
    };
  }

  let totalModels = 0;
  const emptyProviders: string[] = [];
  for (const provider of providers) {
    const count = reader.countRegistryCatalog(provider.providerId);
    totalModels += count;
    if (count === 0) emptyProviders.push(providerLabel(provider.providerId));
  }

  if (totalModels === 0) {
    return {
      status: 'fail',
      detail: 'No usable chat models in the registry — every connected provider has an empty catalog.',
      remediation: 'Open Settings → Models and refresh a provider, or reconnect one that lists models.',
    };
  }
  if (emptyProviders.length > 0) {
    return {
      status: 'warn',
      detail: `${totalModels} model(s) available, but ${emptyProviders.length} provider(s) have an empty catalog: ${emptyProviders.join(', ')}.`,
      remediation: 'Refresh the empty provider(s) in Settings → Models, or disconnect them if unused.',
    };
  }
  return { status: 'pass', detail: `${totalModels} model(s) across ${providers.length} connected provider(s).` };
}
