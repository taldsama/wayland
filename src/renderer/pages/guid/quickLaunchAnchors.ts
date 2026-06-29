/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * The 6 quick-launch anchors surfaced on the launchpad cold-start page.
 * Clicking a card: (1) sets the assistant as active preset via
 * useGuidAgentSelection.handleSelect - appears as PresetAgentTag in
 * the action row; (2) prefills the input with `prefill`; (3) fires
 * 'launchpad.card_clicked' telemetry for Phase 2 PredictiveEngine.
 *
 * Concierge is anchor #1 - the universal "ask anything" entry point that
 * answers what Wayland can do and helps set things up. Cowork follows as the
 * autonomous-execution button; the other 5 are recurring entrepreneur jobs.
 */

export type QuickLaunchAnchorId =
  | 'concierge'
  | 'cowork'
  | 'write-copy'
  | 'close-deal'
  | 'launch-it'
  | 'numbers'
  | 'quiet-money';

export type QuickLaunchAnchor = {
  id: QuickLaunchAnchorId;
  label: string;
  sub: string;
  prefill: string;
  assistantId: string;
  lucideIcon: string;
};

export const QUICK_LAUNCH_ANCHORS: readonly QuickLaunchAnchor[] = [
  { id: 'concierge',   label: 'Concierge',    sub: 'Ask anything',       prefill: '',                          assistantId: 'builtin-concierge',      lucideIcon: 'sparkles' },
  { id: 'cowork',      label: 'Cowork',       sub: 'Autonomous',         prefill: 'Cowork: ',                  assistantId: 'builtin-cowork',         lucideIcon: 'zap' },
  { id: 'write-copy',  label: 'Write copy',   sub: 'Email, ad, page',    prefill: 'Draft me ',                 assistantId: 'builtin-copy',           lucideIcon: 'pen-line' },
  { id: 'close-deal',  label: 'Close a deal', sub: 'Outreach · follow',  prefill: 'Help me close ',            assistantId: 'builtin-sales',          lucideIcon: 'handshake' },
  { id: 'launch-it',   label: 'Launch it',    sub: 'Product · promo',    prefill: 'Plan the launch for ',      assistantId: 'builtin-product-launch', lucideIcon: 'rocket' },
  { id: 'numbers',     label: 'Numbers',      sub: 'Runway · ROI',       prefill: 'Run the numbers on ',       assistantId: 'builtin-coin',           lucideIcon: 'bar-chart-3' },
  { id: 'quiet-money', label: 'Quiet Money',  sub: 'Wealth coach',       prefill: 'Quiet Money - ',            assistantId: 'builtin-quiet-money',    lucideIcon: 'landmark' },
] as const;
