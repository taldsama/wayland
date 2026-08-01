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
 // Paleta A5: gris-azulado + dorado/ámbar + blanco.
 // idle: oro apagado, calma
 idle: { speed: 0.012, pulse: 0, agitation: 6, glow: 0.06, ringColor: '#c9a45c', ringAlpha: 0.35, ringWidth: 1 },
 // listening: ámbar (recepción STT)
 listening: { speed: 0.03, pulse: 5, agitation: 10, glow: 0.12, ringColor: '#f0b429', ringAlpha: 0.6, ringWidth: 1.5 },
 // thinking: ámbar intenso, caótico, "sinapsis disparándose"
 thinking: { speed: 0.07, pulse: 3, agitation: 24, glow: 0.14, ringColor: '#e0951f', ringAlpha: 0.7, ringWidth: 1.5 },
 // speaking: blanco-gris azulado brillante, respiración profunda "emisión voz"
 speaking: { speed: 0.035, pulse: 22, agitation: 5, glow: 0.28, ringColor: '#dfe7f2', ringAlpha: 0.9, ringWidth: 2.5 },
};

export interface CoreProps {
  voiceStateRef: React.MutableRefObject<VoiceState>;
  rotation: boolean;
  fps: 60 | 30;
}
