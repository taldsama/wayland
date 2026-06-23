/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { fireEvent, render, screen } from '@testing-library/react';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) => options?.defaultValue ?? key,
  }),
}));

import MessageActivity from '@/renderer/pages/conversation/Messages/components/MessageActivity';
import type { IMessageActivity } from '@/common/chat/chatLib';

const make = (content: Partial<IMessageActivity['content']>): IMessageActivity => ({
  id: 'm1',
  msg_id: 'turn-1',
  conversation_id: 'c1',
  type: 'activity',
  position: 'left',
  content: {
    turnId: 'turn-1',
    nodes: [],
    status: 'running',
    ...content,
  },
});

describe('MessageActivity', () => {
  it('renders nothing when there are no nodes and no cost', () => {
    const { container } = render(<MessageActivity message={make({ nodes: [] })} />);
    expect(container.querySelector('[data-testid="activity-card"]')).toBeNull();
  });

  it('renders a node row and auto-expands while running', () => {
    render(
      <MessageActivity
        message={make({
          status: 'running',
          nodes: [{ id: 'c1', kind: 'tool', callId: 'c1', name: 'ReadFile', status: 'running', startTime: 1 }],
        })}
      />
    );
    const card = screen.getByTestId('activity-card');
    expect(card.getAttribute('data-activity-status')).toBe('running');
    expect(screen.getByText('ReadFile')).toBeTruthy();
  });

  it('drills into a node detail on click (streamed tool stdout)', () => {
    render(
      <MessageActivity
        message={make({
          status: 'running',
          nodes: [
            {
              id: 'c1',
              kind: 'tool',
              callId: 'c1',
              name: 'Bash',
              status: 'running',
              startTime: 1,
              detail: 'hello stdout',
            },
          ],
        })}
      />
    );
    // Detail hidden until the node row is clicked.
    expect(screen.queryByText('hello stdout')).toBeNull();
    fireEvent.click(screen.getByText('Bash'));
    expect(screen.getByText('hello stdout')).toBeTruthy();
  });

  it('shows a duration badge for a completed node', () => {
    render(
      <MessageActivity
        message={make({
          status: 'running',
          nodes: [
            { id: 'c1', kind: 'tool', callId: 'c1', name: 'Bash', status: 'done', startTime: 1000, endTime: 2500 },
          ],
        })}
      />
    );
    expect(screen.getByText('1.5s')).toBeTruthy();
  });

  it('renders per-turn cost rows when expanded', () => {
    render(
      <MessageActivity
        message={make({
          status: 'running',
          nodes: [{ id: 'c1', kind: 'tool', callId: 'c1', name: 'Bash', status: 'running', startTime: 1 }],
          perTurnCost: [{ turn: 1, model: 'gpt-x', provider: 'openai', costUsd: 0.0123 }],
        })}
      />
    );
    // Card auto-expands while running, so cost rows are visible.
    expect(screen.getByText('gpt-x')).toBeTruthy();
    expect(screen.getByText('openai')).toBeTruthy();
  });

  it('reflects failed status on the card', () => {
    render(
      <MessageActivity
        message={make({
          status: 'failed',
          nodes: [{ id: 'c1', kind: 'tool', callId: 'c1', name: 'Bash', status: 'failed', startTime: 1, endTime: 2 }],
        })}
      />
    );
    expect(screen.getByTestId('activity-card').getAttribute('data-activity-status')).toBe('failed');
  });
});
