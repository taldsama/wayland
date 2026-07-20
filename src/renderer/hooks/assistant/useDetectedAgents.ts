import { ipcBridge } from '@/common';
import { DETECTED_AGENTS_SWR_KEY, fetchDetectedAgents } from '@/renderer/utils/model/agentTypes';
import type { AvailableAgent } from '@/renderer/utils/model/agentTypes';
import { useCallback, useMemo } from 'react';
import useSWR, { mutate } from 'swr';

/**
 * Preset agent types that are known to be team-capable but are excluded by
 * the !isPreset filter in availableBackends. We re-add them so that the team
 * backend picker can offer them as candidates (#152).
 */
const KNOWN_TEAM_CAPABLE_PRESETS = [
  'hermes',
  'hermes-dev',
  'hermes-secretaria',
  'hermes-homelab-ops',
  'hermes-default',
];

export type AvailableBackend = {
  id: string;
  name: string;
  isExtension?: boolean;
};

/**
 * Provides detected execution engines for backend selectors (e.g. AssistantEditDrawer).
 * Excludes preset assistants - those live in ConfigStorage('assistants').
 *
 * Returns `availableBackends` (simplified shape for Select dropdowns)
 * and `refreshAgentDetection` to trigger a re-scan.
 */
export const useDetectedAgents = () => {
  const { data: rawAgents = [] } = useSWR<AvailableAgent[]>(DETECTED_AGENTS_SWR_KEY, fetchDetectedAgents);

  const availableBackends = useMemo<AvailableBackend[]>(
    () => {
      // Start with detected non-preset agents
      const detected = rawAgents
        .filter((a) => !a.isPreset && a.backend !== 'remote')
        .map((a) => ({
          id: a.backend,
          name: a.name,
          isExtension: a.isExtension,
        }));

      // Re-add known team-capable presets that were filtered out above.
      // Their backend ids are the presetAgentType values.
      const presetBackends: AvailableBackend[] = KNOWN_TEAM_CAPABLE_PRESETS.map((id) => ({
        id,
        name: `Hermes (${id})`,
      }));

      // Merge: detected agents first, then presets (deduplicated by id)
      const seen = new Set(detected.map((b) => b.id));
      for (const pb of presetBackends) {
        if (!seen.has(pb.id)) {
          detected.push(pb);
          seen.add(pb.id);
        }
      }

      return detected;
    },
    [rawAgents]
  );

  const refreshAgentDetection = useCallback(async () => {
    try {
      await ipcBridge.acpConversation.refreshCustomAgents.invoke();
      await mutate(DETECTED_AGENTS_SWR_KEY);
    } catch {
      // ignore
    }
  }, []);

  return {
    availableBackends,
    refreshAgentDetection,
  };
};
