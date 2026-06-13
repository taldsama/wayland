import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Message, Modal } from '@arco-design/web-react';
import {
  useMcpServers,
  useMcpAgentStatus,
  useMcpOperations,
  useMcpOAuth,
  useMcpServerCRUD,
  useMcpConnection,
} from '@renderer/hooks/mcp';
import type { IMcpServer } from '@/common/config/storage';
import AddMcpServerModal from '@renderer/pages/settings/components/AddMcpServerModal';
import { useMcpLibrary } from './hooks/useMcpLibrary';
import { ServerRow } from './components/ServerRow';
import { McpLibraryTabs } from './components/McpLibraryTabs';
import { deriveStatus, type UIStatus } from './status';

type InstalledFilter = 'all' | 'running' | 'warn' | 'error';

export function InstalledPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const library = useMcpLibrary();

  const [message, contextHolder] = Message.useMessage();
  const [showAddModal, setShowAddModal] = useState(false);
  const [filter, setFilter] = useState<InstalledFilter>('all');
  const { mcpServers, saveMcpServers } = useMcpServers();
  const { setAgentInstallStatus, checkSingleServerInstallStatus } = useMcpAgentStatus();
  const { syncMcpToAgents, removeMcpFromAgents } = useMcpOperations(mcpServers, message);
  const { oauthStatus, login } = useMcpOAuth();
  const crud = useMcpServerCRUD(
    mcpServers,
    saveMcpServers,
    syncMcpToAgents,
    removeMcpFromAgents,
    checkSingleServerInstallStatus,
    setAgentInstallStatus
  );
  const { testingServers, refreshServerStatuses } = useMcpConnection(mcpServers, saveMcpServers, message);

  // On first load, probe enabled servers so the status strip + per-row pills
  // reflect reality (connected + real tool counts) instead of stale config.
  // refreshServerStatuses is non-destructive and self-throttles via lastConnected.
  const didInitialRefresh = useRef(false);
  useEffect(() => {
    if (didInitialRefresh.current || mcpServers.length === 0) return;
    didInitialRefresh.current = true;
    void refreshServerStatuses(mcpServers);
  }, [mcpServers, refreshServerStatuses]);

  // Resolve every server's status once so the stat strip, the filter, and the
  // rows all agree (and we never recompute deriveStatus three times per server).
  const statusById = useMemo(() => {
    const map: Record<string, UIStatus> = {};
    for (const s of mcpServers) map[s.id] = deriveStatus(s, oauthStatus[s.id]);
    return map;
  }, [mcpServers, oauthStatus]);

  const matchesFilter = useCallback(
    (s: IMcpServer) => filter === 'all' || statusById[s.id] === filter,
    [filter, statusById]
  );

  const fromLibrary = useMemo(
    () => mcpServers.filter((s) => s.source === 'library' && matchesFilter(s)),
    [mcpServers, matchesFilter]
  );
  const custom = useMemo(
    () => mcpServers.filter((s) => s.source !== 'library' && matchesFilter(s)),
    [mcpServers, matchesFilter]
  );

  const summary = useMemo(() => {
    let running = 0;
    let warn = 0;
    let error = 0;
    for (const s of mcpServers) {
      const status = statusById[s.id];
      if (status === 'running') running++;
      else if (status === 'warn') warn++;
      else if (status === 'error') error++;
    }
    const tools = mcpServers.reduce((n, s) => n + (s.tools?.length ?? 0), 0);
    return { running, warn, error, tools };
  }, [mcpServers, statusById]);

  const handleToggle = useCallback(
    async (s: IMcpServer) => {
      const enabling = !s.enabled;
      await crud.handleToggleMcpServer(s.id, enabling);
      // Probe right after enabling so the row resolves to its real state
      // (connected + tools, needs-auth, or error) instead of sitting on "Idle".
      if (enabling) void refreshServerStatuses([{ ...s, enabled: true }], { force: true });
    },
    [crud, refreshServerStatuses]
  );

  const handleReauth = useCallback(
    async (s: IMcpServer) => {
      const result = await login(s);
      if (result.success === true) {
        message.success(t('mcpLibrary.install.oauthSuccess', 'Authorized.'));
        return;
      }
      if (result.success === false && result.code === 'needs_byo') {
        // Drop the user onto the detail page where the BYO modal lives - the
        // installed-page row UI doesn't have room for the credential inputs.
        if (s.libraryEntryId) {
          navigate(`/settings/mcp-library/${encodeURIComponent(s.libraryEntryId)}`);
          return;
        }
      }
      message.error(
        t('mcpLibrary.install.oauthFailed', 'Authorization failed: {{error}}', {
          error: (result.success === false && result.error) || 'Unknown error',
        })
      );
    },
    [login, message, t, navigate]
  );

  const handleSettings = useCallback(
    (s: IMcpServer) => {
      if (s.source === 'library' && s.libraryEntryId) {
        navigate(`/settings/mcp-library/${encodeURIComponent(s.libraryEntryId)}`);
      } else {
        message.info(t('mcpLibrary.installed.customNoDetail', "Custom servers don't have a detail page yet."));
      }
    },
    [navigate, message, t]
  );

  const handleLogs = useCallback(() => {
    message.info(t('mcpLibrary.installed.logsToast', 'Log viewer coming soon.'));
  }, [message, t]);

  const handleReconnect = useCallback(
    async (s: IMcpServer) => {
      try {
        // Re-enable re-pushes the server config to every agent; running workers
        // pick it up on their next message via the MCP-changed refresh. Then
        // probe so the row + strip show the freshly resolved status and tools.
        await crud.handleToggleMcpServer(s.id, true);
        void refreshServerStatuses([{ ...s, enabled: true }], { force: true });
        message.success(
          t(
            'mcpLibrary.installed.reconnectToast',
            'Reconnecting {{name}} - agents will pick it up on the next message.',
            {
              name: s.name,
            }
          )
        );
      } catch {
        message.error(t('settings.mcpSyncError', 'Failed to sync MCP to agents.'));
      }
    },
    [crud, message, t, refreshServerStatuses]
  );

  const handleRemove = useCallback(
    (s: IMcpServer) => {
      Modal.confirm({
        title: t('mcpLibrary.installed.actionRemove', 'Remove'),
        content: t(
          'mcpLibrary.installed.removeConfirm',
          'Remove {{name}} from your library? This will also uninstall it from all CLI agents.',
          { name: s.name }
        ),
        okText: t('mcpLibrary.installed.actionRemove', 'Remove'),
        cancelText: t('mcpLibrary.installed.confirmCancel', 'Cancel'),
        okButtonProps: { status: 'danger' },
        onOk: async () => {
          await crud.handleDeleteMcpServer(s.id);
        },
      });
    },
    [crud, t]
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

  const renderRow = (s: IMcpServer) => {
    const entry = s.libraryEntryId ? library.entries.find((e) => e.id === s.libraryEntryId) : undefined;
    const oauth = oauthStatus[s.id];
    const status = statusById[s.id];
    return (
      <ServerRow
        key={s.id}
        server={{
          id: s.id,
          name: entry?.name ?? s.name,
          source: s.source,
          libraryEntryId: s.libraryEntryId,
          status,
          toolCount: s.tools?.length ?? 0,
          publisher: entry?.id ?? s.name,
          enabled: s.enabled,
          lastError: s.lastError,
        }}
        iconUrl={entry?.iconUrl}
        oauthStatus={oauth}
        checking={testingServers[s.id] === true}
        onReauth={() => void handleReauth(s)}
        onSettings={() => handleSettings(s)}
        onRemove={() => handleRemove(s)}
        onToggle={() => void handleToggle(s)}
        onLogs={handleLogs}
        onReconnect={() => void handleReconnect(s)}
      />
    );
  };

  return (
    <div className='mcp-installed-page'>
      {contextHolder}
      <header className='mcp-page-head'>
        <h2>{t('mcpLibrary.installed.title', 'MCP Library - Installed')}</h2>
        <button className='mcp-btn-primary' onClick={() => setShowAddModal(true)}>
          {t('mcpLibrary.installed.addCustom', '+ Add MCP')}
        </button>
      </header>

      <McpLibraryTabs active='installed' installedCount={mcpServers.length} />

      <div className='mcp-status-strip'>
        <button
          type='button'
          className={`mcp-status-cell mcp-status-all${filter === 'all' ? ' is-active' : ''}`}
          aria-pressed={filter === 'all'}
          onClick={() => setFilter('all')}
        >
          <b>{mcpServers.length}</b> {t('mcpLibrary.installed.statusAllCountLabel', 'All')}
        </button>
        <button
          type='button'
          className={`mcp-status-cell mcp-status-running${filter === 'running' ? ' is-active' : ''}`}
          aria-pressed={filter === 'running'}
          onClick={() => setFilter((f) => (f === 'running' ? 'all' : 'running'))}
        >
          <b>{summary.running}</b> {t('mcpLibrary.installed.statusRunningCountLabel', 'Running')}
        </button>
        <button
          type='button'
          className={`mcp-status-cell mcp-status-warn${filter === 'warn' ? ' is-active' : ''}`}
          aria-pressed={filter === 'warn'}
          onClick={() => setFilter((f) => (f === 'warn' ? 'all' : 'warn'))}
        >
          <b>{summary.warn}</b> {t('mcpLibrary.installed.statusReauthCountLabel', 'Needs sign-in')}
        </button>
        <button
          type='button'
          className={`mcp-status-cell mcp-status-error${filter === 'error' ? ' is-active' : ''}`}
          aria-pressed={filter === 'error'}
          onClick={() => setFilter((f) => (f === 'error' ? 'all' : 'error'))}
        >
          <b>{summary.error}</b> {t('mcpLibrary.installed.statusErrorCountLabel', 'Error')}
        </button>
        <div className='mcp-status-cell mcp-status-tools'>
          <b>{summary.tools}</b> {t('mcpLibrary.installed.statusToolCountLabel', 'Tools available')}
        </div>
      </div>

      <section>
        <header className='mcp-group-head'>
          <h3>{t('mcpLibrary.installed.fromLibrary', 'From Library')}</h3>
          <button onClick={() => navigate('/settings/mcp-library/browse')}>
            {t('mcpLibrary.installed.browseLibrary', '+ Browse library')}
          </button>
        </header>
        {fromLibrary.length === 0 ? (
          <div className='mcp-empty'>
            {filter === 'all'
              ? t('mcpLibrary.installed.empty', 'No MCPs installed yet. Browse the library to add one.')
              : t('mcpLibrary.installed.emptyFilter', 'Nothing here matches this filter.')}
          </div>
        ) : (
          <div className='mcp-server-list'>{fromLibrary.map(renderRow)}</div>
        )}
      </section>

      <section>
        <header className='mcp-group-head'>
          <h3>{t('mcpLibrary.installed.custom', 'Custom')}</h3>
          <button onClick={() => setShowAddModal(true)}>
            {t('mcpLibrary.installed.addCustom', '+ Add custom MCP')}
          </button>
        </header>
        {custom.length === 0 ? (
          <div className='mcp-empty'>
            {filter === 'all'
              ? t('mcpLibrary.installed.customEmpty', 'No custom MCPs.')
              : t('mcpLibrary.installed.emptyFilter', 'Nothing here matches this filter.')}
          </div>
        ) : (
          <div className='mcp-server-list'>{custom.map(renderRow)}</div>
        )}
      </section>

      <AddMcpServerModal
        visible={showAddModal}
        onCancel={() => setShowAddModal(false)}
        onSubmit={handleAddSubmit}
        onBatchImport={handleAddBatch}
      />
    </div>
  );
}
