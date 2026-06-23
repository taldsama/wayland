/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ActivityNode, IMessageActivity } from '@/common/chat/chatLib';
import { Badge, Tag } from '@arco-design/web-react';
import { Down, Right } from '@icon-park/react';
import type { TFunction } from 'i18next';
import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import styles from './MessageActivity.module.css';

/**
 * #252 - composite, collapsible "activity tree" card for one turn.
 *
 * Port of Foundry's MessageForgeActivity, adapted to Wayland's ActivityNode
 * model and orange/dark tokens. One self-contained Virtuoso row (the list is
 * virtualized): the card auto-expands while the turn is running, auto-collapses
 * when every node is terminal (Foundry's prevHadWorking ref pattern), and each
 * node can be clicked to drill into its accumulated detail (streamed tool
 * stdout, thinking text, op-trail summary).
 */

const nodeStatusBadge: Record<ActivityNode['status'], 'processing' | 'success' | 'error'> = {
  running: 'processing',
  done: 'success',
  failed: 'error',
};

const statusLabel = (status: ActivityNode['status'] | IMessageActivity['content']['status'], t: TFunction): string => {
  switch (status) {
    case 'running':
      return t('conversation.activity.statusWorking', { defaultValue: 'Working' });
    case 'failed':
      return t('conversation.activity.statusFailed', { defaultValue: 'Failed' });
    default:
      return t('conversation.activity.statusDone', { defaultValue: 'Done' });
  }
};

const kindLabel = (kind: ActivityNode['kind'], t: TFunction): string => {
  switch (kind) {
    case 'thinking':
      return t('conversation.activity.kindThinking', { defaultValue: 'Thinking' });
    case 'sub_agent':
      return t('conversation.activity.kindSubAgent', { defaultValue: 'Sub-agent' });
    case 'circuit':
      return t('conversation.activity.kindCircuit', { defaultValue: 'Provider' });
    case 'browser':
      return t('conversation.activity.kindBrowser', { defaultValue: 'Browser' });
    case 'cua':
      return t('conversation.activity.kindCua', { defaultValue: 'Computer' });
    default:
      return t('conversation.activity.kindTool', { defaultValue: 'Tool' });
  }
};

const formatDuration = (startTime?: number, endTime?: number): string | null => {
  if (startTime == null || endTime == null) return null;
  const secs = (endTime - startTime) / 1000;
  if (secs < 0) return null;
  return secs.toFixed(1) + 's';
};

const handleKeyToggle = (e: React.KeyboardEvent, fn: () => void): void => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    fn();
  }
};

const computeTotalDuration = (nodes: ActivityNode[]): string | null => {
  let earliest = Infinity;
  let latest = -Infinity;
  for (const n of nodes) {
    if (n.startTime != null && n.startTime < earliest) earliest = n.startTime;
    if (n.endTime != null && n.endTime > latest) latest = n.endTime;
  }
  if (!isFinite(earliest) || !isFinite(latest) || latest < earliest) return null;
  return ((latest - earliest) / 1000).toFixed(1) + 's';
};

const MessageActivity: React.FC<{ message: IMessageActivity }> = ({ message }) => {
  const { t } = useTranslation();
  const { nodes, perTurnCost, status } = message.content;

  const [expanded, setExpanded] = useState(status === 'running');
  const [expandedNodeId, setExpandedNodeId] = useState<string | null>(null);

  // Auto-collapse when all nodes finish (Foundry prevHadWorking ref pattern).
  const prevHadRunning = useRef(false);
  useEffect(() => {
    const hasRunning = status === 'running';
    const allDone = nodes.length > 0 && nodes.every((n) => n.status !== 'running');
    if (prevHadRunning.current && allDone) {
      setExpanded(false);
      setExpandedNodeId(null);
    }
    prevHadRunning.current = hasRunning;
  }, [nodes, status]);

  // Nothing to render until at least one node or cost row exists.
  if (nodes.length === 0 && (!perTurnCost || perTurnCost.length === 0)) {
    return null;
  }

  const runningCount = nodes.filter((n) => n.status === 'running').length;
  const allDone = nodes.every((n) => n.status !== 'running');
  const totalDuration = computeTotalDuration(nodes);

  const headerStatus = status === 'running' ? 'processing' : status === 'failed' ? 'error' : 'success';

  return (
    <div className={styles.container} data-testid='activity-card' data-activity-status={status}>
      <div
        className={styles.header}
        onClick={() => setExpanded((v) => !v)}
        onKeyDown={(e) => handleKeyToggle(e, () => setExpanded((v) => !v))}
        role='button'
        tabIndex={0}
        aria-expanded={expanded}
      >
        {runningCount > 0 && <span className={styles.heartbeat} aria-hidden='true' />}
        <Badge
          status={headerStatus}
          text={t('conversation.activity.activeHeader', { defaultValue: 'Activity', count: nodes.length })}
        />
        <span className={styles.count}>
          {t('conversation.activity.stepCount', { defaultValue: '{{count}} steps', count: nodes.length })}
        </span>
        <span className={styles.spacer} />
        {expanded ? <Down size='14' /> : <Right size='14' />}
      </div>

      {!expanded && allDone && (
        <div className={styles.summary}>
          <Badge status={headerStatus} />
          <span>
            {t('conversation.activity.completedSummary', {
              defaultValue: 'Completed {{count}} steps in {{duration}}',
              count: nodes.length,
              duration: totalDuration || '?',
            })}
          </span>
        </div>
      )}

      {expanded && (
        <div className={styles.list}>
          {nodes.map((node) => {
            const duration = formatDuration(node.startTime, node.endTime);
            const isOpen = expandedNodeId === node.id;
            const hasDetail = Boolean(node.detail && node.detail.length);
            return (
              <div key={node.id}>
                <div
                  className={styles.item}
                  onClick={() => hasDetail && setExpandedNodeId(isOpen ? null : node.id)}
                  onKeyDown={(e) => hasDetail && handleKeyToggle(e, () => setExpandedNodeId(isOpen ? null : node.id))}
                  role={hasDetail ? 'button' : undefined}
                  tabIndex={hasDetail ? 0 : undefined}
                  style={hasDetail ? { cursor: 'pointer' } : undefined}
                >
                  {node.status === 'running' && <span className={styles.heartbeat} aria-hidden='true' />}
                  <Badge status={nodeStatusBadge[node.status]} />
                  <Tag size='small' className={styles.statusText}>
                    {statusLabel(node.status, t)}
                  </Tag>
                  <Tag size='small' className={styles.kindTag}>
                    {kindLabel(node.kind, t)}
                  </Tag>
                  <span className={styles.nodeName}>{node.name || kindLabel(node.kind, t)}</span>
                  {duration && <span className={styles.duration}>{duration}</span>}
                </div>
                {isOpen && hasDetail && (
                  <div className={styles.detail}>
                    <pre className={styles.detailText}>{node.detail}</pre>
                  </div>
                )}
              </div>
            );
          })}

          {perTurnCost && perTurnCost.length > 0 && (
            <div className={styles.cost}>
              {perTurnCost.map((c) => (
                <div key={c.turn} className={styles.costRow}>
                  <span className={styles.costModel}>{c.model}</span>
                  <span className={styles.costProvider}>{c.provider}</span>
                  <span className={styles.costValue}>
                    {t('conversation.activity.costPerTurn', {
                      defaultValue: '${{cost}}',
                      cost: c.costUsd.toFixed(4),
                    })}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default React.memo(MessageActivity, (prev, next) => prev.message.content === next.message.content);
