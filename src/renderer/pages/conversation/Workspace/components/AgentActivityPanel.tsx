/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import {
  Activity as ActivityIcon,
  Check,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock,
  Coins,
  Users,
  Wrench,
  XCircle,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAgentActivity } from '../hooks/useAgentActivity';
import type { ActivityCounters, ActivityTask, ActivityToolCall } from '../types';
import styles from './activity.module.css';

type AgentActivityPanelProps = {
  conversationId?: string;
};

const STATUS_ICON = {
  running: CircleDot,
  done: Check,
  failed: XCircle,
} as const;

function formatTime(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function CounterChip({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div className={styles.counterChip} title={label}>
      <span className={styles.counterIcon}>{icon}</span>
      <span className={styles.counterValue}>{value}</span>
    </div>
  );
}

function ToolRow({ call, t }: { call: ActivityToolCall; t: TFunction }) {
  const [open, setOpen] = useState(false);
  const Icon = STATUS_ICON[call.status] ?? CircleDot;
  return (
    <div
      className={styles.toolRow}
      onClick={() => (call.detail ? setOpen((v) => !v) : undefined)}
    >
      <span className={`${styles.toolStatus} ${styles[`toolStatus_${call.status}`]}`}>
        <Icon size={12} />
      </span>
      <span className={styles.toolName}>{call.name}</span>
      {call.agent ? <span className={styles.toolAgent}>{call.agent}</span> : null}
      <span className={styles.toolTime}>{formatTime(call.startTime)}</span>
      {call.detail ? (
        <span className={styles.toolChevron}>
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </span>
      ) : null}
      {open && call.detail ? (
        <div className={styles.toolDetail}>
          <pre className={styles.toolDetailPre}>{call.detail}</pre>
        </div>
      ) : null}
    </div>
  );
}

function TaskBlock({ task, t }: { task: ActivityTask; t: TFunction }) {
  const [open, setOpen] = useState(true);
  const doneCount = task.calls.filter((c) => c.status === 'done').length;
  return (
    <div className={styles.taskBlock}>
      <div className={styles.taskHeader} onClick={() => setOpen((v) => !v)}>
        <span className={`${styles.taskDot} ${task.running ? styles.taskDot_running : ''}`} />
        <span className={styles.taskTitle}>
          {task.title || t('conversation.workspace.activity.untitled', { defaultValue: '(sin título)' })}
        </span>
        <span className={styles.taskMeta}>
          {doneCount}/{task.calls.length}
        </span>
        <span className={styles.taskChevron}>
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </span>
      </div>
      {open ? (
        <div className={styles.taskCalls}>
          {task.calls.length === 0 ? (
            <div className={styles.taskEmpty}>
              {t('conversation.workspace.activity.emptyTask', { defaultValue: 'No tool calls' })}
            </div>
          ) : (
            task.calls.map((c) => <ToolRow key={c.id} call={c} t={t} />)
          )}
        </div>
      ) : null}
    </div>
  );
}

function stopLabel(state: 'auto' | 'stopping' | 'standby', t: TFunction): string {
  if (state === 'auto') {
    return t('conversation.workspace.activity.autoOn', { defaultValue: 'Auto-loop ON' });
  }
  if (state === 'stopping') {
    return t('conversation.workspace.activity.stopping', { defaultValue: 'Finishing turn…' });
  }
  return t('conversation.workspace.activity.standby', { defaultValue: 'Standby' });
}

export default function AgentActivityPanel({ conversationId }: AgentActivityPanelProps) {
  const { t } = useTranslation();
  const { tasks, counters, loading } = useAgentActivity(conversationId);
  const [autoLoop, setAutoLoop] = useState(false);

  const running = tasks.some((x) => x.running);
  const loopState: 'auto' | 'stopping' | 'standby' = autoLoop ? 'auto' : running ? 'stopping' : 'standby';

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <div className={styles.countersRow}>
          <CounterChip
            icon={<ActivityIcon size={13} />}
            label={t('conversation.workspace.activity.api', { defaultValue: 'API (turns + calls)' })}
            value={counters.api}
          />
    <CounterChip
      icon={<Wrench size={13} />}
      label={t('conversation.workspace.activity.tools', { defaultValue: 'Tool calls' })}
      value={counters.calls}
    />

          <CounterChip
            icon={<Coins size={13} />}
            label={t('conversation.workspace.activity.tokens', { defaultValue: 'Tokens' })}
            value={counters.tokens > 999 ? `${(counters.tokens / 1000).toFixed(1)}k` : counters.tokens}
          />
          <CounterChip
            icon={<Users size={13} />}
            label={t('conversation.workspace.activity.prompts', { defaultValue: 'Human prompts' })}
            value={counters.prompts}
          />
          <CounterChip
            icon={<Clock size={13} />}
            label={t('conversation.workspace.activity.waitingReplies', { defaultValue: 'Waiting replies' })}
            value={counters.waitingReplies}
          />
        </div>
        <button
          type="button"
          className={`${styles.loopButton} ${styles[`loop_${loopState}`]}`}
          onClick={() => setAutoLoop((v) => !v)}
          data-testid="activity-autoloop"
        >
          <span className={styles.loopDot} />
          <span>{stopLabel(loopState, t)}</span>
        </button>
      </div>

      <div className={styles.timeline}>
        {loading && tasks.length === 0 ? (
          <div className={styles.empty}>
            {t('conversation.workspace.activity.loading', { defaultValue: 'Loading activity…' })}
          </div>
        ) : tasks.length === 0 ? (
          <div className={styles.empty}>
            {t('conversation.workspace.activity.empty', { defaultValue: 'No tool calls yet' })}
          </div>
        ) : (
          tasks.map((task) => <TaskBlock key={task.id} task={task} t={t} />)
        )}
      </div>
    </div>
  );
}
