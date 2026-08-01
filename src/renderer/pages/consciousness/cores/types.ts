import type React from 'react';

export type VoiceState = 'idle' | 'listening' | 'thinking' | 'speaking';

export interface StateConfig {
  speed: number;
  pulse: number;
  agitation: number;
  glow: number;
  ringColor: string;
  ringAlpha: number;
  ringWidth: number;
}

export const STATE_CONFIG: Record<VoiceState, StateConfig> = {
  idle: { speed: 0.012, pulse: 0, agitation: 6, glow: 0.06, ringColor: '#fbbf24', ringAlpha: 0.35, ringWidth: 1 },
  listening: { speed: 0.03, pulse: 5, agitation: 10, glow: 0.12, ringColor: '#6ee7b7', ringAlpha: 0.6, ringWidth: 1.5 },
  // thinking: rápido, caótico, violeta — "sinapsis disparándose"
  thinking: { speed: 0.07, pulse: 3, agitation: 24, glow: 0.14, ringColor: '#c084fc', ringAlpha: 0.7, ringWidth: 1.5 },
  // speaking: lento, respiración profunda, azul brillante — "emisión de voz"
  speaking: { speed: 0.035, pulse: 22, agitation: 5, glow: 0.28, ringColor: '#89b4fa', ringAlpha: 0.9, ringWidth: 2.5 },
};

export interface CoreProps {
  voiceStateRef: React.MutableRefObject<VoiceState>;
  rotation: boolean;
  fps: 60 | 30;
}
