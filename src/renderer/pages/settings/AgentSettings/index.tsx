/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React from 'react';
import { Alert, Avatar, Button, Popconfirm, Spin, Switch, Tooltip, Typography } from '@arco-design/web-react';
import { useTranslation } from 'react-i18next';
import useSWR, { mutate } from 'swr';
import { ipcBridge } from '@/common';
import { getStaticBackendConfig, type AcpBackendConfig } from '@/common/types/acpTypes';
import { ConfigStorage } from '@/common/config/storage';
import { useHiddenAgents } from '@renderer/hooks/assistant/useHiddenAgents';
import { resolveAgentLogo } from '@renderer/utils/model/agentLogo';
import { resolveExtensionAssetUrl } from '@renderer/utils/platform';
import SettingsPageShell from '@renderer/pages/settings/components/SettingsPageShell';
import RemoteAgents from './RemoteAgents';
import { Pencil as PencilIcon, Plus as PlusIcon, Trash2 as TrashIcon } from 'lucide-react';
import AddCustomAgentModal, { type AgentModalTarget } from './AddCustomAgentModal';
import { resolveAgentScope } from './agentScopes';
import styles from './AgentsSettings.module.css';

/**
 * Shape of one detected agent - derived from the `acp.get-available-agents`
 * IPC return type so the page and the bridge contract cannot drift. `avatar`
 * is added locally because extension-contributed agents carry it on the same
 * record even though the bridge type predates the field.
 */
type AvailableAgentsResponse = Awaited<ReturnType<typeof ipcBridge.acpConversation.getAvailableAgents.invoke>>;
type DetectedAgent = NonNullable<AvailableAgentsResponse['data']>[number] & { avatar?: string };

/**
 * Detected agents whose model-scope warrants the full hero/featured card.
 * Keyed by `backend` - must stay consistent with the scope map in
 * `agentScopes.ts` (both are backend-keyed lists).
 */
const FEATURED_BACKENDS = ['wcore', 'claude', 'codex'];

/**
 * The Wayland Core hero card always renders, even when the live agent
 * detector returns no entry for it - the engine is always-available once a
 * model is connected. We compose a static metadata-only record here so the
 * page never goes wcore-less, and let the live detection result decide the
 * "Active" vs "Detected" badge.
 */
const WCORE_STATIC: DetectedAgent = {
  backend: 'wcore',
  name: 'Wayland Core',
  isExtension: false,
  isPreset: false,
};

/**
 * Resolve the best logo for a detected agent, falling back to an extension
 * asset URL when the agent is contributed by an extension.
 */
function agentLogo(agent: DetectedAgent): string | null {
  const extensionAvatar = resolveExtensionAssetUrl(agent.isExtension ? agent.avatar : undefined);
  return (
    extensionAvatar ||
    resolveAgentLogo({
      backend: agent.backend,
      customAgentId: agent.customAgentId,
      isExtension: agent.isExtension,
    })
  );
}

/**
 * Small per-agent Flux status chip. Driven by the backend's `fluxCompat`
 * classification in the registry (single source of truth via `getFluxCompat`):
 *  - 'env'    -> "Flux ready" (positive tone)
 *  - 'setup'  -> "Flux setup" (neutral tone)
 *  - 'vendor' -> "Native only" (muted tone) with a tooltip explaining why.
 * Renders nothing when the backend has no Flux classification.
 */
const FluxCompatChip: React.FC<{ backend: string }> = () => {
  return null;
};

/**
 * Per-agent "show in toolbar" toggle. Flipping it off removes the agent from
 * the Guid-page toolbar strip (it stays detected and listed here); flipping it
 * on restores it. Wayland Core is the always-available default backend, so its
 * toggle is locked on - the strip must keep at least one agent.
 */
const ToolbarToggle: React.FC<{
  backend: string;
  shown: boolean;
  locked: boolean;
  onChange: (shown: boolean) => void;
}> = ({ backend, shown, locked, onChange }) => {
  const { t } = useTranslation();
  const control = (
    <Switch
      size='small'
      checked={shown}
      disabled={locked}
      onChange={onChange}
      data-testid={`agent-toolbar-toggle-${backend}`}
      aria-label={t('settings.agentsPage.toolbarToggle.label')}
    />
  );
  if (locked) {
    return <Tooltip content={t('settings.agentsPage.toolbarToggle.lockedTooltip')}>{control}</Tooltip>;
  }
  return (
    <Tooltip content={t(shown ? 'settings.agentsPage.toolbarToggle.hide' : 'settings.agentsPage.toolbarToggle.show')}>
      {control}
    </Tooltip>
  );
};

/** Skip badges driven by the MERGED config (static registry + user overrides). */
const SkipBadges: React.FC<{ config: Partial<AcpBackendConfig>; compact?: boolean }> = ({ config, compact }) => {
  const base = compact
    ? 'text-[9px] font-mono px-1.5 py-0.2 rounded border'
    : 'text-[10px] font-mono px-2 py-0.5 rounded border';
  return (
    <>
      {config.skipConstitution && (
        <span className={`${base} bg-amber-500/10 text-amber-400 border-amber-500/20`}>⚡ Skip Constitution</span>
      )}
      {config.skipRulesInjection && (
        <span className={`${base} bg-blue-500/10 text-blue-400 border-blue-500/20`}>🚫 Skip Rules</span>
      )}
      {config.skipSkillsInjection && (
        <span className={`${base} bg-purple-500/10 text-purple-400 border-purple-500/20`}>📦 Skip Skills</span>
      )}
      {config.skipProviderEnv && (
        <span className={`${base} bg-emerald-500/10 text-emerald-400 border-emerald-500/20`}>🔑 Own keys</span>
      )}
      {config.skipModelControl && (
        <span className={`${base} bg-cyan-500/10 text-cyan-400 border-cyan-500/20`}>🎛 Own models</span>
      )}
    </>
  );
};

/**
 * One featured agent card (prototype `#screen-agents` `.acard`). States, in a
 * plain sentence, what models the agent runs - no "family" jargon, no padlock.
 */
const AgentCard: React.FC<{
  agent: DetectedAgent;
  hero: boolean;
  shown: boolean;
  locked: boolean;
  effective: Partial<AcpBackendConfig>;
  onToggle: (shown: boolean) => void;
  onEdit?: () => void;
}> = ({ agent, hero, shown, locked, effective, onToggle, onEdit }) => {
  const { t } = useTranslation();
  const scope = resolveAgentScope(agent.backend);
  const logo = agentLogo(agent);

  return (
    <div className={`${styles.card} ${hero ? styles.cardHero : ''}`} data-testid='agent-card'>
      <div className={styles.cardHead}>
        <Avatar size={42} shape='square' className={styles.avatar} style={{ backgroundColor: 'var(--color-fill-2)' }}>
          {logo ? <img src={logo} alt={agent.name} /> : '\u{1F916}'}
        </Avatar>
        <div className={styles.cardMain}>
          <div className={styles.name}>{agent.name}</div>
          <div className={styles.runsRow}>
            <span className={`${styles.runs} ${scope.accent ? '' : styles.runsMuted}`}>
              {t(`settings.agentsPage.scope.${scope.scopeKey}`)}
            </span>
            <FluxCompatChip backend={agent.backend} />
          </div>
          <div className={styles.desc}>{t(`settings.agentsPage.about.${agent.backend}`, { defaultValue: '' })}</div>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <SkipBadges config={effective} />
          </div>
        </div>
        <div className={styles.cardActions}>
          <span className={`${styles.badge} ${hero ? styles.badgeActive : styles.badgeDetected}`}>
            {hero && <span className={styles.badgeDot} />}
            {t(hero ? 'settings.agentsPage.badge.active' : 'settings.agentsPage.badge.detected')}
          </span>
          {onEdit && (
            <Tooltip content='Editar integraciones'>
              <Button size='mini' icon={<PencilIcon size={12} />} onClick={onEdit} />
            </Tooltip>
          )}
          <ToolbarToggle backend={agent.backend} shown={shown} locked={locked} onChange={onToggle} />
        </div>
      </div>
    </div>
  );
};

/**
 * One compact tile for a detected agent in the "More detected" grid
 * (prototype `.mtile`). Shows only the agent and its plain-language scope.
 */
const AgentTile: React.FC<{
  agent: DetectedAgent;
  shown: boolean;
  effective: Partial<AcpBackendConfig>;
  onToggle: (shown: boolean) => void;
  onEdit?: () => void;
}> = ({ agent, shown, effective, onToggle, onEdit }) => {
  const { t } = useTranslation();
  const scope = resolveAgentScope(agent.backend);
  const logo = agentLogo(agent);

  return (
    <div className={styles.tile} data-testid='agent-tile'>
      <Avatar size={28} shape='square' className={styles.tileAvatar} style={{ backgroundColor: 'var(--color-fill-2)' }}>
        {logo ? <img src={logo} alt={agent.name} /> : '\u{1F916}'}
      </Avatar>
      <div className={styles.tileText}>
        <div className={styles.tileName}>{agent.name}</div>
        <div className={styles.tileScopeRow}>
          <span className={styles.tileScope}>{t(`settings.agentsPage.scope.${scope.scopeKey}`)}</span>
          <FluxCompatChip backend={agent.backend} />
        </div>
        <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
          <SkipBadges config={effective} compact />
        </div>
      </div>
      {onEdit && (
        <Tooltip content='Editar integraciones'>
          <Button size='mini' icon={<PencilIcon size={12} />} onClick={onEdit} />
        </Tooltip>
      )}
      <ToolbarToggle backend={agent.backend} shown={shown} locked={false} onChange={onToggle} />
    </div>
  );
};

/** One tile for a user-defined custom profile (edit + delete actions). */
const CustomProfileTile: React.FC<{
  record: AcpBackendConfig;
  onEdit: () => void;
  onDelete: () => void;
}> = ({ record, onEdit, onDelete }) => {
  return (
    <div className={styles.tile} data-testid='custom-profile-tile'>
      <Avatar size={28} shape='square' className={styles.tileAvatar} style={{ backgroundColor: 'var(--color-fill-2)' }}>
        {'\u{1F9E9}'}
      </Avatar>
      <div className={styles.tileText}>
        <div className={styles.tileName}>{record.name}</div>
        <div className={styles.tileScopeRow}>
          <span className={styles.tileScope}>{record.defaultCliPath}</span>
        </div>
        <div className='flex items-center gap-1.5 mt-1 flex-wrap'>
          <SkipBadges config={record} compact />
        </div>
      </div>
      <Tooltip content='Editar perfil'>
        <Button size='mini' icon={<PencilIcon size={12} />} onClick={onEdit} />
      </Tooltip>
      <Popconfirm title='¿Eliminar este perfil?' okText='Eliminar' cancelText='Cancelar' onOk={onDelete}>
        <Button size='mini' status='danger' icon={<TrashIcon size={12} />} />
      </Popconfirm>
    </div>
  );
};

/**
 * Agents settings page - a clean sibling of the Models page (spec §4.7,
 * prototype `#screen-agents`).
 *
 * Three regions:
 *  1. Your agents - Wayland Core as the hero card plus Claude Code / Codex,
 *     each stating in plain language what models it runs.
 *  2. More detected - a compact tile grid for every other detected CLI agent.
 *  3. Remote agents - paired remote connections (OpenClaw, Hermes).
 *  4. Flux Router - live connection status plus the route-through-Flux toggle.
 */
/** One custom profile row plus the storage key it lives in (legacy records stay in `assistants` until edited). */
type CustomProfileEntry = { record: AcpBackendConfig; store: 'acp.customAgents' | 'assistants' };

const AgentsSettings: React.FC = () => {
  const { t } = useTranslation();
  const { isHidden, setAgentHidden } = useHiddenAgents();

  // Detected agents - built-in backends and extension-contributed agents,
  // excluding remote and user-custom agents (those have their own surfaces).
  const { data: detectedAgents, isLoading } = useSWR('acp.agents.available.agentsPage', async () => {
    const result = await ipcBridge.acpConversation.getAvailableAgents.invoke();
    if (result.success && result.data) {
      return result.data.filter((agent) => agent.backend !== 'remote' && agent.backend !== 'custom' && !agent.isPreset);
    }
    return [] as DetectedAgent[];
  });

  // Sub-detector load failures (e.g. a remote-agent DB read error) come back
  // separately so the user can tell "nothing detected" from "loading failed".
  const { data: loadErrors } = useSWR('acp.agents.loadErrors.agentsPage', async () => {
    const result = await ipcBridge.acpConversation.getLoadErrors.invoke();
    return result.success && result.data ? result.data : ([] as string[]);
  });

  const agents = detectedAgents ?? [];

  // Per-backend skip overrides the user saved from the edit modal. Merged over
  // the static registry to drive badges and the modal's initial values.
  const { data: backendOverrides, mutate: mutateOverrides } = useSWR('acp.backendOverrides.agentsPage', () =>
    ConfigStorage.get('acp.backendOverrides')
  );
  const effectiveConfig = (backend: string): Partial<AcpBackendConfig> => ({
    ...getStaticBackendConfig(backend),
    ...backendOverrides?.[backend],
  });

  // User-defined custom profiles - primary store plus legacy records that an
  // older modal build wrote into `assistants` (migrated to acp.customAgents on edit).
  const { data: customProfiles, mutate: mutateProfiles } = useSWR(
    'acp.customProfiles.agentsPage',
    async (): Promise<CustomProfileEntry[]> => {
      const [customs, assistants] = await Promise.all([
        ConfigStorage.get('acp.customAgents'),
        ConfigStorage.get('assistants'),
      ]);
      const entries: CustomProfileEntry[] = (customs ?? []).map((record) => ({
        record,
        store: 'acp.customAgents' as const,
      }));
      const customIds = new Set(entries.map((e) => e.record.id));
      for (const record of assistants ?? []) {
        if (!record.isPreset && record.id.startsWith('custom-') && !customIds.has(record.id)) {
          entries.push({ record, store: 'assistants' });
        }
      }
      return entries;
    }
  );

  const [modalTarget, setModalTarget] = React.useState<AgentModalTarget | null>(null);

  const handleModalSuccess = () => {
    void mutateOverrides();
    void mutateProfiles();
    void mutate('acp.agents.available.agentsPage');
  };

  const deleteCustomProfile = async (entry: CustomProfileEntry) => {
    const list = (await ConfigStorage.get(entry.store)) ?? [];
    await ConfigStorage.set(entry.store, list.filter((record) => record.id !== entry.record.id));
    await ipcBridge.acpConversation.refreshCustomAgents.invoke();
    handleModalSuccess();
  };

  const editButtonFor = (backend: string): (() => void) | undefined => {
    if (backend === 'wcore' || !getStaticBackendConfig(backend)) return undefined;
    return () => setModalTarget({ variant: 'builtin', backend, effective: effectiveConfig(backend) });
  };

  // Wayland Core is always-available - render its hero from static metadata
  // when the live detector doesn't return it, otherwise prefer the live row
  // (so any future detector-supplied fields like `cliPath` flow through).
  const detectedWcore = agents.find((a) => a.backend === 'wcore');
  const wcoreAgent = detectedWcore ?? WCORE_STATIC;
  const wcoreIsActive = Boolean(detectedWcore);
  const featuredRest = FEATURED_BACKENDS.filter((b) => b !== 'wcore').map((backend) =>
    agents.find((a) => a.backend === backend)
  );
  const featured: DetectedAgent[] = [wcoreAgent, ...featuredRest.filter((a): a is DetectedAgent => Boolean(a))];
  const featuredSet = new Set(featured.map((a) => a.backend));
  const moreDetected = agents.filter((a) => !featuredSet.has(a.backend));

  return (
    <SettingsPageShell
      title={t('settings.agentsPage.title')}
      subtitle={t('settings.agentsPage.subtitle')}
      breadcrumb={[{ label: t('settings.modelsPage.crumbAiModels') }, { label: t('settings.agentsPage.title') }]}
      contentClassName='md:max-w-[860px]'
    >
      {loadErrors && loadErrors.length > 0 && (
        <Alert
          type='warning'
          content={
            <div className='flex flex-col gap-4px'>
              <Typography.Text className='text-12px font-medium'>
                {t('settings.agentsPage.loadErrorsTitle')}
              </Typography.Text>
              {loadErrors.map((err) => (
                <Typography.Text key={err} className='text-12px'>
                  {err}
                </Typography.Text>
              ))}
            </div>
          }
        />
      )}

      {/* ---- Your agents ---- */}
      <div className='flex items-center justify-between mt-4 mb-2'>
        <div className={styles.sectionLabel}>{t('settings.agentsPage.yourAgents')}</div>
        <Button
          type='primary'
          size='small'
          icon={<PlusIcon size={14} />}
          onClick={() => setModalTarget({ variant: 'create' })}
        >
          Agregar Perfil / CLI
        </Button>
      </div>

      {isLoading && agents.length === 0 ? (
        <div className='flex justify-center py-32px'>
          <Spin />
        </div>
      ) : (
        <>
          <div className={styles.agentList}>
            {featured.map((agent) => (
              <AgentCard
                key={agent.backend}
                agent={agent}
                hero={agent.backend === 'wcore' ? wcoreIsActive : true}
                shown={agent.backend === 'wcore' ? true : !isHidden(agent.backend)}
                locked={agent.backend === 'wcore'}
                effective={effectiveConfig(agent.backend)}
                onToggle={(shown) => void setAgentHidden(agent.backend, !shown)}
                onEdit={editButtonFor(agent.backend)}
              />
            ))}
          </div>
          {agents.length === 0 && <div className={styles.emptyNote}>{t('settings.agentsPage.empty')}</div>}
        </>
      )}

      {/* ---- More detected ---- */}
      {moreDetected.length > 0 && (
        <>
          <div className={styles.sectionLabel}>
            {t('settings.agentsPage.moreDetected', { count: moreDetected.length })}
          </div>
          <div className={styles.tileGrid}>
            {moreDetected.map((agent) => (
              <AgentTile
                key={agent.backend}
                agent={agent}
                shown={!isHidden(agent.backend)}
                effective={effectiveConfig(agent.backend)}
                onToggle={(shown) => void setAgentHidden(agent.backend, !shown)}
                onEdit={editButtonFor(agent.backend)}
              />
            ))}
          </div>
        </>
      )}

      {/* ---- Custom profiles / CLIs ---- */}
      {customProfiles && customProfiles.length > 0 && (
        <>
          <div className={styles.sectionLabel}>Perfiles personalizados ({customProfiles.length})</div>
          <div className={styles.tileGrid}>
            {customProfiles.map((entry) => (
              <CustomProfileTile
                key={entry.record.id}
                record={entry.record}
                onEdit={() => setModalTarget({ variant: 'custom', record: entry.record, store: entry.store })}
                onDelete={() => void deleteCustomProfile(entry)}
              />
            ))}
          </div>
        </>
      )}

      {/* ---- Remote agents (OpenClaw, Hermes) ---- */}
      <div className={styles.sectionLabel}>{t('settings.agentsPage.remoteAgents')}</div>
      <RemoteAgents />

      <AddCustomAgentModal
        visible={modalTarget !== null}
        target={modalTarget ?? { variant: 'create' }}
        onClose={() => setModalTarget(null)}
        onSuccess={handleModalSuccess}
      />
    </SettingsPageShell>
  );
};

export default AgentsSettings;
