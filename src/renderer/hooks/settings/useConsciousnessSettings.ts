import { useCallback, useState } from 'react';

export type ConsciousnessMode = '2d' | 'three';
export type ConsciousnessFps = 60 | 30;

export type ConsciousnessSettings = {
  mode: ConsciousnessMode;
  rotation: boolean;
  fps: ConsciousnessFps;
};

const STORAGE_KEY = 'wayland.consciousness.settings';

const DEFAULTS: ConsciousnessSettings = {
  mode: '2d',
  rotation: true,
  fps: 60,
};

function load(): ConsciousnessSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULTS;
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ConsciousnessSettings>) };
  } catch {
    return DEFAULTS;
  }
}

function save(settings: ConsciousnessSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
}

export function useConsciousnessSettings() {
  const [settings, setSettings] = useState<ConsciousnessSettings>(load);

  const update = useCallback(
    <K extends keyof ConsciousnessSettings>(key: K, value: ConsciousnessSettings[K]) => {
      setSettings((prev) => {
        const next = { ...prev, [key]: value };
        save(next);
        return next;
      });
    },
    []
  );

  return { settings, update };
}
