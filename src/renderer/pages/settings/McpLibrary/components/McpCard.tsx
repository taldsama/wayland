import React from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, AlertTriangle, LogIn } from 'lucide-react';
import type { CatalogIndexEntry } from '../types';
import type { UIStatus } from '../status';
import { needsAttention } from '../status';
import { TierBadge } from './TierBadge';
import { MaintainerBadge } from './MaintainerBadge';

interface Props {
  entry: CatalogIndexEntry;
  installed: boolean;
  /** Health of the installed server for this entry, when one exists. */
  status?: UIStatus;
  onClick: () => void;
}

export function McpCard({ entry, installed, status, onClick }: Props) {
  const { t } = useTranslation();
  const isWaylandBuilt = entry.maintainerType === 'wayland';
  // An installed connector that is broken or wants a sign-in is surfaced right
  // on the card so the user can spot it at a glance instead of hunting Installed.
  const attention = installed && status !== undefined && needsAttention(status);
  return (
    <div
      className={`mcp-card ${installed ? 'is-installed' : ''} ${attention ? `is-attention status-${status}` : ''} ${isWaylandBuilt ? 'is-wayland-built' : ''}`}
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="mcp-card-top">
        <img className="mcp-card-logo" src={entry.iconUrl} alt="" />
        <div className="mcp-card-meta">
          <div className="mcp-card-name">
            {entry.name}
            {entry.verifiedByWayland && (
              <Check className="mcp-card-verified-tick" size={13} />
            )}
          </div>
          <div className="mcp-card-publisher">{entry.id}</div>
        </div>
      </div>
      <div className="mcp-card-desc">{entry.shortDescription}</div>
      <div className="mcp-card-tags">
        <TierBadge tier={entry.tier} />
        <MaintainerBadge type={entry.maintainerType} />
      </div>
      <div className="mcp-card-footer">
        <button
          className={`mcp-install-btn ${installed ? 'is-installed' : ''} ${attention ? `is-attention status-${status}` : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onClick();
          }}
        >
          {attention ? (
            status === 'warn' ? (
              <>
                <LogIn size={12} /> {t('mcpLibrary.browse.cardSignIn', 'Sign in')}
              </>
            ) : (
              <>
                <AlertTriangle size={12} /> {t('mcpLibrary.browse.cardFix', 'Needs attention')}
              </>
            )
          ) : installed ? (
            <>
              <Check size={12} /> {t('mcpLibrary.browse.cardInstalled', 'Installed')}
            </>
          ) : (
            <>
              <Plus size={12} /> {t('mcpLibrary.browse.cardInstall', 'Install')}
            </>
          )}
        </button>
      </div>
    </div>
  );
}
