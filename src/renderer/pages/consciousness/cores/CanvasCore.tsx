import React, { useEffect, useRef } from 'react';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import { STATE_CONFIG } from './types';
import type { CoreProps } from './types';

interface Particle {
  x: number;
  y: number;
  z: number;
  r: number;
  color: string;
  speed: number;
  noise: number;
}

export const CanvasCore: React.FC<CoreProps> = ({ voiceStateRef, rotation, fps }) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rotationRef = useLatestRef(rotation);
  const fpsRef = useLatestRef(fps);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;
    let time = 0;
    let orbit = 0;
    let lastFrameTime = performance.now();

    const colors = ['#5f7190', '#8a9bb5', '#f0b429', '#f5c26b', '#4e6178', '#6b7c96'];
    const particles: Particle[] = [];
    const count = 1600;

    for (let i = 0; i < count; i++) {
      const u = Math.random() * 2 - 1;
      const v = Math.random() * 2 - 1;
      const s = u * u + v * v;
      if (s >= 1 || s === 0) continue;
      const factor = 2 * Math.sqrt(1 - s);
      const radius = 30 + Math.random() * 210;

      particles.push({
        x: u * factor * radius,
        y: v * factor * radius,
        z: (1 - 2 * s) * radius,
        r: radius,
        color: colors[Math.floor(Math.random() * colors.length)],
        speed: (Math.random() - 0.5) * 0.02,
        noise: Math.random() * Math.PI * 2,
      });
    }

    const anim = {
      speed: STATE_CONFIG.idle.speed,
      pulse: STATE_CONFIG.idle.pulse,
      agitation: STATE_CONFIG.idle.agitation,
      glow: STATE_CONFIG.idle.glow,
      ringAlpha: STATE_CONFIG.idle.ringAlpha,
      ringWidth: STATE_CONFIG.idle.ringWidth,
      ringBoost: 0,
    };

    const render = (now: number) => {
      animationFrameId = requestAnimationFrame(render);

      // FPS limiter (60/30)
      const frameInterval = 1000 / fpsRef.current;
      const delta = now - lastFrameTime;
      if (delta < frameInterval - 1) return;
      lastFrameTime = now - (delta % frameInterval);

      const state = voiceStateRef.current;
      const target = STATE_CONFIG[state];
      const k = 0.06;
      anim.speed += (target.speed - anim.speed) * k;
      anim.pulse += (target.pulse - anim.pulse) * k;
      anim.agitation += (target.agitation - anim.agitation) * k;
      anim.glow += (target.glow - anim.glow) * k;
      anim.ringAlpha += (target.ringAlpha - anim.ringAlpha) * k;
      anim.ringWidth += (target.ringWidth - anim.ringWidth) * k;
      const targetRingBoost = state === 'speaking' ? 12 : 0;
      anim.ringBoost += (targetRingBoost - anim.ringBoost) * k;

      time += anim.speed;
      // La órbita solo avanza si la rotación está activada (toggle anti-mareo)
      if (rotationRef.current) orbit += anim.speed;

      const width = (canvas.width = canvas.parentElement?.clientWidth || window.innerWidth);
      const height = (canvas.height = canvas.parentElement?.clientHeight || window.innerHeight);
      const cx = width / 2;
      const cy = height / 2;

      ctx.clearRect(0, 0, width, height);

      const grad = ctx.createRadialGradient(cx, cy, 30, cx, cy, 320);
      grad.addColorStop(0, `rgba(240, 180, 41, ${anim.glow})`);
      grad.addColorStop(0.5, 'rgba(24, 30, 40, 0.95)');
      grad.addColorStop(1, '#0f141d');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(cx, cy);

      const talkPulse = Math.sin(time * 8) * anim.pulse;

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        const rotY = orbit * 0.4 + p.speed;
        const rx = p.x * Math.cos(rotY) - p.z * Math.sin(rotY);
        const rz = p.x * Math.sin(rotY) + p.z * Math.cos(rotY);

        const scale = 300 / (300 + rz);
        const px = rx * scale;
        const py = (p.y + Math.sin(time * 2 + p.noise) * anim.agitation + talkPulse) * scale;
        const pSize = Math.max(0.8, 2.2 * scale * (0.8 + Math.sin(time * 3 + p.noise) * 0.3));
        const alpha = Math.min(1.0, Math.max(0.2, (rz + 250) / 500));

        ctx.fillStyle = p.color;
        ctx.globalAlpha = alpha;
        ctx.beginPath();
        ctx.arc(px, py, pSize, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.globalAlpha = anim.ringAlpha;
      ctx.strokeStyle = target.ringColor;
      ctx.lineWidth = anim.ringWidth;
      ctx.setLineDash([6, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, 160 + Math.sin(time * 2) * 5 + anim.ringBoost, 0, Math.PI * 2);
      ctx.stroke();

      ctx.restore();
    };

    render(performance.now());

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
    };
  }, [voiceStateRef]);

  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />;
};

export default CanvasCore;
