import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useConsciousnessSettings } from '@/renderer/hooks/settings/useConsciousnessSettings';
import { CanvasCore } from './cores/CanvasCore';
import { STATE_CONFIG } from './cores/types';
import type { VoiceState } from './cores/types';

const ThreeCore = React.lazy(() => import('./cores/ThreeCore'));

const SUBTITLE_FADE_MS = 700;
const THINKING_SAFETY_MS = 30000;

const CORE_NODES = [
  { id: 'HERMES CORE', color: '#89b4fa', desc: 'Voice Core / Dispatcher' },
  { id: 'SOL MIND', color: '#f9e2af', desc: 'Homelab & Infra Agent' },
  { id: 'LUNA MIND', color: '#cba6f7', desc: 'Dev & Coding Specialist' },
  { id: 'ECHO CORE', color: '#f38ba8', desc: 'Proactive Secretariat' },
];

const dockBtn = (active: boolean) =>
  `px-3.5 py-1.5 rounded-full text-[11px] font-bold tracking-widest border transition-all duration-200 ${
    active
      ? 'text-[#89dceb] bg-[#89dceb]/10 border-[#89dceb]/40 shadow-[0_0_12px_rgba(137,220,235,0.25)]'
      : 'text-[#a6adc8] bg-transparent border-transparent hover:text-[#cdd6f4] hover:bg-[#313244]/50'
  }`;

export const ConsciousnessPage: React.FC = () => {
  const navigate = useNavigate();
  const [activeCore, setActiveCore] = useState('HERMES CORE');

  const { settings, update } = useConsciousnessSettings();

  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const voiceStateRef = useLatestRef(voiceState);

  const [subtitleText, setSubtitleText] = useState('');
  const [subtitleVisible, setSubtitleVisible] = useState(false);

  const holdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const thinkingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showSubtitle = useCallback((text: string) => {
    if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
    if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setSubtitleText(text);
    setSubtitleVisible(true);
    setVoiceState('speaking');
    const holdMs = Math.min(9000, 2500 + text.length * 40);
    holdTimerRef.current = setTimeout(() => {
      setSubtitleVisible(false);
      fadeTimerRef.current = setTimeout(() => {
        setSubtitleText('');
        setVoiceState('idle');
      }, SUBTITLE_FADE_MS);
    }, holdMs);
  }, []);

  const applyVoiceState = useCallback((state: VoiceState) => {
    if (thinkingTimerRef.current) {
      clearTimeout(thinkingTimerRef.current);
      thinkingTimerRef.current = null;
    }
    setVoiceState(state);
    if (state === 'thinking') {
      thinkingTimerRef.current = setTimeout(() => setVoiceState('idle'), THINKING_SAFETY_MS);
    }
  }, []);

  // SSE de voz (independiente del core activo; no se reconecta al cambiar de modo)
  useEffect(() => {
    let eventSource: EventSource | null = null;
    const handleMessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'speech' && data.text) {
          showSubtitle(data.text);
        } else if (data.type === 'state' && data.state && data.state in STATE_CONFIG) {
          applyVoiceState(data.state as VoiceState);
        }
      } catch {
        /* ignore json parse error */
      }
    };
    try {
      eventSource = new EventSource('/api/voice/events');
      eventSource.addEventListener('message', handleMessage);
    } catch {
      console.warn('SSE voice listener disabled or unavailable');
    }

    return () => {
      if (eventSource) {
        eventSource.removeEventListener('message', handleMessage);
        eventSource.close();
      }
      if (holdTimerRef.current) clearTimeout(holdTimerRef.current);
      if (fadeTimerRef.current) clearTimeout(fadeTimerRef.current);
      if (thinkingTimerRef.current) clearTimeout(thinkingTimerRef.current);
    };
  }, [showSubtitle, applyVoiceState]);

  // Si WebGL no está disponible, caer al núcleo 2D
  const handleFallback = useCallback(() => {
    update('mode', '2d');
  }, [update]);

  return (
    <div className="relative w-full h-full bg-[#11111b] text-[#cdd6f4] flex flex-col justify-between overflow-hidden font-sans select-none">
      {/* Top Header Bar Sci-Fi */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-[#313244] bg-[#181825]/80 backdrop-blur">
        <div className="flex items-center space-x-4">
          <span className="text-[#a6e3a1] font-mono text-xs font-bold tracking-widest flex items-center">
            <span className="w-2 h-2 rounded-full bg-[#a6e3a1] animate-ping mr-2"></span>
            STATUS: ONLINE (CONSCIOUSNESS HUD)
          </span>
          <span className="text-[#89b4fa] font-mono text-xs font-bold px-3 py-1 bg-[#313244] rounded-full border border-[#45475a]">
            CORE: {activeCore}
          </span>
          {/* Semáforo de debug: refleja el voiceState actual (recibido por SSE) */}
          <span className="flex items-center space-x-1.5 font-mono text-[10px] px-3 py-1 bg-[#1e1e2e] rounded-full border border-[#45475a]">
            <span
              title="idle"
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                voiceState === 'idle' ? 'bg-[#a6e3a1] shadow-[0_0_8px_#a6e3a1]' : 'bg-[#313244]'
              }`}
            />
            <span
              title="thinking"
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                voiceState === 'thinking' ? 'bg-[#cba6f7] shadow-[0_0_8px_#cba6f7]' : 'bg-[#313244]'
              }`}
            />
            <span
              title="speaking"
              className={`w-2.5 h-2.5 rounded-full transition-all ${
                voiceState === 'speaking' ? 'bg-[#89b4fa] shadow-[0_0_8px_#89b4fa]' : 'bg-[#313244]'
              }`}
            />
            <span className="text-[#a6adc8] uppercase tracking-widest">{voiceState}</span>
          </span>
        </div>

        {/* Botonera de Menú Navegación Directa a Wayland */}
        <div className="flex items-center space-x-2 overflow-x-auto">
          <button
            onClick={() => navigate('/teams')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#cba6f7] border border-[#cba6f7]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>👥 TEAMS</span>
          </button>
          <button
            onClick={() => navigate('/projects')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#f9e2af] border border-[#f9e2af]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>📁 PROJECTS</span>
          </button>
          <button
            onClick={() => navigate('/workflows')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#a6e3a1] border border-[#a6e3a1]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>⚡ WORKFLOWS</span>
          </button>
          <button
            onClick={() => navigate('/goal')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#fab387] border border-[#fab387]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>🎯 GOALS</span>
          </button>
          <button
            onClick={() => navigate('/memory')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#89dceb] border border-[#89dceb]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>🧠 MEMORY</span>
          </button>
          <button
            onClick={() => navigate('/conversations')}
            className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#f5c2e7] border border-[#f5c2e7]/40 rounded-md text-xs font-bold transition flex items-center space-x-1"
          >
            <span>📜 CARDS GRID</span>
          </button>
          <button
            onClick={() => navigate('/guid')}
            className="px-3 py-1.5 bg-[#89b4fa] hover:bg-[#b4befe] text-[#11111b] rounded-md text-xs font-extrabold transition shadow-lg shadow-[#89b4fa]/20 flex items-center space-x-1"
          >
            <span>💬 CHAT</span>
          </button>
          <button
            onClick={() => navigate('/settings')}
            className="p-1.5 bg-[#1e1e2e] hover:bg-[#313244] text-[#cdd6f4] border border-[#45475a] rounded-md text-xs font-bold transition"
            title="Settings"
          >
            <span>⚙️</span>
          </button>
        </div>
      </div>

      {/* Main Center Area with Core Canvas and Overlay Floating Text */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center">
        {settings.mode === '2d' ? (
          <CanvasCore voiceStateRef={voiceStateRef} rotation={settings.rotation} fps={settings.fps} />
        ) : (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center text-[#89dceb] font-mono text-sm tracking-widest">
                CARGANDO NÚCLEO ELABORADO...
              </div>
            }
          >
            <ThreeCore
              voiceStateRef={voiceStateRef}
              rotation={settings.rotation}
              fps={settings.fps}
              onFallback={handleFallback}
            />
          </React.Suspense>
        )}

        {/* Dynamic Floating Subtitle Box with Glassmorphism (fade in/out) */}
        <div
          className={`absolute top-12 left-12 max-w-lg p-6 bg-[#181825]/70 backdrop-blur-md border border-[#89b4fa]/30 rounded-2xl shadow-2xl transition-all duration-700 ${
            subtitleVisible ? 'opacity-100 translate-y-0' : 'opacity-0 -translate-y-2 pointer-events-none'
          }`}
        >
          <div className="text-xs font-mono text-[#89b4fa] tracking-widest mb-1 font-bold">HERMES VOICE RESPONSE</div>
          <p className="text-xl font-medium leading-relaxed text-[#cdd6f4]">"{subtitleText}"</p>
        </div>

        {/* Right Core Selector Nodes (Maqueta Foto 3) */}
        <div className="absolute right-12 top-1/4 flex flex-col space-y-4">
          {CORE_NODES.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveCore(item.id)}
              className={`flex items-center space-x-3 p-3 rounded-xl border transition-all duration-300 text-left ${
                activeCore === item.id
                  ? 'bg-[#313244]/90 border-[#89b4fa] scale-105 shadow-lg shadow-[#89b4fa]/20'
                  : 'bg-[#181825]/50 border-[#313244] hover:bg-[#1e1e2e]'
              }`}
            >
              <div className="w-4 h-4 rounded-full shadow-inner" style={{ backgroundColor: item.color }} />
              <div>
                <div className="text-xs font-bold font-mono text-[#cdd6f4]">{item.id}</div>
                <div className="text-[10px] text-[#a6adc8]">{item.desc}</div>
              </div>
            </button>
          ))}
        </div>

        {/* Dock de controles visuales (modo / rotación / fps) */}
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 bg-[#0f172a]/75 backdrop-blur-md border border-[#45475a]/60 rounded-full px-3 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
          <button onClick={() => update('mode', '2d')} className={dockBtn(settings.mode === '2d')}>
            SIMPLE
          </button>
          <button onClick={() => update('mode', 'three')} className={dockBtn(settings.mode === 'three')}>
            ELABORADO
          </button>
          <div className="w-px h-5 bg-[#45475a]/60 mx-1" />
          <button onClick={() => update('rotation', !settings.rotation)} className={dockBtn(settings.rotation)}>
            ROTACIÓN: {settings.rotation ? 'ON' : 'OFF'}
          </button>
          <button onClick={() => update('fps', settings.fps === 60 ? 30 : 60)} className={dockBtn(settings.fps === 60)}>
            FPS: {settings.fps}
          </button>
        </div>
      </div>

      {/* Bottom Status & Audio Wave Bar */}
      <div className="px-6 py-3 border-t border-[#313244] bg-[#181825]/90 backdrop-blur flex items-center justify-between">
        <div className="text-xs font-mono text-[#a6adc8]">
          Hermes-Kokoro HTTP API Server: <span className="text-[#a6e3a1]">Connected (127.0.0.1:8642)</span>
        </div>
        <div className="flex items-center space-x-2 text-xs font-mono text-[#89dceb]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#89dceb] animate-pulse" />
          <span>Realtime Voice Streaming Ready</span>
        </div>
      </div>
    </div>
  );
};

export default ConsciousnessPage;
