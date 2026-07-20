import * as path from 'node:path';
import * as fs from 'node:fs';
import { getIjfwArchiveService } from './ijfwArchiveService';
import type { GraphData, GraphNode, GraphEdge, ListFilter, MemoryEntry } from '@/common/types/memory';

/**
 * Extracts all [[wikilinks]] from markdown body.
 * Handles forms like [[TargetNode]] and [[TargetNode|Display Text]].
 */
function extractWikilinks(body: string): string[] {
  // 1. Remove fenced code blocks (```...```)
  let cleanBody = body.replace(/```[\s\S]*?```/g, '');
  // 2. Remove inline code blocks (`...`)
  cleanBody = cleanBody.replace(/`[\s\S]*?`/g, '');

  const links: string[] = [];
  const regex = /\[\[([^\]|]+)(?:\|[^\]]*)?\]\]/g;
  let match;
  while ((match = regex.exec(cleanBody)) !== null) {
    if (match[1]) {
      links.push(match[1].trim());
    }
  }
  return links;
}

export async function getMemoryGraphData(filter?: ListFilter): Promise<GraphData> {
  const archiveSvc = getIjfwArchiveService();

  // 1. Get all entries (up to resident cap)
  const { entries } = await archiveSvc.listEntries({ limit: 5000 });

  // 2. Fetch full body content for all entries in parallel from raw disk files
  const rawFullEntries = await Promise.all(
    entries.map(async (e) => {
      try {
        const fullContent = await fs.promises.readFile(e.sourcePath, 'utf8');
        return { ...e, body: fullContent };
      } catch (err) {
        const full = await archiveSvc.getEntry(e.id);
        return full || { ...e, body: '' };
      }
    })
  );

  // Group and consolidate entries by their sourcePath to handle multiple parsed blocks
  // in a single file (like when Obsidian files have multiple frontmatters)
  const consolidatedMap = new Map<string, (typeof rawFullEntries)[number]>();
  for (const entry of rawFullEntries) {
    const existing = consolidatedMap.get(entry.sourcePath);
    if (existing) {
      // Merge bodies and tags
      existing.body = (existing.body || '') + '\n' + (entry.body || '');
      existing.tags = Array.from(new Set([...existing.tags, ...entry.tags]));
      // Keep the summary that is not "Untitled"
      if (existing.summary.toLowerCase().includes('untitled') && !entry.summary.toLowerCase().includes('untitled')) {
        existing.summary = entry.summary;
      }
      // Prefer more specific types than observation if available
      if (existing.type === 'observation' && entry.type !== 'observation') {
        existing.type = entry.type;
      }
    } else {
      // Clone to avoid modifying in-memory index objects directly
      consolidatedMap.set(entry.sourcePath, { ...entry });
    }
  }

  const fullEntries = Array.from(consolidatedMap.values());

  // Map to index entries by clean alias names
  const aliasToIdMap = new Map<string, string>();
  const idToEntryMap = new Map<string, (typeof fullEntries)[number]>();

  // Clean emoji and special chars from name
  const cleanNameString = (str: string): string => {
    return str
      .toLowerCase()
      .replace(
        /[\u2700-\u27BF]|[\uE000-\uF8FF]|\uD83C[\uDC00-\uDFFF]|\uD83D[\uDC00-\uDFFF]|[\u2011-\u26FF]|\uD83E[\uDD00-\uDFFF]/g,
        ''
      ) // Emojis
      .replace(/[^\w\s-]/g, '') // Special chars
      .replace(/\s+/g, ' ')
      .trim();
  };

  for (const entry of fullEntries) {
    idToEntryMap.set(entry.id, entry);

    // 1. Resolve clean name from physical filename (e.g. 'obsidian-xxx' -> ignore, or use clean basename if not obsidian prefix)
    const filenameWithExt = path.basename(entry.sourcePath);
    const cleanFilename = path.basename(filenameWithExt, path.extname(filenameWithExt)).toLowerCase();

    // 2. Resolve from original source_path (the real Obsidian filename)
    // This is the absolute best way to match Obsidian wikilinks!
    const bodyStr = entry.body || '';
    const sourcePathMatch = bodyStr.match(/source_path:\s*([^\n\r]+)/);
    if (sourcePathMatch && sourcePathMatch[1]) {
      const srcPath = sourcePathMatch[1].trim();
      const cleanSrcFilename = path.basename(srcPath, path.extname(srcPath)).toLowerCase();

      // Index by clean original filename (e.g. 'hermes', 'usuario', 'negodo')
      aliasToIdMap.set(cleanSrcFilename, entry.id);

      // Index by full original relative path without extension (e.g. '00 - sistema/hermes')
      const cleanPathWithoutExt = srcPath.replace(/\.md$/, '').toLowerCase();
      aliasToIdMap.set(cleanPathWithoutExt, entry.id);
    } else {
      // Fallback to the physical filename if no source_path is specified
      if (!cleanFilename.startsWith('obsidian-')) {
        aliasToIdMap.set(cleanFilename, entry.id);
      }
    }

    // 3. Resolve from exact clean summary (without emojis or special characters)
    const cleanSummary = cleanNameString(entry.summary);
    aliasToIdMap.set(cleanSummary, entry.id);

    // 4. Specific known unifications (Hermes -> Hermes Agent, Usuario -> Perfil del Usuario)
    // strictly matched to avoid partial keyword overlaps on directories
    if (cleanSummary === 'hermes agent') {
      aliasToIdMap.set('hermes', entry.id);
    }
    if (cleanSummary === 'perfil del usuario') {
      aliasToIdMap.set('usuario', entry.id);
    }
  }

  const nodesMap = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];

  // Track how many incoming/outgoing links each node has
  const linkCounts = new Map<string, number>();

  const incrementLink = (id: string) => {
    linkCounts.set(id, (linkCounts.get(id) || 0) + 1);
  };

  // 3. Parse links and build edge list
  for (const entry of fullEntries) {
    // Ensure the source node is registered in nodesMap
    if (!nodesMap.has(entry.id)) {
      // Extract original filename from body to use as a clean label
      const bodyStr = entry.body || '';
      const sourcePathMatch = bodyStr.match(/source_path:\s*([^\n\r]+)/);
      let cleanLabel = entry.summary;
      if (sourcePathMatch && sourcePathMatch[1]) {
        const srcPath = sourcePathMatch[1].trim();
        const baseName = path.basename(srcPath, path.extname(srcPath));
        // Use clean name without folder prefix, e.g. "Negocio", "Terminal de Negocio"
        cleanLabel = baseName;
      }

      nodesMap.set(entry.id, {
        id: entry.id,
        label: cleanLabel,
        type: entry.type,
        project: entry.project,
        linkCount: 0,
      });
    }

    const bodyStr = entry.body || '';
    const sourcePathMatch = bodyStr.match(/source_path:\s*([^\n\r]+)/);
    let originalSourcePath = '';
    if (sourcePathMatch && sourcePathMatch[1]) {
      originalSourcePath = sourcePathMatch[1].trim();
    }

    const isLog =
      originalSourcePath.includes('/Logs/') ||
      path.basename(originalSourcePath).startsWith('Digest-') ||
      cleanNameString(entry.summary).includes('digest');

    if (isLog) {
      // Connect to the virtual "Galaxia de Logs" hub
      const logsHubId = 'logs-galaxy-hub';
      if (!nodesMap.has(logsHubId)) {
        nodesMap.set(logsHubId, {
          id: logsHubId,
          label: 'Galaxia de Logs',
          type: 'wiki', // Make it type wiki so it is always visible even when phantoms (unresolved) are hidden
          project: entry.project || 'Miboveda', // Assign the log's project so it doesn't get filtered out
          linkCount: 0,
        });
      }
      edges.push({
        source: entry.id,
        target: logsHubId,
      });
      incrementLink(entry.id);
      incrementLink(logsHubId);
      // Skip normal wikilinks extraction for logs to maintain absolute gravity isolation
      continue;
    }

    const links = extractWikilinks(entry.body || '');

    const genNamesBlacklist = new Set(['readme', 'tasks', 'config', 'settings', 'index']);

    for (const linkTarget of links) {
      // e.g. '60 - Proyectos/VTuber/SC2' -> '60 - proyectos/vtuber/sc2' and 'sc2'
      const cleanFullTarget = linkTarget.replace(/\.md$/, '').toLowerCase();
      const baseTarget = path.basename(linkTarget);
      const cleanTarget = path.basename(baseTarget, path.extname(baseTarget)).toLowerCase();

      // 1. Try relative folder match first (Obsidian standard)
      const originDir = path.dirname(originalSourcePath);
      let relativePathTarget = path.join(originDir, linkTarget).replace(/\.md$/, '').toLowerCase();

      // Clean host absolute path prefix (e.g. '/home/zero/documentos/Miboveda/60 - Proyectos...')
      // in a case-insensitive way to match relative vault keys in aliasToIdMap (e.g. '60 - proyectos/...')
      const lowerPath = relativePathTarget.toLowerCase();
      const mibovedaIdx = lowerPath.indexOf('miboveda/');
      if (mibovedaIdx !== -1) {
        relativePathTarget = relativePathTarget.slice(mibovedaIdx + 9);
      } else {
        const brainIdx = lowerPath.indexOf('obsidian-brain/');
        if (brainIdx !== -1) {
          relativePathTarget = relativePathTarget.slice(brainIdx + 15);
        }
      }

      // Attempt to resolve target in existing entries:
      // Try relative match first, then full path match, then fallback to global name if not generic
      let targetId = aliasToIdMap.get(relativePathTarget) || aliasToIdMap.get(cleanFullTarget);

      if (!targetId && !genNamesBlacklist.has(cleanTarget)) {
        targetId = aliasToIdMap.get(cleanTarget) || aliasToIdMap.get(cleanNameString(cleanTarget));
      }

      if (targetId) {
        // Direct link to resolved node
        edges.push({
          source: entry.id,
          target: targetId,
        });
        incrementLink(entry.id);
        incrementLink(targetId);
      } else {
        // Node unresolved (phantom node)
        // Check if we already created a phantom node for this target name.
        // Use full target path or relative path to scope phantom nodes uniquely (prevents README collision)
        const phantomPath = relativePathTarget;
        const phantomId = `phantom-${phantomPath}`;
        if (!nodesMap.has(phantomId)) {
          nodesMap.set(phantomId, {
            id: phantomId,
            label: baseTarget, // Show only the basename as the label in the graph
            type: 'unresolved',
            linkCount: 0,
          });
        }

        edges.push({
          source: entry.id,
          target: phantomId,
        });
        incrementLink(entry.id);
        incrementLink(phantomId);
      }
    }
  }

  // 4. Update node sizes (linkCounts) and filter nodes if frontend filters are active
  const nodes: GraphNode[] = [];
  for (const [id, node] of nodesMap.entries()) {
    node.linkCount = linkCounts.get(id) || 0;
    nodes.push(node);
  }

  // Apply basic filtering to the graph nodes if filters are passed
  let filteredNodes = nodes;
  if (filter) {
    // Project filter
    if (filter.project && filter.project !== 'all') {
      if (filter.project === 'global') {
        filteredNodes = filteredNodes.filter((n) => {
          const entry = idToEntryMap.get(n.id);
          return entry?.tags.includes('global') || n.type === 'unresolved' || n.id === 'logs-galaxy-hub';
        });
      } else {
        filteredNodes = filteredNodes.filter(
          (n) => n.project === filter.project || n.type === 'unresolved' || n.id === 'logs-galaxy-hub'
        );
      }
    }

    // Type filter
    if (filter.types && filter.types.length > 0) {
      const typeSet = new Set<string>(filter.types);
      filteredNodes = filteredNodes.filter(
        (n) => typeSet.has(n.type) || n.type === 'unresolved' || n.id === 'logs-galaxy-hub'
      );
    }

    // Search filter
    if (filter.search && filter.search.trim()) {
      const q = filter.search.toLowerCase();
      filteredNodes = filteredNodes.filter((n) => n.label.toLowerCase().includes(q) || n.type === 'unresolved');
    }
  }

  // Filter edges to only keep links between nodes that are present in the filtered nodes list
  const nodeIds = new Set(filteredNodes.map((n) => n.id));
  const filteredEdges = edges.filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target));

  // If a node becomes disconnected (linkCount=0) after filtering and is unresolved, we can prune it
  const activeNodeIds = new Set<string>();
  for (const edge of filteredEdges) {
    activeNodeIds.add(edge.source);
    activeNodeIds.add(edge.target);
  }

  const finalNodes = filteredNodes.filter((n) => {
    if (n.type === 'unresolved') {
      return activeNodeIds.has(n.id); // Only keep connected phantom nodes
    }
    return true; // Keep all matching real nodes
  });

  return {
    nodes: finalNodes,
    edges: filteredEdges,
  };
}
