import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { useLatestRef } from '@/renderer/hooks/ui/useLatestRef';
import type { CoreProps } from './types';

interface ThreeCoreProps extends CoreProps {
  onFallback: () => void;
}

function hexToVec3(hex: string): THREE.Vector3 {
  const n = parseInt(hex.slice(1), 16);
  return new THREE.Vector3(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

const CONFIG = {
  bgColor: '#0d1322',
  atmoColor: '#a5f3fc',
  atmoCount: 60,
  atmoSize: 18,
  pointSize: 55,
  brightness: 1.45,
  repelRadius: 0.727,
  repelStrength: 3.3,
};

const VERTEX_SHADER = `
  uniform float uTime; uniform float uSize;
  uniform vec3 uCursor; uniform float uRepelRadius; uniform float uRepelStrength; uniform float uActivity;

  attribute float aScale;
  attribute float aNoise;
  attribute float aLayerType;
  attribute vec3 aLayerColor;

  varying vec3 vColor;

  void main() {
    vec3 pos = position;
    float rBase = length(pos);

    float phi = atan(pos.y, pos.x);
    float theta = acos(clamp(pos.z / (rBase + 0.0001), -1.0, 1.0));

    if (aLayerType < -0.5) {
      float pulse = sin(uTime * 2.0 + aNoise * 6.28) * 0.06;
      pos *= (1.0 + pulse);
    }
    else if (aLayerType > 0.5 && aLayerType < 1.5) {
      float spike = pow(abs(cos(4.0 * phi) * sin(4.0 * theta)), 0.65);
      pos *= (0.75 + 0.45 * spike);
    }
    else if (aLayerType > 1.5 && aLayerType < 2.5) {
      float spike = pow(abs(sin(4.0 * phi) * cos(4.0 * theta)), 0.65);
      pos *= (0.75 + 0.45 * spike);
    }
    else if (aLayerType > 2.5 && aLayerType < 3.5) {
      float pulse = sin(uTime * 1.5 + aNoise * 6.28) * 0.04;
      pos *= (1.0 + pulse);
    }

    if (aLayerType > 0.5 && aLayerType < 1.5) {
      float rotA = uTime * 0.05;
      mat2 rotMat = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA));
      pos.xz = rotMat * pos.xz;
    } else if (aLayerType > 1.5 && aLayerType < 2.5) {
      float rotA = -uTime * 0.06;
      mat2 rotMat = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA));
      pos.xz = rotMat * pos.xz;
    } else if (aLayerType > 3.5) {
      float rotA = uTime * 0.03;
      mat2 rotMat = mat2(cos(rotA), -sin(rotA), sin(rotA), cos(rotA));
      pos.xz = rotMat * pos.xz;
    }

    float t = uTime * 1.0 + aNoise * 6.2831;
    float wobble = sin(t) * 0.03;
    pos *= 1.0 + wobble;

    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);

    vec3 toParticle = modelPosition.xyz - uCursor;
    float dist = length(toParticle);
    float falloff = smoothstep(uRepelRadius, 0.0, dist);
    modelPosition.xyz += normalize(toParticle + vec3(0.0001)) * falloff * uRepelStrength * uActivity;

    vec4 viewPosition = viewMatrix * modelPosition;
    gl_Position = projectionMatrix * viewPosition;

    gl_PointSize = uSize * aScale;
    gl_PointSize *= (1.0 / -viewPosition.z);

    vColor = aLayerColor;
  }
`;

const FRAGMENT_SHADER = `
  uniform float uOpacity; uniform float uBrightness;
  varying vec3 vColor;
  void main() {
    vec2 uv = gl_PointCoord - 0.5;
    float d = length(uv);
    if (d > 0.5) discard;
    float strength = pow(1.0 - d * 2.0, 4.5);
    vec3 color = mix(vec3(0.0), vColor, strength);
    gl_FragColor = vec4(color * uBrightness, strength * uOpacity * 0.85);
  }
`;

const ATMO_VERTEX_SHADER = `
  attribute float size; uniform float uTime; uniform vec2 uRes;
  varying float vA;
  vec3 warp(vec3 p, float t){ float c=0.9,a=1.9,b=0.02,s=0.05; p*=2.;
    p.x+=c*sin(s*t+a*p.y)+t*b; p.y+=c*cos(s*t+a*p.x); p.y+=c*sin(s*t+a*p.z)+t*b;
    p.z+=c*cos(s*t+a*p.y); p.z+=c*sin(s*t+a*p.x)+t*b; p.x+=c*cos(s*t+a*p.z);
    return cos(p+vec3(1,2,4)); }
  void main(){
    vec3 v = position*4.0 + warp(position, uTime)*1.2;
    vec4 mv = modelViewMatrix * vec4(v, 1.0);
    float r = length(v); float farF = 1.0 - smoothstep(5.0, 6.5, r); float nearF = smoothstep(0.0, 0.5, -mv.z);
    vA = farF * nearF;
    gl_PointSize = size * uRes.y / 900.0 / -mv.z; gl_PointSize = max(gl_PointSize, 1.0);
    gl_Position = projectionMatrix * mv;
  }
`;

const ATMO_FRAGMENT_SHADER = `
  uniform vec3 uColor; varying float vA;
  void main(){ vec2 p = gl_PointCoord - 0.5; float l = length(p); if (l > 0.5) discard;
    float tex = smoothstep(0.5, 0.0, l); gl_FragColor = vec4(uColor * tex, tex * vA * 0.45); }
`;

const FINAL_PASS = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uBg: { value: hexToVec3(CONFIG.bgColor) },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position, 1.0); }`,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform vec3 uBg;
    varying vec2 vUv;
    void main(){
      vec2 uv = 2.*vUv - 1.;
      vec3 bg = uBg * (1.0 - 0.35 * length(uv));
      vec3 sceneCol = texture2D(tDiffuse, vUv).xyz;
      gl_FragColor = vec4(bg + sceneCol, 1.0);
    }
  `,
};

export const ThreeCore: React.FC<ThreeCoreProps> = ({ voiceStateRef, rotation, fps, onFallback }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const rotationRef = useLatestRef(rotation);
  const fpsRef = useLatestRef(fps);
  const onFallbackRef = useLatestRef(onFallback);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
    } catch {
      onFallbackRef.current();
      return;
    }

    renderer.setPixelRatio(1.0);
    const canvas = renderer.domElement;
    canvas.style.position = 'absolute';
    canvas.style.inset = '0';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1322);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 80);
    camera.position.set(0, 0, 6.8);
    scene.add(camera);

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.25, 0.2, 0.9);
    composer.addPass(bloomPass);
    const finalPass = new ShaderPass(FINAL_PASS);
    composer.addPass(finalPass);

    // --- Multi-layer concentric core (8000 points) ---
    const TOTAL_POINTS = 8000;
    const positions = new Float32Array(TOTAL_POINTS * 3);
    const scales = new Float32Array(TOTAL_POINTS);
    const noises = new Float32Array(TOTAL_POINTS);
    const layerTypes = new Float32Array(TOTAL_POINTS);
    const layerColors = new Float32Array(TOTAL_POINTS * 3);

    const cPinkLila = hexToVec3('#ec4899');
    const cSoftPink = hexToVec3('#f472b6');
    const cCore = hexToVec3('#a5f3fc');
    const cTurquoise = hexToVec3('#38bdf8');
    const cAmber = hexToVec3('#fbbf24');
    const cLila = hexToVec3('#c084fc');
    const cEmerald = hexToVec3('#6ee7b7');

    let pIndex = 0;
    const addPointsForLayer = (
      count: number,
      minR: number,
      maxR: number,
      type: number,
      primaryColor: THREE.Vector3,
      secondaryColor: THREE.Vector3
    ) => {
      for (let i = 0; i < count; i++) {
        let u: number, v: number, s: number;
        do {
          u = Math.random() * 2 - 1;
          v = Math.random() * 2 - 1;
          s = u * u + v * v;
        } while (s >= 1 || s === 0);
        const factor = 2 * Math.sqrt(1 - s);
        const dx = u * factor;
        const dy = v * factor;
        const dz = 1 - 2 * s;

        const rN = Math.pow(Math.random(), 0.5);
        const r = minR + (maxR - minR) * rN;

        const idx3 = pIndex * 3;
        positions[idx3] = dx * r;
        positions[idx3 + 1] = dy * r;
        positions[idx3 + 2] = dz * r;

        scales[pIndex] = 0.5 + Math.random() * 0.75;
        noises[pIndex] = Math.random();
        layerTypes[pIndex] = type;

        const mixFactor = Math.random();
        const finalColor = primaryColor.clone().lerp(secondaryColor, mixFactor * 0.45);
        layerColors[idx3] = finalColor.x;
        layerColors[idx3 + 1] = finalColor.y;
        layerColors[idx3 + 2] = finalColor.z;

        pIndex++;
      }
    };

    addPointsForLayer(400, 0.05, 0.38, -1.0, cPinkLila, cSoftPink);
    addPointsForLayer(500, 0.25, 0.9, 0.0, cCore, cTurquoise);
    addPointsForLayer(1700, 1.25, 1.85, 1.0, cTurquoise, cCore);
    addPointsForLayer(1800, 1.95, 2.55, 2.0, cAmber, cTurquoise);
    addPointsForLayer(1800, 2.7, 3.0, 3.0, cLila, cAmber);
    addPointsForLayer(1800, 3.25, 3.4, 4.0, cEmerald, cLila);

    const stormGeometry = new THREE.BufferGeometry();
    stormGeometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    stormGeometry.setAttribute('aScale', new THREE.Float32BufferAttribute(scales, 1));
    stormGeometry.setAttribute('aNoise', new THREE.Float32BufferAttribute(noises, 1));
    stormGeometry.setAttribute('aLayerType', new THREE.Float32BufferAttribute(layerTypes, 1));
    stormGeometry.setAttribute('aLayerColor', new THREE.Float32BufferAttribute(layerColors, 3));

    const stormUniforms = {
      uTime: { value: 0 },
      uSize: { value: CONFIG.pointSize },
      uOpacity: { value: 2.0 },
      uCursor: { value: new THREE.Vector3() },
      uRepelRadius: { value: CONFIG.repelRadius },
      uRepelStrength: { value: CONFIG.repelStrength },
      uActivity: { value: 0 },
      uBrightness: { value: CONFIG.brightness },
    };

    const stormMaterial = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: stormUniforms,
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
    });

    const stormPoints = new THREE.Points(stormGeometry, stormMaterial);
    const stormGroup = new THREE.Group();
    stormGroup.add(stormPoints);
    scene.add(stormGroup);

    // --- Ambient motes ---
    const N = CONFIG.atmoCount;
    const atmoPositions = new Float32Array(N * 3);
    const atmoSizes = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      atmoPositions[i * 3] = 2 * Math.random() - 1;
      atmoPositions[i * 3 + 1] = 2 * Math.random() - 1;
      atmoPositions[i * 3 + 2] = 2 * Math.random() - 1;
      atmoSizes[i] = CONFIG.atmoSize * (0.4 + Math.random());
    }

    const atmoGeometry = new THREE.BufferGeometry();
    atmoGeometry.setAttribute('position', new THREE.Float32BufferAttribute(atmoPositions, 3));
    atmoGeometry.setAttribute('size', new THREE.Float32BufferAttribute(atmoSizes, 1));

    const atmoMat = new THREE.ShaderMaterial({
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uTime: { value: 0 },
        uColor: { value: hexToVec3(CONFIG.atmoColor) },
        uRes: { value: new THREE.Vector2(1, 1) },
      },
      vertexShader: ATMO_VERTEX_SHADER,
      fragmentShader: ATMO_FRAGMENT_SHADER,
    });

    const atmoPts = new THREE.Points(atmoGeometry, atmoMat);
    atmoPts.frustumCulled = false;
    scene.add(atmoPts);

    const resize = () => {
      const w = container.clientWidth || window.innerWidth;
      const h = container.clientHeight || window.innerHeight;
      renderer.setPixelRatio(1.0);
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      composer.setSize(w, h);
      atmoMat.uniforms.uRes.value.set(w, h);
    };
    resize();

    const ro = new ResizeObserver(() => resize());
    ro.observe(container);

    const clock = new THREE.Clock();
    let lastFrameTime = performance.now();
    let idleStrokeTimer = 0;
    const idleTargetCursor = new THREE.Vector3(0, 0, 0);
    let animationFrameId: number;

    const render = (now: number) => {
      animationFrameId = requestAnimationFrame(render);

      const frameInterval = 1000 / fpsRef.current;
      const delta = now - lastFrameTime;
      if (delta < frameInterval - 1) return;
      lastFrameTime = now - (delta % frameInterval);

      const t = clock.getElapsedTime();
      stormUniforms.uTime.value = t;
      atmoMat.uniforms.uTime.value = t * 4.0;

      atmoPts.position.copy(camera.position);

      const state = voiceStateRef.current;
      let targetScale = 1.0;
      let targetZ = 6.8;
      let spinSpeed = 0.0;

      if (state === 'idle') {
        targetScale = 0.76;
        targetZ = 6.8;
        spinSpeed = 0.0;
        if (t - idleStrokeTimer > 4.2) {
          idleStrokeTimer = t;
          const a = Math.random() * Math.PI * 2;
          const r = 0.2 + Math.random() * 0.45;
          idleTargetCursor.set(Math.cos(a) * r, Math.sin(a) * r, 0);
        }
        stormUniforms.uCursor.value.lerp(idleTargetCursor, 0.03);
        stormUniforms.uActivity.value = 0.4 + Math.sin(t * 1.6) * 0.35;
      } else if (state === 'thinking') {
        targetScale = 1.0;
        spinSpeed = 0.003;
        stormUniforms.uActivity.value = 1.0;
        const orbitX = Math.cos(t * 2.8) * 0.28;
        const orbitY = Math.sin(t * 2.2) * 0.22;
        stormUniforms.uCursor.value.set(orbitX, orbitY, 0);
        const zoomPhase = Math.sin(t * 1.2) * 0.5 + 0.5;
        targetZ = 4.4 + zoomPhase * 1.2;
      } else {
        // speaking / listening
        targetScale = 1.0;
        targetZ = 6.8;
        spinSpeed = 0.0025;
        stormUniforms.uActivity.value = 1.0;
        const orbitX = Math.cos(t * 1.8) * 0.45;
        const orbitY = Math.sin(t * 1.4) * 0.35;
        stormUniforms.uCursor.value.set(orbitX, orbitY, 0);
      }

      stormGroup.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), 0.04);
      camera.position.z += (targetZ - camera.position.z) * 0.05;

      if (rotationRef.current && spinSpeed > 0) {
        stormGroup.rotation.y += spinSpeed;
        stormGroup.rotation.x += spinSpeed * 0.33;
      }

      composer.render();
    };

    render(performance.now());

    return () => {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      ro.disconnect();
      stormGeometry.dispose();
      stormMaterial.dispose();
      atmoGeometry.dispose();
      atmoMat.dispose();
      composer.dispose();
      renderer.dispose();
      if (canvas.parentElement === container) container.removeChild(canvas);
    };
  }, [voiceStateRef]);

  return <div ref={containerRef} className="absolute inset-0 w-full h-full" />;
};

export default ThreeCore;
