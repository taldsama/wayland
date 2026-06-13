import React, { useCallback, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Message } from '@arco-design/web-react';
import { useMcpLibrary } from './hooks/useMcpLibrary';
import {
  useMcpServers,
  useMcpAgentStatus,
  useMcpOperations,
  useMcpServerCRUD,
  useMcpOAuth,
} from '@renderer/hooks/mcp';
import type { IMcpServer } from '@/common/config/storage';
import AddMcpServerModal from '@renderer/pages/settings/components/AddMcpServerModal';
import { RecommendedGrid } from './components/RecommendedGrid';
import { CategorySection } from './components/CategorySection';
import { TierFilter } from './components/TierFilter';
import { McpLibraryTabs } from './components/McpLibraryTabs';
import { deriveStatus, needsAttention, type UIStatus } from './status';
import type { Tier, CatalogIndexEntry } from './types';

type Availability = 'all' | 'installed' | 'available' | 'attention';

export function BrowsePage() {
  const { t } = useTranslation();
  const library = useMcpLibrary();
  const { mcpServers, saveMcpServers } = useMcpServers();
  const navigate = useNavigate();

  const [message, contextHolder] = Message.useMessage();
  const [showAddModal, setShowAddModal] = useState(false);
  const { setAgentInstallStatus, checkSingleServerInstallStatus } = useMcpAgentStatus();
  const { syncMcpToAgents, removeMcpFromAgents } = useMcpOperations(mcpServers, message);
  const { oauthStatus } = useMcpOAuth();
  const crud = useMcpServerCRUD(
    mcpServers,
    saveMcpServers,
    syncMcpToAgents,
    removeMcpFromAgents,
    checkSingleServerInstallStatus,
    setAgentInstallStatus
  );

  const handleAddSubmit = useCallback(
    (serverData: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>) => {
      void crud.handleAddMcpServer(serverData);
    },
    [crud]
  );

  const handleAddBatch = useCallback(
    (servers: Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>[]) => {
      void crud.handleBatchImportMcpServers(servers);
    },
    [crud]
  );

  const installedIds = useMemo(
    () => new Set(mcpServers.map((s) => s.libraryEntryId).filter(Boolean) as string[]),
    [mcpServers],
  );

  // Health of each installed catalog entry, keyed by its catalog id, so a broken
  // or sign-in-needed connector is flagged right on its Browse card.
  const statusByLibraryId = useMemo(() => {
    const map: Record<string, UIStatus> = {};
    for (const s of mcpServers) {
      if (s.libraryEntryId) map[s.libraryEntryId] = deriveStatus(s, oauthStatus[s.id]);
    }
    return map;
  }, [mcpServers, oauthStatus]);

  const [tier, setTier] = useState<Tier | 'all'>('all');
  const [avail, setAvail] = useState<Availability>('all');
  const [search, setSearch] = useState('');

  const matchesAvail = useCallback(
    (id: string) => {
      const installed = installedIds.has(id);
      switch (avail) {
        case 'installed':
          return installed;
        case 'available':
          return !installed;
        case 'attention': {
          const st = statusByLibraryId[id];
          return installed && st !== undefined && needsAttention(st);
        }
        default:
          return true;
      }
    },
    [avail, installedIds, statusByLibraryId],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return library.entries.filter(
      (e) =>
        (tier === 'all' || e.tier === tier) &&
        matchesAvail(e.id) &&
        (q === '' ||
          e.name.toLowerCase().includes(q) ||
          e.shortDescription.toLowerCase().includes(q)),
    );
  }, [library.entries, tier, search, matchesAvail]);

  const counts = {
    all: library.entries.length,
    core: library.byTier.core.length,
    worker: library.byTier.worker.length,
    builder: library.byTier.builder.length,
  };

  const availCounts = useMemo(() => {
    let installed = 0;
    let attention = 0;
    for (const e of library.entries) {
      if (installedIds.has(e.id)) {
        installed++;
        const st = statusByLibraryId[e.id];
        if (st !== undefined && needsAttention(st)) attention++;
      }
    }
    return {
      all: library.entries.length,
      installed,
      available: library.entries.length - installed,
      attention,
    };
  }, [library.entries, installedIds, statusByLibraryId]);

  const categoryOrder = [
    'communication',
    'files-and-docs',
    'calendar',
    'developer',
    'code',
    'productivity',
    'search',
    'automation',
    'browser',
    'crm',
    'data',
    'devops',
    'home-automation',
    'infrastructure',
    'iot',
    'knowledge',
    'media',
    'news',
    'observability',
    'payments',
    'research',
    'sales',
    'tasks',
    'personal',
  ];

  const filteredByCategory = useMemo(() => {
    const map: Record<string, CatalogIndexEntry[]> = {};
    for (const e of filtered) {
      const primary = e.categories[0] ?? 'personal';
      (map[primary] ??= []).push(e);
    }
    return map;
  }, [filtered]);

  const onSelect = (id: string) =>
    navigate(`/settings/mcp-library/${encodeURIComponent(id)}`);

  return (
    <div className="mcp-library-page">
      {contextHolder}
      <header className="mcp-page-head">
        <div>
          <h2>MCP Library</h2>
          <p>
            Curated connectors. Browse, install with one click, and follow the setup guide.
          </p>
        </div>
        <button className="mcp-btn-primary" onClick={() => setShowAddModal(true)}>
          {t('mcpLibrary.installed.addCustom', '+ Add MCP')}
        </button>
      </header>

      <McpLibraryTabs active="browse" installedCount={mcpServers.length} />

      <div className="mcp-filter-bar">
        <input
          className="mcp-search"
          placeholder={t('mcpLibrary.browse.searchPlaceholder', 'Search MCPs…')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <TierFilter active={tier} counts={counts} onChange={setTier} />
        <div className="mcp-avail-filter">
          {(
            [
              { key: 'installed', label: t('mcpLibrary.browse.availInstalled', 'Installed') },
              { key: 'available', label: t('mcpLibrary.browse.availAvailable', 'Available') },
              { key: 'attention', label: t('mcpLibrary.browse.availAttention', 'Needs attention') },
            ] as { key: Exclude<Availability, 'all'>; label: string }[]
          ).map((opt) => {
            const count = availCounts[opt.key];
            if (opt.key === 'attention' && count === 0 && avail !== 'attention') return null;
            const active = avail === opt.key;
            return (
              <button
                key={opt.key}
                className={`mcp-chip ${active ? 'is-active' : ''} ${opt.key === 'attention' && count > 0 ? 'mcp-chip-attention' : ''}`}
                aria-pressed={active}
                onClick={() => setAvail(active ? 'all' : opt.key)}
              >
                {opt.label} <span className="mcp-chip-count">{count}</span>
              </button>
            );
          })}
        </div>
      </div>

      {search === '' && tier === 'all' && avail === 'all' && (
        <RecommendedGrid
          entries={library.recommended}
          installedIds={installedIds}
          statusByLibraryId={statusByLibraryId}
          onSelect={onSelect}
        />
      )}

      {filtered.length === 0 ? (
        <div className="mcp-empty">
          {t('mcpLibrary.browse.emptyFilter', 'No connectors match your search and filters.')}
        </div>
      ) : (
        categoryOrder.map((cat) => (
          <CategorySection
            key={cat}
            category={cat}
            entries={filteredByCategory[cat] ?? []}
            installedIds={installedIds}
            statusByLibraryId={statusByLibraryId}
            onSelect={onSelect}
          />
        ))
      )}

      <AddMcpServerModal
        visible={showAddModal}
        onCancel={() => setShowAddModal(false)}
        onSubmit={handleAddSubmit}
        onBatchImport={handleAddBatch}
      />
    </div>
  );
}
