/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Input, Button, Link, Spin } from '@arco-design/web-react';
import { Check, CloseOne, Key, Components } from '@icon-park/react';
import { mcpService } from '@/common/adapter/ipcBridge';
import type { IMcpServer } from '@/common/config/storage';

type ServerData = Omit<IMcpServer, 'id' | 'createdAt' | 'updatedAt'>;

type Phase = 'input' | 'probing' | 'needsAuth' | 'connected' | 'error';

/**
 * Renderer-side SSRF guard mirroring validateMcpServer's intent so the PROBE
 * (which runs before persist, where the authoritative main-process check lives)
 * cannot be pointed at loopback / private / cloud-metadata hosts. http(s) only.
 */
function isSafeRemoteUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  const h = u.hostname.toLowerCase();
  if (h === 'localhost' || h.endsWith('.localhost') || h === '0.0.0.0' || h === '::1') return false;
  if (
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h)
  ) {
    return false;
  }
  return true;
}

/** Friendly server name from the URL host, e.g. https://mcp.readwise.io/mcp -> "Readwise". */
function deriveName(raw: string): string {
  try {
    const host = new URL(raw.trim()).hostname.replace(/^(mcp|api|www)\./, '');
    const base = host.split('.')[0] || host;
    return base.charAt(0).toUpperCase() + base.slice(1);
  } catch {
    return 'MCP server';
  }
}

const DEFAULT_HEADER = 'Authorization';

/**
 * streamable_http connections surface a 401/403 as an error STRING (the SDK
 * throws on connect) rather than the structured `needsAuth` flag the http/sse
 * pre-flight sets. Detect the auth-shaped error so the token field still appears.
 */
function looksLikeAuthError(msg: string | undefined): boolean {
  if (!msg) return false;
  return /unauthorized|forbidden|\b401\b|\b403\b|authenticat|invalid.*(key|token)|x-api-key|missing.*(key|token)/i.test(
    msg
  );
}

/**
 * The primary "Add an MCP server" surface: paste a remote URL and Wayland probes
 * it (detect transport + auth) and connects. No JSON in the happy path. A token
 * field appears only if the server needs one; the header name is overridable for
 * vendors like Readwise that use X-Access-Token instead of Authorization: Bearer.
 */
const UrlAddModal: React.FC<{
  visible: boolean;
  onCancel: () => void;
  onSubmit: (server: ServerData) => void;
  onUseJson: () => void;
}> = ({ visible, onCancel, onSubmit, onUseJson }) => {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [token, setToken] = useState('');
  const [headerName, setHeaderName] = useState(DEFAULT_HEADER);
  const [showHeaderField, setShowHeaderField] = useState(false);
  const [phase, setPhase] = useState<Phase>('input');
  const [tools, setTools] = useState<number>(0);
  const [error, setError] = useState('');

  const reset = useCallback(() => {
    setUrl('');
    setToken('');
    setHeaderName(DEFAULT_HEADER);
    setShowHeaderField(false);
    setPhase('input');
    setTools(0);
    setError('');
  }, []);

  useEffect(() => {
    if (!visible) reset();
  }, [visible, reset]);

  const headers = useMemo(() => {
    const tok = token.trim();
    if (!tok) return undefined;
    const name = headerName.trim() || DEFAULT_HEADER;
    return { [name]: name === DEFAULT_HEADER ? `Bearer ${tok}` : tok };
  }, [token, headerName]);

  const buildServer = useCallback(
    (enabled: boolean): ServerData =>
      ({
        name: deriveName(url),
        description: t('mcpLibrary.urlAdd.addedDescription', 'Added by URL'),
        enabled,
        source: 'custom',
        status: enabled ? 'connected' : 'disconnected',
        transport: { type: 'streamable_http', url: url.trim(), ...(headers ? { headers } : {}) },
        ...(tools > 0 ? {} : {}),
      }) as ServerData,
    [url, headers, tools, t]
  );

  const probe = useCallback(async () => {
    if (!isSafeRemoteUrl(url)) {
      setError(t('mcpLibrary.urlAdd.invalidUrl', 'Enter a valid https:// server URL.'));
      setPhase('error');
      return;
    }
    setError('');
    setPhase('probing');
    try {
      const res = await mcpService.testMcpConnection.invoke(buildServer(false) as IMcpServer);
      const data = res?.success ? res.data : undefined;
      if (!data) {
        setError(t('mcpLibrary.urlAdd.unreachable', 'Could not reach that server. Check the URL and try again.'));
        setPhase('error');
        return;
      }
      // streamable_http reports auth failures as an error string, not the
      // needsAuth flag - treat an auth-shaped error as "needs a token" so the
      // api-key path works for hosted remotes that 401 on an unauthenticated probe.
      if (data.needsAuth || (!data.success && looksLikeAuthError(data.error))) {
        if (token.trim()) {
          // A token was supplied but still rejected.
          setError(t('mcpLibrary.urlAdd.tokenRejected', 'The server rejected that token. Double-check it and retry.'));
        }
        setPhase('needsAuth');
        return;
      }
      if (data.success) {
        setTools(data.tools?.length ?? 0);
        setPhase('connected');
        return;
      }
      setError(data.error || t('mcpLibrary.urlAdd.failed', 'Connection failed.'));
      setPhase('error');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('error');
    }
  }, [url, token, buildServer, t]);

  const add = useCallback(() => {
    onSubmit(buildServer(true));
    onCancel();
  }, [onSubmit, buildServer, onCancel]);

  // OAuth servers: persist disabled so the row appears in Installed, where the
  // existing re-auth (browser sign-in) action lives.
  const addForSignIn = useCallback(() => {
    onSubmit(buildServer(false));
    onCancel();
  }, [onSubmit, buildServer, onCancel]);

  return (
    <Modal
      visible={visible}
      onCancel={onCancel}
      footer={null}
      title={t('mcpLibrary.urlAdd.title', 'Add an MCP server')}
      style={{ width: 520 }}
      autoFocus={false}
    >
      <div className='flex flex-col gap-12px'>
        <Input
          value={url}
          onChange={setUrl}
          allowClear
          placeholder={t('mcpLibrary.urlAdd.placeholder', 'https://mcp.example.com/mcp')}
          onPressEnter={() => void probe()}
          disabled={phase === 'probing'}
          size='large'
        />
        <div className='text-12px text-t-tertiary'>
          {t('mcpLibrary.urlAdd.hint', 'Paste a server URL from the vendor. Wayland detects the transport and sign-in for you.')}
        </div>

        {phase === 'needsAuth' && (
          <div className='flex flex-col gap-8px rd-8px p-12px' style={{ background: 'var(--color-fill-1)' }}>
            <div className='flex items-center gap-6px text-13px font-500'>
              <Key size={15} /> {t('mcpLibrary.urlAdd.needsAuth', 'This server needs to authenticate')}
            </div>
            <Input.Password
              value={token}
              onChange={setToken}
              placeholder={t('mcpLibrary.urlAdd.tokenPlaceholder', 'Paste an API key / access token')}
              onPressEnter={() => void probe()}
            />
            {showHeaderField ? (
              <Input
                value={headerName}
                onChange={setHeaderName}
                prefix={<Components size={14} />}
                placeholder={t('mcpLibrary.urlAdd.headerPlaceholder', 'Header name (e.g. X-Access-Token)')}
              />
            ) : (
              <Link onClick={() => setShowHeaderField(true)} className='text-12px'>
                {t('mcpLibrary.urlAdd.advancedHeader', 'Uses a custom header? (e.g. Readwise X-Access-Token)')}
              </Link>
            )}
            {error && <div className='text-12px text-danger'>{error}</div>}
            <div className='flex items-center gap-8px mt-4px'>
              <Button type='primary' loading={false} onClick={() => void probe()} disabled={!token.trim()}>
                {t('mcpLibrary.urlAdd.connectWithToken', 'Connect')}
              </Button>
              <Button onClick={addForSignIn}>{t('mcpLibrary.urlAdd.addAndSignIn', 'Add & sign in later')}</Button>
            </div>
          </div>
        )}

        {phase === 'connected' && (
          <div
            className='flex items-center gap-8px rd-8px p-12px text-13px'
            style={{ background: 'rgba(46, 213, 115, 0.10)', color: 'var(--color-text-1)' }}
          >
            <Check size={16} style={{ color: '#2ed573' }} />
            {t('mcpLibrary.urlAdd.connected', 'Connected. {{count}} tools available.', { count: tools })}
          </div>
        )}

        {phase === 'error' && error && (
          <div className='flex items-center gap-8px text-13px text-danger'>
            <CloseOne size={15} /> {error}
          </div>
        )}

        <div className='flex items-center justify-between mt-4px'>
          <Link onClick={onUseJson} className='text-12px'>
            {t('mcpLibrary.urlAdd.useJson', 'Paste JSON instead')}
          </Link>
          {phase === 'connected' ? (
            <Button type='primary' onClick={add}>
              {t('mcpLibrary.urlAdd.addServer', 'Add server')}
            </Button>
          ) : phase === 'probing' ? (
            <Button type='primary' disabled>
              <Spin size={14} /> {t('mcpLibrary.urlAdd.connecting', 'Connecting…')}
            </Button>
          ) : phase === 'input' || phase === 'error' ? (
            <Button type='primary' onClick={() => void probe()} disabled={!url.trim()}>
              {t('mcpLibrary.urlAdd.connect', 'Connect')}
            </Button>
          ) : null}
        </div>
      </div>
    </Modal>
  );
};

export default UrlAddModal;
