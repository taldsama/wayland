import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { useConsciousnessSettings } from '@/renderer/hooks/settings/useConsciousnessSettings';
import { useLayoutContext } from '@/renderer/hooks/context/LayoutContext';
import CanvasCore from './cores/CanvasCore';
import { NavDock } from './components/NavDock';
import { STATE_CONFIG } from './cores/types';
import type { VoiceState } from './cores/types';

const ThreeCore = React.lazy(() => import('./cores/ThreeCore'));

const SUBTITLE_FADE_MS = 700;
const THINKING_SAFETY_MS = 30000;

const CORE_NODES = [
 { id: 'HERMES CORE', color: '#7f93b8', desc: 'Voice Core / Dispatcher' },
 { id: 'SOL MIND', color: '#e3c98c', desc: 'Homelab Infra Agent' },
 { id: 'LUNA MIND', color: '#a89fc4', desc: 'Dev Coding Specialist' },
 { id: 'ECHO CORE', color: '#c08e9c', desc: 'Proactive Secretariat' },
];

const dockBtn = (active: boolean) =>
 `px-3.5 py-1.5 rounded-full text-[11px] font-bold tracking-widest border transition-all duration-200 ${
    active
      ? 'text-[#f0b429] bg-[#f0b429]/10 border-[#f0b429]/40 shadow-[0_0_12px_rgba(240,180,41,0.25)]'
      : 'text-[#a8b6c9] bg-transparent border-transparent hover:text-[#e8eef7] hover:bg-[#3e4c5e]/50'
  }`;

export const ConsciousnessPage: React.FC = () => {
 const navigate = useNavigate();
 const [activeCore, setActiveCore] = useState('HERMES CORE');

 const layoutCtx = useLayoutContext();

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
    <div className="relative w-full h-full bg-[#141b26] text-[#e8eef7] flex flex-col justify-between overflow-hidden font-sans select-none">
    {/* Top Header Bar Sci-Fi */}
    <div className="flex items-center justify-between px-6 py-4 border-b border-[#2a3547] bg-[#1b2330]/80 backdrop-blur">
        <div className="flex items-center space-x-4">
          <span className="text-[#f5c26b] font-mono text-xs font-bold tracking-widest flex items-center">
          <span className="w-2 h-2 rounded-full bg-[#f5c26b] animate-ping mr-2"></span>
          STATUS:ONLINE (CONSCIOUSNESS HUD)
          </span>
          <span className="text-[#e8eef7] font-mono text-xs font-bold px-3 py-1 bg-[#3e4c5e] rounded-full border border-[#55677f]">
          CORE: {activeCore}
          </span>
          {/* Semáforo debug: refleja voiceState actual (recibido por SSE)*/}
          <span className="flex items-center space-x-1.5 font-mono text-[10px] px-3 py-1 bg-[#232c3b] rounded-full border border-[#55677f]">
          <span
          title="idle"
          className={`w-2.5 h-2.5 rounded-full transition-all ${
                         voiceState === 'idle' ? 'bg-[#c9a45c] shadow-[0_0_8px_#c9a45c]' : 'bg-[#313244]'
                       }`}
          />
          <span
          title="thinking"
          className={`w-2.5 h-2.5 rounded-full transition-all ${
                         voiceState === 'thinking' ? 'bg-[#e0951f] shadow-[0_0_8px_#e0951f]' : 'bg-[#313244]'
                       }`}
          />
          <span
          title="speaking"
          className={`w-2.5 h-2.5 rounded-full transition-all ${
                         voiceState === 'speaking' ? 'bg-[#dfe7f2] shadow-[0_0_8px_#dfe7f2]' : 'bg-[#313244]'
                       }`}
          />
          <span className="text-[#a8b6c9] uppercase tracking-widest">{voiceState}</span>
          </span>
        </div>

        {/* TEMPORAL (Fase A1 debug): abre el sider actual para inspeccionar qué rescatar antes de eliminarlo (A3). */}
        <button
          onClick={() => layoutCtx?.setSiderCollapsed(false)}
          title="Temporal: abre el menú de navegación actual (sider) para inspeccionar antes de su eliminación definitiva"
          className="px-3 py-1.5 bg-[#1e1e2e] hover:bg-[#3e4c5e] text-[#f0b429] border border-dashed border-[#f0b429]/60 rounded-md text-xs font-bold transition flex items-center space-x-1 shrink-0"
        >
          <span>⚙ MENÚ DEBUG</span>
        </button>

        {/* Navegación integrada (Fase A2): NavDock data-driven con SEARCH + MISSION CONTROL placeholder */}
        <NavDock />
        </div>

      {/* Main Center Area with Core Canvas and Overlay Floating Text */}
      <div className="relative flex-1 w-full h-full flex items-center justify-center">
        {settings.mode === '2d' ? (
          <CanvasCore voiceStateRef={voiceStateRef} rotation={settings.rotation} fps={settings.fps} />
        ) : (
          <React.Suspense
            fallback={
              <div className="absolute inset-0 flex items-center justify-center text-[#dfe7f2] font-mono text-sm tracking-widest">
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
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 z-50 flex items-center gap-1.5 bg-[#1b2330]/75 backdrop-blur-md border border-[#55677f]/60 rounded-full px-3 py-1.5 shadow-[0_10px_30px_rgba(0,0,0,0.5)]">
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
      <div className="px-6 py-3 border-t border-[#2a3547] bg-[#1b2330]/90 backdrop-blur flex items-center justify-between">
      <div className="text-xs font-mono text-[#a8b6c9]">
      Hermes-Kokoro HTTP API Server: <span className="text-[#f5c26b]">Connected (127.0.0.1:8642)</span>
      </div>
      <div className="flex items-center space-x-2 text-xs font-mono text-[#dfe7f2]">
      <span className="w-1.5 h-1.5 rounded-full bg-[#f0b429] animate-pulse" />
          <span>Realtime Voice Streaming Ready</span>
        </div>
      </div>
    </div>
  );
};

export default ConsciousnessPage;
