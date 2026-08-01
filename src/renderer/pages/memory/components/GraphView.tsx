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
 * Preferencias manuales (color/tamaño) por nodo: localStorage
 * `wayland.memoryGraph.nodePrefs.v1` (migrable a backend luego).
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { forceX, forceY } from 'd3-force';
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
  decision: '#ff7a45', // orange
  pattern: '#b37feb', // purple
  observation: '#1890ff', // blue
  session: '#13c2c2', // cyan
  wiki: '#52c41a', // green
  preference: '#f759ab', // pink
  unresolved: '#595959', // dark gray phantoms
};

/* Umbrales jerarquía (C2) — ajustables para calibrar con datos reales. */
const SUN_MIN_DEGREE = 5;
const PLANET_MIN_DEGREE = 2;

/* Paleta por rol (referencia Obsidian: hubs dorado, categorías púrpura,
   hojas/docs gris-azulado, logs muted). */
const TIER_COLORS: Record<Tier, string> = {
  sun: '#f0b429',
  planet: '#a89fc4',
  satellite: '#5f7190',
  log: '#4e6178',
};

const TIER_BASE_RADIUS: Record<Tier, number> = {
  sun: 7.5,
  planet: 4.5,
  satellite: 2.8,
  log: 3,
};

/* Swatches para color manual (C3). */
const COLOR_SWATCHES = [
  '#f0b429', // dorado/ámbar
  '#a89fc4', // púrpura
  '#5f7190', // gris-azulado
  '#4e6178', // gris-azul oscuro
  '#e8eef7', // blanco
  '#d96c4f', // naranja (negocio)
  '#6ba292', // salvia
  '#c08e9c', // rosa apagado
];

const SIZE_MIN = 0.4;
const SIZE_MAX = 3;
const SIZE_STEP = 0.2;

/* Preferencias manuales por nodo (C3): localStorage. */
interface NodePrefs {
  color?: string;
  sizeMult?: number;
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
const idOf = (v: unknown): string => (typeof v === 'object' && v !== null ? (v as { id: string }).id : (v as string));

export const GraphView: React.FC<GraphViewProps> = ({ filter, selectedId, onSelectNode, showUnresolved }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const hoverNodeRef = useRef<GraphNode | null>(null);
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

  // Handle Resize
  useEffect(() => {
    if (!containerRef.current || !graphRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (graphRef.current) {
          graphRef.current.width(width).height(height);
        }
      }
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Init/update graph (stable instance — no full rebuild on data/select/prefs changes)
  useEffect(() => {
    if (!containerRef.current || !data) return;
    const width = containerRef.current.clientWidth;
    const height = containerRef.current.clientHeight || 500;

    // Filtrar unresolved y aislar galaxia logs (edges log<->no-log fuera)
    const visibleNodes = showUnresolved ? data.nodes : data.nodes.filter((n) => n.type !== 'unresolved');
    const nodeIds = new Set(visibleNodes.map((n) => n.id));
    const edges = data.edges.filter((e) => {
      const s = idOf(e.source);
      const t = idOf(e.target);
      if (!nodeIds.has(s) || !nodeIds.has(t)) return false;
      const sNode = data.nodes.find((n) => n.id === s);
      const tNode = data.nodes.find((n) => n.id === t);
      const sLog = sNode?.type === 'session';
      const tLog = tNode?.type === 'session';
      return sLog === tLog; // corta edges log<->no-log: galaxias aisladas
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
      if (n.type === 'session') return 'log';
      const d = degree.get(id) || 0;
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

    const gData = {
      nodes: visibleNodes.map((n) => ({ ...n })),
      links: edges.map((e) => ({ ...e })),
    };

    if (!graphRef.current) {
      const graph = new ForceGraph(containerRef.current!)
        .width(width)
        .height(height)
        .graphData(gData)
        .backgroundColor('#0f141d')
        .nodeId('id')
        .nodeVal((node: any) => radiusOf(node.id, tierOf(node.id)))
        .nodeColor((node: any) =>
          node.id === selectedId ? '#ffffff' : prefs[node.id]?.color || TIER_COLORS[tierOf(node.id)]
        )
        .nodeLabel((node: any) => {
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
        })
        .linkSource('source')
        .linkTarget('target')
        .linkColor((l: any) => {
          if (selectedId) {
            return isIncident(l) ? '#ffffff' : 'rgba(38, 38, 38, 0.18)';
          }
          const sTier = tierOf(idOf(l.source));
          const tTier = tierOf(idOf(l.target));
          if (sTier === 'log' || tTier === 'log') return '#3a4a5e';
          if (sTier === 'sun' || tTier === 'sun') return 'rgba(240, 180, 41, 0.55)';
          return '#2c3a4d';
        })
        .linkWidth((l: any) => (selectedId && isIncident(l) ? 2.6 : 1.1))
        .linkDirectionalParticles((l: any) => (selectedId && isIncident(l) ? 3 : 0))
        .linkDirectionalParticleSpeed(0.005)
        .linkDirectionalParticleWidth(1.8)
        .linkDirectionalParticleColor(() => '#f5c26b')
        .onNodeClick((node: any) => {
          if (node.type !== 'unresolved') {
            onSelectNode(node.id);
          }
        })
        .onNodeHover((node: any) => {
          containerRef.current!.style.cursor = node ? 'pointer' : ('' as any);
          hoverNodeRef.current = node || null;
        });

      // --- Fuerzas por clúster (C2): galaxia logs aislada, soles al centro ---
      const linkForce: any = graph.d3Force('link');
      if (linkForce) {
        linkForce.distance((l: any) => {
          const sTier = tierOf(idOf(l.source));
          const tTier = tierOf(idOf(l.target));
          if (sTier === 'log' || tTier === 'log') return 22;
          if (sTier === 'sun' || tTier === 'sun') return 72;
          return 42;
        }).strength(0.55);
      }
      const charge: any = graph.d3Force('charge');
      if (charge) charge.strength(-90).distanceMax(900);
      graph.d3Force('center', null);
      graph.d3Force(
        'x',
        forceX((n: any) => (tierOf(n.id) === 'log' ? width * 0.86 : width * 0.5)).strength((n: any) => {
          const t = tierOf(n.id);
          return t === 'log' ? 0.9 : t === 'sun' ? 0.35 : t === 'planet' ? 0.18 : 0.08;
        })
      );
      graph.d3Force(
        'y',
        forceY((n: any) => (tierOf(n.id) === 'log' ? height * 0.14 : height * 0.5)).strength((n: any) => {
          const t = tierOf(n.id);
          return t === 'log' ? 0.9 : t === 'sun' ? 0.35 : t === 'planet' ? 0.18 : 0.08;
        })
      );

      // --- Pintado por rol (sol con glow, satélite discreto, dim al seleccionar) ---
      graph.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
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

        // Glow para soles
        if (tier === 'sun' && !isSelected) {
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
          glow.addColorStop(0, 'rgba(240, 180, 41, 0.28)');
          glow.addColorStop(1, 'rgba(240, 180, 41, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        // Nodo
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        if (node.type === 'unresolved') {
          ctx.strokeStyle = TYPE_COLORS.unresolved;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 1]);
          ctx.stroke();
          ctx.fillStyle = 'rgba(89, 89, 89, 0.15)';
          ctx.fill();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }

        // Anillo blanco + halo para seleccionado
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

        // Labels: soles siempre; planetas/satélites al acercar; hover/selección siempre
        const showLabel =
          tier === 'sun' || isSelected || isHovered || (globalScale > 0.7 && tier === 'planet') || (globalScale > 1.1 && tier === 'satellite') || tier === 'log';
        if (showLabel) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.lineWidth = Math.max(2, fontSize / 5);
          ctx.strokeStyle = 'rgba(10, 14, 20, 0.9)';
          ctx.fillStyle = isSelected ? '#ffffff' : tier === 'sun' ? '#f5c26b' : '#c9d4e4';
          const cleanLabel = label.length > 25 ? label.slice(0, 22) + '...' : label;
          ctx.strokeText(cleanLabel, node.x, node.y + r + 4);
          ctx.fillText(cleanLabel, node.x, node.y + r + 4);
        }

        ctx.globalAlpha = 1;
      });

      graphRef.current = graph;
    } else {
      // Actualización: datos + colores + tamaños sin reconstruir
      graphRef.current.graphData(gData);
      graphRef.current.nodeVal((node: any) => radiusOf(node.id, tierOf(node.id)));
      graphRef.current.nodeColor((node: any) =>
        node.id === selectedId ? '#ffffff' : prefs[node.id]?.color || TIER_COLORS[tierOf(node.id)]
      );
      graphRef.current.linkColor((l: any) => {
        if (selectedId) {
          return isIncident(l) ? '#ffffff' : 'rgba(38, 38, 38, 0.18)';
        }
        const sTier = tierOf(idOf(l.source));
        const tTier = tierOf(idOf(l.target));
        if (sTier === 'log' || tTier === 'log') return '#3a4a5e';
        if (sTier === 'sun' || tTier === 'sun') return 'rgba(240, 180, 41, 0.55)';
        return '#2c3a4d';
      });
      graphRef.current.linkWidth((l: any) => (selectedId && isIncident(l) ? 2.6 : 1.1));
      graphRef.current.linkDirectionalParticles((l: any) => (selectedId && isIncident(l) ? 3 : 0));
      graphRef.current.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        /* repintado con closure fresco — reutiliza la misma lógica */
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
          const glow = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, r * 3);
          glow.addColorStop(0, 'rgba(240, 180, 41, 0.28)');
          glow.addColorStop(1, 'rgba(240, 180, 41, 0)');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(node.x, node.y, r * 3, 0, 2 * Math.PI);
          ctx.fill();
        }

        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);
        if (node.type === 'unresolved') {
          ctx.strokeStyle = TYPE_COLORS.unresolved;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 1]);
          ctx.stroke();
          ctx.fillStyle = 'rgba(89, 89, 89, 0.15)';
          ctx.fill();
          ctx.setLineDash([]);
        } else {
          ctx.fillStyle = color;
          ctx.fill();
        }

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
          tier === 'sun' || isSelected || isHovered || (globalScale > 0.7 && tier === 'planet') || (globalScale > 1.1 && tier === 'satellite') || tier === 'log';
        if (showLabel) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.lineWidth = Math.max(2, fontSize / 5);
          ctx.strokeStyle = 'rgba(10, 14, 20, 0.9)';
          ctx.fillStyle = isSelected ? '#ffffff' : tier === 'sun' ? '#f5c26b' : '#c9d4e4';
          const cleanLabel = label.length > 25 ? label.slice(0, 22) + '...' : label;
          ctx.strokeText(cleanLabel, node.x, node.y + r + 4);
          ctx.fillText(cleanLabel, node.x, node.y + r + 4);
        }

        ctx.globalAlpha = 1;
      });
    }

    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
        graphRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, prefs, selectedId, showUnresolved]);

  return (
    <div className={styles.graphContainer}>
      {loading && <div className={styles.loading}>Generating Knowledge Graph...</div>}
      <div ref={containerRef} className={styles.graph} />

      {/* Leyenda de roles (C2) */}
      <div className={styles.legend}>
        <span className={styles.legendTitle}>ROLES</span>
        <span className={styles.legendItem}><i className={styles.legendDot} style={{ background: TIER_COLORS.sun }} /> SOL</span>
        <span className={styles.legendItem}><i className={styles.legendDot} style={{ background: TIER_COLORS.planet }} /> PLANETA</span>
        <span className={styles.legendItem}><i className={styles.legendDot} style={{ background: TIER_COLORS.satellite }} /> SATÉLITE</span>
        <span className={styles.legendItem}><i className={styles.legendDot} style={{ background: TIER_COLORS.log }} /> LOGS</span>
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
              style={{ background: c, outline: prefs[selectedNode.id]?.color === c ? '2px solid #ffffff' : 'none' }}
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
          <button type="button" className={styles.toolbarBtn} title="Reducir" onClick={() => savePref(selectedNode.id, { sizeMult: clamp((prefs[selectedNode.id]?.sizeMult ?? 1) - SIZE_STEP, SIZE_MIN, SIZE_MAX) })}>
            −
          </button>
          <button type="button" className={styles.toolbarBtn} title="Aumentar" onClick={() => savePref(selectedNode.id, { sizeMult: clamp((prefs[selectedNode.id]?.sizeMult ?? 1) + SIZE_STEP, SIZE_MIN, SIZE_MAX) })}>
            +
          </button>
          <button type="button" className={styles.toolbarBtn} title="Tamaño automático" onClick={() => {
            const p = { ...prefs[selectedNode.id] };
            delete p.sizeMult;
            savePref(selectedNode.id, p);
          }}>
            AUTO
          </button>
          <button type="button" className={`${styles.toolbarBtn} ${styles.toolbarDanger}`} title="Quitar personalización" onClick={() => resetPref(selectedNode.id)}>
            RESET
          </button>
        </div>
      )}
    </div>
  );
};

export default GraphView;
