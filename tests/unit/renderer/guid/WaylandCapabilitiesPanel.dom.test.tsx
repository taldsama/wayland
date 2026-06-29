/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

// @vitest-environment jsdom

import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable live-state fixtures the mocks read - reset per test.
const state = vi.hoisted(() => ({
  providers: [] as unknown[],
  cronJobs: [] as unknown[],
  skills: [] as unknown[],
  dismissed: undefined as boolean | undefined,
  reload: vi.fn(() => Promise.resolve()),
  configSet: vi.fn((_key: string, _value: unknown) => Promise.resolve()),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options && typeof options.count === 'number' ? `${key}:${options.count}` : key,
  }),
}));

// Arco Button → plain button forwarding onClick/children/aria-label/icon/testid.
vi.mock('@arco-design/web-react', () => ({
  Button: ({
    children,
    onClick,
    icon,
    className,
    ['aria-label']: ariaLabel,
    ['data-testid']: dataTestid,
  }: {
    children?: React.ReactNode;
    onClick?: () => void;
    icon?: React.ReactNode;
    className?: string;
    ['aria-label']?: string;
    ['data-testid']?: string;
  }) => (
    <button type='button' onClick={onClick} className={className} aria-label={ariaLabel} data-testid={dataTestid}>
      {icon}
      {children}
    </button>
  ),
}));

vi.mock('@arco-design/web-react/icon', () => ({
  IconClose: () => <span data-testid='icon-close' />,
}));

vi.mock('@/renderer/hooks/useModelRegistry', () => ({
  useModelRegistry: () => ({ providers: state.providers, reload: state.reload }),
}));

vi.mock('@/common', () => ({
  ipcBridge: {
    cron: { listJobs: { invoke: () => Promise.resolve(state.cronJobs) } },
    fs: { listAvailableSkills: { invoke: () => Promise.resolve(state.skills) } },
  },
}));

vi.mock('@/common/config/storage', () => ({
  ConfigStorage: {
    get: (key: string) =>
      key === 'concierge.panelDismissed' ? Promise.resolve(state.dismissed) : Promise.resolve(undefined),
    set: (key: string, value: unknown) => state.configSet(key, value),
  },
}));

import WaylandCapabilitiesPanel from '@/renderer/pages/guid/components/newChatStarter/WaylandCapabilitiesPanel';

const provider = () => ({ id: 'openai' });
const cronJob = () => ({ id: 'job-1' });
const skill = (n: number) => ({ name: `skill-${n}` });

const keysOf = () =>
  screen.getAllByTestId('capability-row').map((row) => row.getAttribute('data-suggest-key'));

describe('<WaylandCapabilitiesPanel>', () => {
  beforeEach(() => {
    state.providers = [];
    state.cronJobs = [];
    state.skills = [];
    state.dismissed = undefined;
    state.reload = vi.fn(() => Promise.resolve());
    state.configSet = vi.fn((_key: string, _value: unknown) => Promise.resolve());
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders the panel title + subtitle and pulls a fresh providers snapshot on mount', async () => {
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);
    expect(await screen.findByText('concierge.panel.title')).toBeTruthy();
    expect(screen.getByText('concierge.panel.subtitle')).toBeTruthy();
    expect(state.reload).toHaveBeenCalled();
  });

  it('0 providers, no scheduled tasks → connect-model + find-skill + explore (no why-didnt-run)', async () => {
    state.providers = [];
    state.skills = [skill(1), skill(2)];
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);

    await waitFor(() => expect(keysOf()).toEqual(['connectModel', 'findSkill', 'exploreFeatures']));
  });

  it('has providers but no scheduled tasks → schedule-digest row (no why-didnt-run)', async () => {
    state.providers = [provider()];
    state.cronJobs = [];
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);

    await waitFor(() => expect(keysOf()).toEqual(['scheduleDigest', 'findSkill', 'exploreFeatures']));
  });

  it('has providers AND scheduled tasks → why-didnt-run row appears (state-gated)', async () => {
    state.providers = [provider()];
    state.cronJobs = [cronJob()];
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);

    await waitFor(() => expect(keysOf()).toEqual(['findSkill', 'exploreFeatures', 'whyDidntRun']));
    expect(keysOf()).not.toContain('connectModel');
    expect(keysOf()).not.toContain('scheduleDigest');
  });

  it('never renders "out of 0": uses the no-count label until the skill count resolves positive', async () => {
    state.providers = [provider()];
    state.cronJobs = [cronJob()];
    state.skills = []; // 0 skills
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);

    // The no-count title renders; the count-interpolated title (":0") never does.
    expect(await screen.findByText('concierge.suggest.findSkill.titleNoCount')).toBeTruthy();
    expect(screen.queryByText('concierge.suggest.findSkill.title:0')).toBeNull();
  });

  it('interpolates the live skill count once it resolves positive', async () => {
    state.providers = [provider()];
    state.cronJobs = [cronJob()];
    state.skills = [skill(1), skill(2), skill(3)];
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);

    await waitFor(() => expect(screen.getByText('concierge.suggest.findSkill.title:3')).toBeTruthy());
  });

  it('fires onSelect with a Concierge-targeted IntentPrompt when a row is clicked', async () => {
    const onSelect = vi.fn();
    state.providers = [];
    render(<WaylandCapabilitiesPanel onSelect={onSelect} />);

    const rows = await screen.findAllByTestId('capability-row');
    fireEvent.click(within(rows[0]).getByRole('button'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'concierge.suggest.connectModel.title',
        promptText: 'concierge.suggest.connectModel.prompt',
        targetAssistantId: 'builtin-concierge',
      })
    );
  });

  it('dismiss control hides the panel and persists concierge.panelDismissed', async () => {
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);
    const dismiss = await screen.findByTestId('capabilities-panel-dismiss');
    fireEvent.click(dismiss);

    expect(state.configSet).toHaveBeenCalledWith('concierge.panelDismissed', true);
    await waitFor(() => expect(screen.queryByTestId('capabilities-panel')).toBeNull());
  });

  it('does not render at all when previously dismissed', async () => {
    state.dismissed = true;
    render(<WaylandCapabilitiesPanel onSelect={() => {}} />);
    // Give the async dismissed read a chance to resolve, then assert nothing shows.
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    expect(screen.queryByTestId('capabilities-panel')).toBeNull();
  });
});
