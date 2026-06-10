/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from 'vitest';
import { isAllowedForRemote } from '@/common/adapter/bridgeAllowlist';

/**
 * Audit C4: the model-registry secret/write IPC must NEVER be reachable from a
 * remote/WebUI caller. `resolveForChatStart` returns a decrypted plaintext key;
 * `connect`/`rekey`/`detectKeys` mutate or disclose stored credentials. A paired
 * but untrusted browser session must be rejected at the wire boundary. This
 * regression test guards that denial (the keys live in REMOTE_DENIED_KEYS).
 */
describe('model-registry IPC is remote-denied (audit C4)', () => {
  const denied = [
    'modelRegistry.connect',
    'modelRegistry.rekey',
    'modelRegistry.detectKeys',
    'modelRegistry.resolveForChatStart',
  ];

  for (const key of denied) {
    it(`rejects a remote caller for ${key}`, () => {
      expect(isAllowedForRemote(`subscribe-${key}`)).toBe(false);
    });
  }

  it('still allows a read-only/safe provider invocation for contrast', () => {
    // A non-secret provider invocation must remain reachable so the WebUI is not
    // broken wholesale - the denial is targeted at secret/write keys only.
    expect(isAllowedForRemote('subscribe-conversation.get-list')).toBe(true);
  });

  it('non-subscribe traffic is unaffected by the provider denylist', () => {
    expect(isAllowedForRemote('some-callback-event')).toBe(true);
  });
});
