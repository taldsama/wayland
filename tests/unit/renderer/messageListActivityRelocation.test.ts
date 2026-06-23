/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * #252 reframe guard: the big activity card must NOT render inline in the chat
 * message list anymore - it lives in the ObservabilityPanel. Mounting the full
 * Virtuoso-backed MessageList in jsdom is heavy and brittle, so this guards the
 * two source invariants that enforce the relocation:
 *   1. the `activity` switch case renders nothing (returns null);
 *   2. MessageActivity is no longer imported by MessageList (it moved to the panel).
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const messageListPath = path.resolve(here, '../../../src/renderer/pages/conversation/Messages/MessageList.tsx');
const source = readFileSync(messageListPath, 'utf8');

describe('MessageList #252 activity relocation', () => {
  it('does not render the inline activity card (activity case returns null)', () => {
    expect(source).not.toContain('<MessageActivity');
    const activityCase = source.slice(source.indexOf("case 'activity':"));
    // The case body up to the next case must be a bare `return null`.
    expect(activityCase.slice(0, activityCase.indexOf("case '", 5))).toContain('return null');
  });

  it('no longer imports MessageActivity into the message list', () => {
    expect(source).not.toMatch(/import\s+MessageActivity\s+from/);
  });
});
