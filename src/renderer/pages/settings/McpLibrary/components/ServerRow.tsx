import React from 'react';
import { useTranslation } from 'react-i18next';
import { Switch } from '@arco-design/web-react';
import { Settings, Trash2, FileText, LogIn, Server, RefreshCw, AlertTriangle } from 'lucide-react';
import type { McpOAuthStatus } from '@renderer/hooks/mcp/useMcpOAuth';
import type { UIStatus } from '../status';

export type { UIStatus };

type ServerRowServer = {
  id: string;
  name?: string;
  source?: 'library' | 'custom';
  libraryEntryId?: string;
  status: UIStatus;
  toolCount?: number;
  publisher?: string;
  enabled?: boolean;
  lastError?: string;
};

type Props = {
  server: ServerRowServer;
  iconUrl?: string;
  oauthStatus?: McpOAuthStatus;
  checking?: boolean;
  onReauth: () => void;
  onSettings: () => void;
  onRemove: () => void;
  onToggle: () => void;
  onLogs: () => void;
  onReconnect: () => void;
};

export function ServerRow({
  server,
  iconUrl,
  oauthStatus,
  checking = false,
  onReauth,
  onSettings,
  onRemove,
  onToggle,
  onLogs,
  onReconnect,
}: Props) {
  const { t } = useTranslation();
  const needsReauth = oauthStatus?.needsLogin === true;
  // `stopped` is a catch-all in deriveStatus: it covers BOTH user-disabled
  // (toggle off) and enabled-but-not-yet-connected. Split the label so the
  // pill doesn't say "Disabled" while the user is staring at the toggle they
  // just flipped on.
  const stoppedLabel = server.enabled
    ? t('mcpLibrary.installed.statusIdle', 'Idle')
    : t('mcpLibrary.installed.statusStopped', 'Disabled');
  const statusLabel = {
    running: t('mcpLibrary.installed.statusRunning', 'Running'),
    warn: t('mcpLibrary.installed.statusWarn', 'Sign-in needed'),
    error: t('mcpLibrary.installed.statusError', 'Error'),
    stopped: stoppedLabel,
  }[server.status];
  const toggleLabel = t('mcpLibrary.installed.actionToggle', 'Enable / disable');
  const pillStatus = checking ? 'checking' : server.status;
  const pillLabel = checking ? t('mcpLibrary.installed.statusChecking', 'Checking...') : statusLabel;

  // The row never crams a variable-width "fix" button into the action cluster
  // (that is what made the toggles ragged). Instead, when a server needs the
  // user's attention we show an actionable strip BELOW the row: what went
  // wrong + how to fix it + one primary action. Errors always say why - and the
  // strip shows whenever the server is in error, even if a failed test left it
  // disabled (Retry re-enables + re-syncs), so an error is never a dead end.
  const showIssue = !checking && (needsReauth || server.status === 'error');
  const issueIsAuth = needsReauth;
  // A non-auth-shaped lastError is the real reason; prefer it over canned copy,
  // even in the auth branch, so the captured error is never hidden.
  const realError = server.lastError?.trim() ? server.lastError.trim() : undefined;

  return (
    <div className={`mcp-server-card mcp-server-${server.status}`}>
      <div className='mcp-server-row'>
        {iconUrl ? (
          <img className='mcp-server-logo' src={iconUrl} alt='' />
        ) : (
          <span className='mcp-server-logo mcp-server-logo-fallback' aria-hidden='true'>
            <Server size={18} />
          </span>
        )}
        <div className='mcp-server-main'>
          <div className='mcp-server-name'>{server.name ?? server.id}</div>
          <div className='mcp-server-pub'>{server.publisher ?? ''}</div>
        </div>
        <div className='mcp-server-stats'>
          {t('mcpLibrary.installed.toolCount', '{{count}} tools', { count: server.toolCount ?? 0 })}
        </div>
        <div className='mcp-server-status'>
          <span className={`mcp-status-pill mcp-status-${pillStatus}`}>
            {checking ? <RefreshCw size={11} className='mcp-spin' /> : <span className='mcp-dot' />} {pillLabel}
          </span>
        </div>
        <div className='mcp-server-actions'>
          <Switch size='small' checked={server.enabled ?? false} onChange={onToggle} aria-label={toggleLabel} />
          <button
            onClick={onSettings}
            title={t('mcpLibrary.installed.actionSettings', 'Settings')}
            aria-label={t('mcpLibrary.installed.actionSettings', 'Settings')}
          >
            <Settings size={15} />
          </button>
          <button
            onClick={onLogs}
            title={t('mcpLibrary.installed.actionLogs', 'View logs')}
            aria-label={t('mcpLibrary.installed.actionLogs', 'View logs')}
          >
            <FileText size={15} />
          </button>
          <button
            onClick={onRemove}
            title={t('mcpLibrary.installed.actionRemove', 'Remove')}
            className='mcp-danger'
            aria-label={t('mcpLibrary.installed.actionRemove', 'Remove')}
          >
            <Trash2 size={15} />
          </button>
        </div>
      </div>

      {showIssue && (
        <div className={`mcp-server-issue mcp-server-issue-${issueIsAuth ? 'warn' : 'error'}`} role='alert'>
          <span className='mcp-issue-icon' aria-hidden='true'>
            {issueIsAuth ? <LogIn size={15} /> : <AlertTriangle size={15} />}
          </span>
          <div className='mcp-issue-body'>
            <div className='mcp-issue-title'>
              {issueIsAuth
                ? t('mcpLibrary.installed.issueAuthTitle', 'This connection needs you to sign in again')
                : t('mcpLibrary.installed.issueErrorTitle', "This server isn't responding")}
            </div>
            <div className='mcp-issue-detail'>
              {realError ??
                (issueIsAuth
                  ? t(
                      'mcpLibrary.installed.issueAuthFix',
                      'Sign in to reconnect. Your tools come back as soon as it authorizes.'
                    )
                  : t(
                      'mcpLibrary.installed.issueErrorFix',
                      'Check the server is running and reachable, then retry.'
                    ))}
            </div>
          </div>
          {issueIsAuth ? (
            <button className='mcp-issue-action mcp-issue-action-primary' onClick={onReauth}>
              <LogIn size={14} /> {t('mcpLibrary.installed.actionSignIn', 'Sign in')}
            </button>
          ) : (
            <button className='mcp-issue-action mcp-issue-action-primary' onClick={onReconnect}>
              <RefreshCw size={14} /> {t('mcpLibrary.installed.actionRetry', 'Retry')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
