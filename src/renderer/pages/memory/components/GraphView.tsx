import React, { useEffect, useRef, useState } from 'react';
import ForceGraph from 'force-graph';
import { ipcBridge } from '@/common';
import type { GraphData, GraphNode, ListFilter } from '@/common/types/memory';
import styles from './GraphView.module.css';

interface GraphViewProps {
  filter: ListFilter;
  selectedId?: string;
  onSelectNode: (id: string) => void;
  showUnresolved: boolean;
}

const TYPE_COLORS: Record<string, string> = {
  decision: '#ff7a45', // orange
  pattern: '#b37feb', // purple
  observation: '#1890ff', // blue
  session: '#13c2c2', // cyan
  wiki: '#52c41a', // green
  preference: '#f759ab', // pink
  unresolved: '#595959', // dark gray for phantoms
};

export const GraphView: React.FC<GraphViewProps> = ({ filter, selectedId, onSelectNode, showUnresolved }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<any>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hoverNode, setHoverNode] = useState<GraphNode | null>(null);

  // Fetch graph data when filters or index changes
  const fetchGraphData = async () => {
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
  }, [filter]);

  // Handle Resize
  useEffect(() => {
    if (!containerRef.current || !graphRef.current) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (let entry of entries) {
        const { width, height } = entry.contentRect;
        if (graphRef.current) {
          graphRef.current.width(width).height(height);
        }
      }
    });

    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, []);

  // Initialize and update Force Graph (stable — no full rebuild on data/select changes)
  useEffect(() => {
    if (!containerRef.current || !data) return;

    // Only destroy if there is no existing graph instance
    if (!graphRef.current) {
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight || 500;

      // Filter unresolved nodes if requested
      const filteredNodes = showUnresolved ? data.nodes : data.nodes.filter((n) => n.type !== 'unresolved');

      const nodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = data.edges.filter(
        (e) =>
          nodeIds.has(typeof e.source === 'object' ? (e.source as any).id : e.source) &&
          nodeIds.has(typeof e.target === 'object' ? (e.target as any).id : e.target)
      );

      // Format data for force-graph library
      const gData = {
        nodes: filteredNodes.map((n) => ({ ...n })),
        links: filteredEdges.map((e) => ({ ...e })),
      };

      const graph = new ForceGraph(containerRef.current!)
        .width(width)
        .height(height)
        .graphData(gData)
        .backgroundColor('#0d0d0d') // match Wayland's dark background
        .nodeId('id')
        .nodeVal((node: any) => 3 + Math.sqrt(node.linkCount || 0) * 1.5)
        .nodeColor((node: any) => {
          if (node.id === selectedId) return '#ffffff'; // highlight active node in white
          return TYPE_COLORS[node.type] || '#8c8c8c';
        })
        .nodeLabel((node: any) => {
          const typeLabel = node.type === 'unresolved' ? 'Phantom (Inexistent)' : node.type.toUpperCase();
          const projectLabel = node.project ? ` [${node.project}]` : '';
          return `<div class="${styles.tooltip}">
            <div class="${styles.tooltipHeader}">
              <span class="${styles.nodeType}" style="color: ${TYPE_COLORS[node.type]}">${typeLabel}</span>
              <span>${projectLabel}</span>
            </div>
            <div class="${styles.tooltipTitle}">${node.label}</div>
            <div class="${styles.tooltipLinks}">${node.linkCount} connections</div>
          </div>`;
        })
        .linkSource('source')
        .linkTarget('target')
        .linkColor(() => '#262626') // dark gray edges
        .linkWidth(1.2)
        .linkDirectionalParticles(2)
        .linkDirectionalParticleSpeed((d: any) => 0.005)
        .linkDirectionalParticleWidth(1.5)
        .linkDirectionalParticleColor(() => '#595959')
        .onNodeClick((node: any) => {
          if (node.type !== 'unresolved') {
            onSelectNode(node.id);
          }
        })
        .onNodeHover((node: any) => {
          containerRef.current!.style.cursor = node ? 'pointer' : (null as any);
          setHoverNode(node || null);
        });

      // Custom Node Painting to show unresolved nodes with dashes or glow effects
      graph.nodeCanvasObject((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
        const label = node.label;
        const fontSize = 10 / globalScale;
        ctx.font = `${fontSize}px Sans-Serif`;

        const r = 2.5 + Math.sqrt(node.linkCount || 0) * 1.2;
        const isSelected = node.id === selectedId;

        // Node circle
        ctx.beginPath();
        ctx.arc(node.x, node.y, r, 0, 2 * Math.PI, false);

        if (node.type === 'unresolved') {
          // Dashed stroke for phantoms
          ctx.strokeStyle = TYPE_COLORS.unresolved;
          ctx.lineWidth = 1;
          ctx.setLineDash([2, 1]);
          ctx.stroke();
          ctx.fillStyle = 'rgba(89, 89, 89, 0.15)';
          ctx.fill();
          ctx.setLineDash([]); // reset
        } else {
          // Solid fill
          ctx.fillStyle = isSelected ? '#ffffff' : TYPE_COLORS[node.type] || '#8c8c8c';
          ctx.fill();

          // Add subtle border to selected node
          if (isSelected) {
            ctx.strokeStyle = '#1890ff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
          }
        }

        // Render text label for prominent nodes or when zoomed in
        if (globalScale > 0.8 || node.linkCount > 2 || isSelected) {
          ctx.textAlign = 'center';
          ctx.textBaseline = 'top';
          ctx.fillStyle = isSelected ? '#ffffff' : '#bfbfbf';

          // Truncate long labels
          const cleanLabel = label.length > 25 ? label.slice(0, 22) + '...' : label;
          ctx.fillText(cleanLabel, node.x, node.y + r + 3);
        }
      });

      graphRef.current = graph;
    } else {
      // Graph already exists — only update data and selectedId highlight (no rebuild)
      const filteredNodes = showUnresolved ? data.nodes : data.nodes.filter((n) => n.type !== 'unresolved');
      const nodeIds = new Set(filteredNodes.map((n) => n.id));
      const filteredEdges = data.edges.filter(
        (e) =>
          nodeIds.has(typeof e.source === 'object' ? (e.source as any).id : e.source) &&
          nodeIds.has(typeof e.target === 'object' ? (e.target as any).id : e.target)
      );

      graphRef.current.graphData({
        nodes: filteredNodes.map((n) => ({ ...n })),
        links: filteredEdges.map((e) => ({ ...e })),
      });

      // Update node color for selected/highlighted node
      graphRef.current.nodeColor((node: any) => {
        if (node.id === selectedId) return '#ffffff';
        return TYPE_COLORS[node.type] || '#8c8c8c';
      });
    }

    return () => {
      if (graphRef.current) {
        graphRef.current._destructor?.();
      }
    };
  }, [data]); // only rebuild on initial data load; updates use .graphData()

  return (
    <div className={styles.graphContainer}>
      {loading && <div className={styles.loading}>Generating Knowledge Graph...</div>}
      <div ref={containerRef} className={styles.graph} />
    </div>
  );
};

export default GraphView;
