/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useMemo, useState } from 'react';
import { Button } from '@arco-design/web-react';
import { IconClose } from '@arco-design/web-react/icon';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';
import { ConfigStorage } from '@/common/config/storage';
import { useModelRegistry } from '@/renderer/hooks/useModelRegistry';
import type { IntentPrompt } from '../../intents';
import styles from './WaylandCapabilitiesPanel.module.css';

/** Runtime id of the built-in Concierge assistant (see initStorage `builtin-${preset.id}`). */
const CONCIERGE_ASSISTANT_ID = 'builtin-concierge';

export type WaylandCapabilitiesPanelProps = {
  /**
   * Fires when the user picks a suggestion. Caller (GuidPage) fills the input
   * with the prompt text and routes the assistant - same contract as
   * IntentSuggestionPanel's `onSelect`, so `handleSelectIntentPrompt` is reused.
   */
  onSelect: (prompt: IntentPrompt) => void;
};

/** One live-state suggestion row. `key` is stable for keyed render + tests. */
type CapabilityRow = {
  key: string;
  prompt: IntentPrompt;
};

/**
 * Live-state "What can Wayland do?" suggestion panel for the cold-start home
 * surface. Reads the user's real setup - connected providers, scheduled tasks,
 * and installed skills - and tailors 3-5 Concierge starter rows to it:
 *
 *   - 0 providers connected   → "Connect a model"
 *   - has providers, 0 crons  → "Schedule a daily digest"
 *   - always                  → "Find a skill", "Explore features"
 *   - has scheduled tasks     → "Why didn't my task run?"
 *
 * Every row routes to the Concierge assistant. All reads are best-effort and
 * guarded so a missing/failing IPC never crashes the home page.
 *
 * Honesty rules for this high-trust surface (Phase-2a audit):
 *   - The skill count is NEVER rendered as 0 or a placeholder - a non-numeric
 *     label shows until the live count resolves positive, then the number swaps
 *     in. "Find the right skill out of 0" would invert the specificity signal.
 *   - State-specific rows only appear when their state is real: the
 *     "why didn't my task run?" row is gated behind `scheduledCount > 0` so the
 *     panel never suggests debugging a task the user never created.
 *
 * The panel is dismissable: a user (e.g. a power user who already knows the
 * surface) can close it, and the choice persists via `concierge.panelDismissed`.
 */
const WaylandCapabilitiesPanel: React.FC<WaylandCapabilitiesPanelProps> = ({ onSelect }) => {
  const { t } = useTranslation();
  const { providers, reload } = useModelRegistry();
  const [scheduledCount, setScheduledCount] = useState(0);
  const [skillCount, setSkillCount] = useState(0);
  // Providers start empty (the hook skips its mount list() here), so the
  // provider-dependent rows must wait for the first reload() to resolve - else a
  // user who already has providers sees a "Connect a model" flash on first paint.
  const [providersResolved, setProvidersResolved] = useState(false);
  // null = not yet known (avoid a show-then-hide flash); true = dismissed.
  const [dismissed, setDismissed] = useState<boolean | null>(null);

  // Load the persisted dismissed state once. Best-effort: a read failure leaves
  // the panel visible (fail-open is correct for a help surface).
  useEffect(() => {
    let active = true;
    ConfigStorage.get('concierge.panelDismissed')
      .then((value) => {
        if (active) setDismissed(value === true);
      })
      .catch(() => {
        if (active) setDismissed(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // The home page sits outside ModelRegistryProvider, so the standalone hook
  // skips its mount-time list(). Pull one fresh providers snapshot so the
  // "connect a model" branch reflects real state. `reload` is stable.
  useEffect(() => {
    Promise.resolve(reload())
      .catch(() => {
        /* best-effort: a failed reload still resolves the gate (fail-open) */
      })
      .finally(() => setProvidersResolved(true));
  }, [reload]);

  // Scheduled tasks (best-effort, guarded).
  useEffect(() => {
    let active = true;
    void ipcBridge.cron?.listJobs
      ?.invoke?.()
      .then((jobs) => {
        if (active) setScheduledCount(Array.isArray(jobs) ? jobs.length : 0);
      })
      .catch(() => {
        if (active) setScheduledCount(0);
      });
    return () => {
      active = false;
    };
  }, []);

  // Installed skills count (best-effort, guarded).
  useEffect(() => {
    let active = true;
    void ipcBridge.fs?.listAvailableSkills
      ?.invoke?.()
      .then((skills) => {
        if (active) setSkillCount(Array.isArray(skills) ? skills.length : 0);
      })
      .catch(() => {
        if (active) setSkillCount(0);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleDismiss = () => {
    setDismissed(true);
    ConfigStorage.set('concierge.panelDismissed', true).catch((error) => {
      console.error('Failed to persist Concierge panel dismissal:', error);
    });
  };

  const rows = useMemo<CapabilityRow[]>(() => {
    const list: CapabilityRow[] = [];
    const providerCount = Array.isArray(providers) ? providers.length : 0;

    // Only surface a provider-state row once we actually know the provider state
    // (avoids telling a user with providers to "connect a model" on first paint).
    if (providersResolved) {
      if (providerCount === 0) {
        list.push({
          key: 'connectModel',
          prompt: {
            title: t('concierge.suggest.connectModel.title'),
            promptText: t('concierge.suggest.connectModel.prompt'),
            targetAssistantId: CONCIERGE_ASSISTANT_ID,
          },
        });
      } else if (scheduledCount === 0) {
        list.push({
          key: 'scheduleDigest',
          prompt: {
            title: t('concierge.suggest.scheduleDigest.title'),
            promptText: t('concierge.suggest.scheduleDigest.prompt'),
            targetAssistantId: CONCIERGE_ASSISTANT_ID,
          },
        });
      }
    }

    list.push(
      {
        key: 'findSkill',
        prompt: {
          // Never render "out of 0": show a non-numeric label until the live
          // count resolves positive, then swap in the real number.
          title:
            skillCount > 0
              ? t('concierge.suggest.findSkill.title', { count: skillCount })
              : t('concierge.suggest.findSkill.titleNoCount'),
          promptText: t('concierge.suggest.findSkill.prompt'),
          targetAssistantId: CONCIERGE_ASSISTANT_ID,
        },
      },
      {
        key: 'exploreFeatures',
        prompt: {
          title: t('concierge.suggest.exploreFeatures.title'),
          promptText: t('concierge.suggest.exploreFeatures.prompt'),
          targetAssistantId: CONCIERGE_ASSISTANT_ID,
        },
      }
    );

    // Only surface the diagnostic row when there is actually a scheduled task to
    // reason about - otherwise it suggests debugging something that doesn't exist.
    if (scheduledCount > 0) {
      list.push({
        key: 'whyDidntRun',
        prompt: {
          title: t('concierge.suggest.whyDidntRun.title'),
          promptText: t('concierge.suggest.whyDidntRun.prompt'),
          targetAssistantId: CONCIERGE_ASSISTANT_ID,
        },
      });
    }

    return list;
  }, [providers, providersResolved, scheduledCount, skillCount, t]);

  if (dismissed !== false) return null;

  return (
    <section className={styles.panel} data-testid='capabilities-panel' aria-label={t('concierge.panel.title')}>
      <header className={styles.header}>
        <div className={styles.heading}>
          <span className={styles.title}>{t('concierge.panel.title')}</span>
          <span className={styles.subtitle}>{t('concierge.panel.subtitle')}</span>
        </div>
        <Button
          type='text'
          size='mini'
          className={styles.dismiss}
          aria-label={t('concierge.panel.dismiss')}
          data-testid='capabilities-panel-dismiss'
          icon={<IconClose />}
          onClick={handleDismiss}
        />
      </header>
      <ul className={styles.rowList}>
        {rows.map((row) => (
          <li key={row.key} data-testid='capability-row' data-suggest-key={row.key}>
            <Button type='text' long className={styles.row} onClick={() => onSelect(row.prompt)}>
              <span className={styles.rowTitle}>{row.prompt.title}</span>
              <span className={styles.rowText}>{row.prompt.promptText}</span>
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default WaylandCapabilitiesPanel;
