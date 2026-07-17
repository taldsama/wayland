/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { Users, Trash2, Crown, Activity, CheckCircle } from 'lucide-react';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { Tag, Tooltip, Popconfirm, Button } from '@arco-design/web-react';
import classNames from 'classnames';
import type { TTeam, TeamTask } from '@/common/types/teamTypes';
import styles from './ConfiguredTeamCard.module.css';

export type ConfiguredTeamCardProps = {
  team: TTeam;
  tasks: TeamTask[];
  onLaunch: (team: TTeam) => void;
  onDelete: (teamId: string) => void;
  presetDescription?: string;
};

const ConfiguredTeamCard: React.FC<ConfiguredTeamCardProps> = ({
  team,
  tasks,
  onLaunch,
  onDelete,
  presetDescription,
}) => {
  const { t } = useTranslation();

  const isCompleted =
    tasks.length > 0 &&
    tasks.every(
      (t) => t.status === 'completed' || t.status === 'failed' || t.status === 'deleted'
    );

  const activeTasksCount = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'deleted'
  ).length;

  const handleClick = () => {
    onLaunch(team);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onLaunch(team);
    }
  };

  // Resolve description
  const description = useMemo(() => {
    if (tasks.length > 0) {
      const active = tasks.find(
        (t) => t.status !== 'completed' && t.status !== 'failed' && t.status !== 'deleted'
      );
      const displayTask = active || tasks[tasks.length - 1];
      return `${t('teams.card.latestTask', { defaultValue: 'Task' })}: ${displayTask.subject}${displayTask.description ? ` - ${displayTask.description}` : ''}`;
    }
    if (presetDescription) return presetDescription;
    return `${t('teams.card.workspace', { defaultValue: 'Workspace' })}: ${team.workspace}`;
  }, [tasks, presetDescription, team.workspace, t]);

  function useMemo<T>(fn: () => T, deps: React.DependencyList): T {
    return React.useMemo(fn, deps);
  }

  return (
    <div
      role='button'
      tabIndex={0}
      className={classNames(
        styles.card,
        isCompleted ? styles.cardCompleted : styles.cardActive
      )}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      data-testid={`configured-team-card-${team.id}`}
      aria-label={team.name}
    >
      {/* Badges / Header Indicators */}
      <div className={styles.badgeContainer}>
        {isCompleted ? (
          <span className={styles.completedBadge}>
            <CheckCircle size={10} />
            {t('teams.status.completed', { defaultValue: 'Finished' })}
          </span>
        ) : (
          <span className={styles.activeBadge}>
            <Activity size={10} className='animate-pulse' />
            {t('teams.status.active', { defaultValue: 'Active' })}
            {activeTasksCount > 0 && ` (${activeTasksCount} tasks)`}
          </span>
        )}

        <div onClick={(e) => e.stopPropagation()}>
          <Popconfirm
            focusLock
            title={t('team.sider.deleteConfirm', { defaultValue: 'Are you sure you want to delete this team?' })}
            onOk={() => onDelete(team.id)}
            okText={t('team.sider.deleteOk', { defaultValue: 'Delete' })}
            cancelText={t('team.sider.deleteCancel', { defaultValue: 'Cancel' })}
            okButtonProps={{ status: 'danger' }}
          >
            <Button
              type='text'
              size='mini'
              className={styles.deleteButton}
              icon={<Trash2 size={13} />}
            />
          </Popconfirm>
        </div>
      </div>

      <div className={styles.cardHeader}>
        <div className={styles.avatar}>
          <Users size={16} />
        </div>
        <div className={styles.nameRow}>
          <span className={styles.name} title={team.name}>
            {team.name}
          </span>
        </div>
      </div>

      {/* Description / Task text */}
      {description && <div className={styles.description}>{description}</div>}

      {/* Participant Agents tags */}
      <div className={styles.agentsList}>
        {team.agents.map((agent) => {
          const isLeader = agent.role === 'leader';
          return (
            <Tooltip
              key={agent.slotId}
              content={`${agent.agentName} (${agent.agentType}${isLeader ? ', Leader' : ''})`}
            >
              <Tag
                size='small'
                color={isLeader ? 'gold' : 'blue'}
                className={classNames(styles.agentTag, isLeader && styles.leaderTag)}
              >
                {isLeader && <Crown size={10} className='mr-2px' />}
                {agent.agentName}
              </Tag>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
};

export default ConfiguredTeamCard;
