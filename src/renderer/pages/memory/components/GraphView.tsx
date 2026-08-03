/**
 * GraphView — Grafo visual de memoria con jerarquía sol/planeta/satélite
 * + galaxia logs aislada (estructura tipo Obsidian, C2) y features de
 * personalización (C3): color manual por nodo, tamaño auto+manual, resaltado
 * de uniones directas al seleccionar.
 *
 * Jerarquía emergente por conectividad (sin tocar backend):
 *  - SOL       : hub con muchas conexiones directas (>= SUN_MIN_DEGREE)
 *  - PLANETA   : categoría con hijos (>= PLANET_MIN_DEGREE)
 *  - SATÉLITE  : hoja (1 conexión)
 *  - LOG       : nodos tipo session → galaxia aislada (esquina superior derecha)
 *
 * Estabilidad de cámara: el grafo se inicializa UNA vez (fuerzas, tooltips,
 * handlers). Los cambios de selección/prefs SOLO re-aplican accessors
 * (colores, tamaños, links) SIN llamar graphData(), de modo que la
 * simulación no se reinicia y la cámara/zoom/posiciones quedan quietas.
 *
 * Preferencias manuales (color/tamaño) por nodo: localStorage
 * `wayland.memoryGraph.nodePrefs.v1` (migrable a backend luego).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceCollide, forceX, forceY } from 'd3-force';
import { ipcBridge } from '@/common';
import type { GraphData, GraphNode, ListFilter } from '@/common/types/memory';
import styles from './GraphView.module.css';

interface GraphViewProps {
  filter: ListFilter;
  selectedId?: string;
  onSelectNode: (id: string) => void;
  showUnresolved: boolean;
}

type Tier = 'sun' | 'planet' | 'satellite' | 'log';

const TYPE_COLORS: Record<string, string> = {
  decision: '#ff7a45',
  pattern: '#b37feb',
  observation: '#1890ff',
  session: '#13c2c2',
  wiki: '#52c41a',
  preference: '#f759ab',
  unresolved: '#595959',
};

/* Umbrales jerarquía (C2) — ajustables para calibrar con datos reales. */
const SUN_MIN_DEGREE = 5;
const PLANET_MIN_DEGREE = 2;

/* Paleta por rol (referencia exacta a la captura de Obsidian del usuario). */
const TIER_COLORS: Record<Tier, string> = {
  sun: '#e28743', // Naranja cálido (Usuario, Negocio)
  planet: '#a855f7', // Violeta / Púrpura brillante (Hermes, Herramientas, Proyectos)
  satellite: '#cbd5e1', // Gris plateado / Blanco azulado claro (README, Satélites)
  log: '#64748b', // Gris azulado discreto (Logs)
};

const TIER_BASE_RADIUS: Record<Tier, number> = {
  sun: 8.5,
  planet: 5.5,
  satellite: 3.2,
  log: 3.5,
};

const COLOR_SWATCHES = [
  '#e28743',
  '#a855f7',
  '#cbd5e1',
  '#64748b',
  '#38bdf8',
  '#ef4444',
  '#10b981',
  '#f59e0b',
];

const SIZE_MIN = 0.4;
const SIZE_MAX = 3;
const SIZE_STEP = 0.2;

interface NodePrefs {
  color?: string;
  sizeMult?: number;
  /** Manual sun override: true = forzar sol, false = nunca sol, undefined = automático */
  sunOverride?: boolean;
}
const PREFS_KEY = 'wayland.memoryGraph.nodePrefs.v1';

const loadPrefs = (): Record<string, NodePrefs> => {
  try {
    return JSON.parse(window.localStorage.getItem(PREFS_KEY) || '{}') as Record<string, NodePrefs>;
  } catch {
    return {};
  }
};

const clamp = (v: number, min: number, max: number): number => Math.min(max, Math.max(min, v));
const idOf = (v: unknown): string =>
  typeof v === 'object' && v !== null ? (v as { id: string }).id : (v as string);

export const GraphView: React.FC<GraphViewProps> = ({ filter, selectedId, onSelectNode, showUnresolved }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const hoverNodeRef = useRef<GraphNode | null>(null);
  const centeredRef = useRef(false);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [prefs, setPrefs] = useState<Record<string, NodePrefs>>(loadPrefs);

  const savePref = (id: string, patch: NodePrefs): void => {
    setPrefs((prev) => {
      const next = { ...prev, [id]: { ...prev[id], ...patch } };
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* storage lleno/bloqueado — ignorar */
      }
      return next;
    });
  };

  const resetPref = (id: string): void => {
    setPrefs((prev) => {
      const next = { ...prev };
      delete next[id];
      try {
        window.localStorage.setItem(PREFS_KEY, JSON.stringify(next));
      } catch {
        /* ignorar */
      }
      return next;
    });
  };

  const selectedNode = useMemo(
    () => (selectedId && data ? data.nodes.find((n) => n.id === selectedId) : undefined),
    [selectedId, data]
  );

  // Fetch graph data when filters/index change
  const fetchGraphData = async (): Promise<void> => {
    setLoading(true);
    try {
      const graphData = await ipcBridge.memory.getGraphData.invoke(filter as any);
      setData(graphData);
    } catch (err) {
      console.error('[GraphView] Failed to fetch graph data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchGraphData();

    // Re-fetch on memory index change
    const unsub = ipcBridge.memory.onIndexChanged.on(() => {
      fetchGraphData();
    });
    return () => unsub();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  // Datos derivados: filtrado de nodos/edges + clasificación por rol.
  const derive = useMemo(() => {
    if (!data) return null;

    const visibleNodes = showUnresolved
      ? data.nodes
      : data.nodes.filter((n) => n.type !== 'unresolved');
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    const isLogNode = (n?: GraphNode): boolean =>
      n?.type === 'session' || n?.id === 'logs-galaxy-hub';
    const edges = data.edges.filter((e) => {
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (!nodeIds.has(s) || !nodeIds.has(t)) return false;
      const sNode = data.nodes.find((n) => n.id === s);
      const tNode = data.nodes.find((n) => n.id === t);
      return isLogNode(sNode) === isLogNode(tNode);
    });

    const nodeById = new Map(visibleNodes.map((n) => [n.id, n]));
    const degree = new Map<string, number>();
    for (const e of edges) {
      const s = idOf(e.source);
      const t = idOf(e.target);
      degree.set(s, (degree.get(s) || 0) + 1);
      degree.set(t, (degree.get(t) || 0) + 1);
    }

    const tierOf = (id: string): Tier => {
      const n = nodeById.get(id);
      if (!n) return 'satellite';
      if (n.type === 'session' || n.id === 'logs-galaxy-hub') return 'log';
      const ov = prefs[id]?.sunOverride;
      if (ov === true) return 'sun';
      if (ov === false) return 'satellite';
      const d = degree.get(id) ?? 0;
      if (d >= SUN_MIN_DEGREE) return 'sun';
      if (d >= PLANET_MIN_DEGREE) return 'planet';
      return 'satellite';
    };

    const radiusOf = (id: string, tier: Tier): number => {
      const auto = 1 + Math.min(1.4, Math.sqrt(degree.get(id) || 0) * 0.22);
      const mult = clamp(prefs[id]?.sizeMult ?? 1, SIZE_MIN, SIZE_MAX);
      return clamp(TIER_BASE_RADIUS[tier] * auto * mult, 2, 26);
    };

    const neighborsOfSelected = new Set<string>();
    if (selectedId) {
      for (const e of edges) {
        const s = idOf(e.source);
        const t = idOf(e.target);
        if (s === selectedId) neighborsOfSelected.add(t);
        if (t === selectedId) neighborsOfSelected.add(s);
      }
    }
    const isIncident = (l: { source: unknown; target: unknown }): boolean =>
      !!selectedId && (idOf(l.source) === selectedId || idOf(l.target) === selectedId);
    const isDimNode = (id: string): boolean =>
      !!selectedId && id !== selectedId && !neighborsOfSelected.has(id);

    return {
      gData: {
        nodes: visibleNodes.map((n) => ({ ...n })),
        links: edges.map((e) => ({ ...e })),
      },
      tierOf,
      radiusOf,
      isIncident,
      isDimNode,
    };
  }, [data, showUnresolved, selectedId, prefs]);

  // 1. Inicialización de la instancia de ForceGraph UNA SOLA VEZ al montar
  useEffect(() => {
    if (!containerRef.current || graphRef.current) return;

    const width = containerRef.current.clientWidth || 800;
    const height = containerRef.current.clientHeight || 600;

    const graph = new ForceGraph(containerRef.current)
      .width(width)
      .height(height)
      .backgroundColor('#0f141d')
      .nodeId('id')
      .linkSource('source')
      .linkTarget('target')
      .linkDirectionalParticleSpeed(0.005)
      .linkDirectionalParticleWidth(1.8)
      .linkDirectionalParticleColor(() => '#f5c26b')
      .onNodeClick((node: any) => {
        if (node.type !== 'unresolved') {
          onSelectNode(node.id);
        }
      })
      .onNodeHover((node: any) => {
        if (containerRef.current) {
          containerRef.current.style.cursor = node ? 'pointer' : '';
        }
        hoverNodeRef.current = node ?? null;
      });

    graphRef.current = graph;

    return () => {
      if (graphRef.current) {
        try {
          graphRef.current._destructor?.();
        } catch {
          /* ignorar */
        }
        graphRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 2. Handle Resize robustamente
  useEffect(() => {
    if (!containerRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 100 && height > 100 && graphRef.current) {
          graphRef.current.width(width).height(height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // 3. Cargar datos en la simulación física (SOLO cuando data o showUnresolved cambien)
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !derive) return;

    const { gData, tierOf } = derive;

    g.nodeLabel((node: any) => {
      const typeLabel = node.type === 'unresolved' ? 'Phantom (Inexistent)' : node.type.toUpperCase();
      const projectLabel = node.project ? `[${node.project}]` : '';
      return `<div class="${styles.tooltip}">
          <div class="${styles.tooltipHeader}">
            <span class="${styles.nodeType}" style="color:${TYPE_COLORS[node.type]}">${typeLabel}</span>
            <span>${projectLabel}</span>
          </div>
          <div class="${styles.tooltipTitle}">${node.label}</div>
          <div class="${styles.tooltipLinks}">${node.linkCount || 0} connections · rol: ${tierOf(node.id)}</div>
        </div>`;
    });

    try {
      g.graphData(gData);
    } catch (err) {
      console.error('[GraphView] Error applying graphData:', err);
    }

    applyForces(g, derive);
    applyAccessors(g, derive);

    // Centrado de cámara (zoomToFit) SOLO la primera vez que entran datos de la memoria
    if (gData.nodes.length > 0 && !centeredRef.current) {
      let attempts = 0;
      const fitCamera = () => {
        attempts++;
        const w = containerRef.current?.clientWidth ?? 0;
        const h = containerRef.current?.clientHeight ?? 0;
        if (w > 100 && h > 100 && graphRef.current) {
          try {
            graphRef.current.zoomToFit(400, 50);
            centeredRef.current = true;
          } catch {
            /* ignorar */
          }
        } else if (attempts < 15) {
          requestAnimationFrame(fitCamera);
        }
      };

      const timer = setTimeout(fitCamera, 200);
      return () => clearTimeout(timer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, showUnresolved]);

  // 4. Selección y personalización (prefs): SOLO re-aplica accessors (colores, tamaños, resaltados)
  // SIN tocar graphData() ni zoomToFit() -> la cámara, zoom y física permanecen 100% quietas y fluidas.
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !derive) return;
    applyAccessors(g, derive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, prefs]);

  const applyForces = (g: any, d: NonNullable<typeof derive>): void => {
    const { tierOf, radiusOf } = d;
    const width = containerRef.current?.clientWidth || 800;
    const height = containerRef.current?.clientHeight || 600;

    // Física estilo Obsidian: los racimos (clusters) orbitan sus hubs
    // y los hubs se separan ampliamente en la escena global.
    g.d3Force('center', null);

    const linkForce: any = g.d3Force('link');
    if (linkForce) {
      linkForce
        .distance((l: any) => {
          const sTier = tierOf(idOf(l.source));
          const tTier = tierOf(idOf(l.target));
          // Logs: su propia galaxia aislada
          if (sTier === 'log' || tTier === 'log') return 45;
          // Hub↔Hub (Sol/Planeta ↔ Sol/Planeta): MUY lejos para separar racimos
          if ((sTier === 'sun' || sTier === 'planet') && (tTier === 'sun' || tTier === 'planet')) return 280;
          // Satélite ↔ Hub: Cerca (mantiene la constelación orbitando su hub)
          return 75;
        })
        .strength((l: any) => {
          const sTier = tierOf(idOf(l.source));
          const tTier = tierOf(idOf(l.target));
          if ((sTier === 'sun' || sTier === 'planet') && (tTier === 'sun' || tTier === 'planet')) return 0.03;
          return 0.45;
        });
    }

    // Repulsión ManyBody: fuerte entre hubs, suave entre satélites
    const charge: any = g.d3Force('charge');
    if (charge) {
      charge
        .strength((n: any) => {
          const t = tierOf(n.id);
          if (t === 'sun') return -750;
          if (t === 'planet') return -300;
          if (t === 'log') return -120;
          return -90;
        })
        .distanceMin(15)
        .distanceMax(2200);
    }

    // Colisión física para evitar solapamientos visuales
    g.d3Force(
      'collide',
      forceCollide((n: any) => {
        const r = radiusOf(n.id, tierOf(n.id));
        return r + 14;
      }).iterations(2)
    );

    // Fuerza x/y SOLO para logs (galaxia aislada esquina); resto 0.
    g.d3Force(
      'x',
      forceX((n: any) => (tierOf(n.id) === 'log' ? width * 0.86 : width * 0.5)).strength(
        (n: any) => (tierOf(n.id) === 'log' ? 0.8 : 0)
      )
    );
    g.d3Force(
      'y',
      forceY((n: any) => (tierOf(n.id) === 'log' ? height * 0.14 : height * 0.5)).strength(
        (n: any) => (tierOf(n.id) === 'log' ? 0.8 : 0)
      )
    );
  };

  // Selección / prefs: SOLO accessors, sin graphData → sim y cámara quietas
  useEffect(() => {
    const g = graphRef.current;
    if (!g || !derive) return;
    applyAccessors(g, derive);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, prefs]);

  // applyAccessors: re-aplica colores/tamaños/links/pintado con el derive actual
  // (no reinicia la simulación).
  const applyAccessors = (g: any, d: NonNullable<typeof derive>): void => {
    const { tierOf, radiusOf, isIncident, isDimNode } = d;

    g.nodeVal((node: any) => radiusOf(node.id, tierOf(node.id)));
    g.nodeColor((node: any) =>
      node.id === selectedId ? '#ffffff' : prefs[node.id]?.color || TIER_COLORS[tierOf(node.id)]
    );
    g.linkColor((l: any) => {
      if (selectedId) {
        return isIncident(l) ? '#ffffff' : 'rgba(148, 163, 184, 0.08)';
      }
      const sTier = tierOf(idOf(l.source));
      const tTier = tierOf(idOf(l.target));
      if (sTier === 'log' || tTier === 'log') return 'rgba(100, 116, 139, 0.25)';
      if (sTier === 'sun' || tTier === 'sun') return 'rgba(226, 135, 67, 0.35)';
      return 'rgba(148, 163, 184, 0.2)';
    });
    g.linkWidth((l: any) => (selectedId && isIncident(l) ? 2.0 : 0.8));
    g.linkDirectionalParticles((l: any) => (selectedId && isIncident(l) ? 3 : 0));

    g.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const tier = tierOf(node.id);
      const r = radiusOf(node.id, tier);
      const isSelected = node.id === selectedId;
      const isHovered = hoverNodeRef.current?.id === node.id;
      const color = isSelected ? '#ffffff' : prefs[node.id]?.color || TIER_COLORS[tier];
      const dim = isDimNode(node.id);
      const label = node.label;
      const fontSize = Math.max(11, 13 / globalScale);
      ctx.font = `${fontSize}px Sans-Serif`;

      ctx.globalAlpha = dim ? 0.22 : 1;

      if (tier === 'sun' && !isSelected) {
        const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 2.2);
        glow.addColorStop(0, 'rgba(226, 135, 67, 0.22)');
        glow.addColorStop(1, 'rgba(226, 135, 67, 0)');
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(node.x, node.y, r * 2.2, 0, 2 * Math.PI);
        ctx.fill();
      }

      ctx.beginPath();
      ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.8;
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
        ctx.beginPath();
        ctx.arc(node.x, node.y, r + 8, 0, 2 * Math.PI);
        ctx.fill();
        ctx.globalAlpha = dim ? 0.22 : 1;
      }

      const showLabel =
        tier === 'sun' ||
        isSelected ||
        isHovered ||
        (globalScale > 0.7 && tier === 'planet') ||
        (globalScale > 1.1 && tier === 'satellite') ||
        tier === 'log';
      if (showLabel) {
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        ctx.lineWidth = Math.max(2, fontSize / 5);
        ctx.strokeStyle = 'rgba(10, 14, 20, 0.9)';
        ctx.fillStyle = isSelected
          ? '#ffffff'
          : tier === 'sun'
          ? '#f59e0b'
          : tier === 'planet'
          ? '#e9d5ff'
          : '#cbd5e1';
        const cleanLabel = label.length > 25 ? label.slice(0, 22) + '...' : label;
        ctx.strokeText(cleanLabel, node.x, node.y + r + 4);
        ctx.fillText(cleanLabel, node.x, node.y + r + 4);
      }

      ctx.globalAlpha = 1;
    });
  };

  return (
    <div className={styles.graphContainer}>
      {loading && <div className={styles.loading}>Generating Knowledge Graph...</div>}
      <div ref={containerRef} className={styles.graph} />

      {/* Leyenda de roles (C2) */}
      <div className={styles.legend}>
        <span className={styles.legendTitle}>ROLES</span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot} style={{ background: TIER_COLORS.sun }} /> SOL
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot} style={{ background: TIER_COLORS.planet }} /> PLANETA
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot} style={{ background: TIER_COLORS.satellite }} /> SATÉLITE
        </span>
        <span className={styles.legendItem}>
          <i className={styles.legendDot} style={{ background: TIER_COLORS.log }} /> LOGS
        </span>
      </div>

      {/* Toolbar nodo seleccionado (C3): color manual + tamaño */}
      {selectedNode && (
        <div className={styles.nodeToolbar}>
          <span className={styles.toolbarLabel}>COLOR</span>
          {COLOR_SWATCHES.map((c) => (
            <button
              key={c}
              type="button"
              title={`Color ${c}`}
              className={styles.swatch}
              style={{
                background: c,
                outline: prefs[selectedNode.id]?.color === c ? '2px solid #ffffff' : 'none',
              }}
              onClick={() => savePref(selectedNode.id, { color: c })}
            />
          ))}
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Restablecer color automático"
            onClick={() => {
              const p = { ...prefs[selectedNode.id] };
              delete p.color;
              savePref(selectedNode.id, p);
            }}
          >
            AUTO
          </button>

          <span className={`${styles.toolbarLabel} ${styles.toolbarSep}`}>TAMAÑO</span>
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Reducir"
            onClick={() =>
              savePref(selectedNode.id, {
                sizeMult: clamp((prefs[selectedNode.id]?.sizeMult ?? 1) - SIZE_STEP, SIZE_MIN, SIZE_MAX),
              })
            }
          >
            −
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Aumentar"
            onClick={() =>
              savePref(selectedNode.id, {
                sizeMult: clamp((prefs[selectedNode.id]?.sizeMult ?? 1) + SIZE_STEP, SIZE_MIN, SIZE_MAX),
              })
            }
          >
            +
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Tamaño automático"
            onClick={() => {
              const p = { ...prefs[selectedNode.id] };
              delete p.sizeMult;
              savePref(selectedNode.id, p);
            }}
          >
            AUTO
          </button>

          <span className={`${styles.toolbarLabel} ${styles.toolbarSep}`}>ROL</span>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${styles.toolbarSun}`}
            title="Forzar este nodo como SOL (centro de su galaxia)"
            onClick={() => savePref(selectedNode.id, { sunOverride: true })}
          >
            ☀ HACER SOL
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Quitar override: volver a rol automático"
            onClick={() => {
              const p = { ...prefs[selectedNode.id] };
              delete p.sunOverride;
              savePref(selectedNode.id, p);
            }}
          >
            AUTO ROL
          </button>
          <button
            type="button"
            className={styles.toolbarBtn}
            title="Evitar que este nodo sea sol (nunca centro)"
            onClick={() => savePref(selectedNode.id, { sunOverride: false })}
          >
            NO SOL
          </button>
          <button
            type="button"
            className={`${styles.toolbarBtn} ${styles.toolbarDanger}`}
            title="Quitar personalización"
            onClick={() => resetPref(selectedNode.id)}
          >
            RESET
          </button>
          </div>
          )}
          </div>
          );
          };

export default GraphView;
