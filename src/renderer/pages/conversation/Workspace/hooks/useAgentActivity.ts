/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * useAgentActivity — feed the Workspace "activity" tab.
 *
 * Builds a per-conversation timeline of tool calls grouped by TASK, where each
 * task is started by ONE human prompt (`position === 'right'` text message,
 * excluding hidden / cron-triggered / teammate-forwarded prompts), or by a
 * ritual / autonomous-loop wake. Tool calls observed AFTER that boundary hang
 * off the task until the next boundary.
 *
 * Data sources (no new table, no polling):
 *  - Initial: `database.getConversationMessages` (persisted IMessage rows).
 *  - Live:    `chat.response.stream` (tool_group / tool_call / activity nodes)
 *             + `conversation.turn.completed` (task status + waiting replies).
 *  - Tokens/cost: `cost.byConversation` filtered by conversation_id.
 */

import { ipcBridge } from '@/common';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import type { TMessage } from '@/common/chat/chatLib';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ActivityCounters,
  ActivityTask,
  ActivityToolCall,
} from '../types';

const PAGE_SIZE = 10000;

/** Flexible view over any tool-ish content payload (avoids chatLib union friction). */
type ToolItemView = {
  callId?: string;
  id?: string;
  name?: string;
  description?: string;
  command?: string;
  fileName?: string;
  fileDiff?: string;
  status?: string;
  error?: string;
  kind?: string;
  detail?: string;
  startTime?: number;
  endTime?: number;
  children?: ToolItemView[];
  parentCallId?: string;
  agentName?: string;
  nodes?: ToolItemView[];
};

function toStatus(s?: string, hasError?: string): ActivityToolCall['status'] {
  const v = String(s ?? '').toLowerCase();
  if (hasError || v === 'error' || v === 'failed' || v === 'canceled') return 'failed';
  if (v === 'success' || v === 'done' || v === 'finish') return 'done';
  return 'running';
}

function isHumanPrompt(m: TMessage): boolean {
  if (m.type !== 'text' || m.position !== 'right') return false;
  if (m.hidden) return false;
  const c = m.content as { cronMeta?: unknown; teammateMessage?: boolean };
  if (c.cronMeta) return false;
  if (c.teammateMessage) return false;
  return true;
}

/** Flatten a message into tool-call entries (tool_call / tool_group / activity / sub_agent). */
function extractToolCalls(m: TMessage, baseTs: number): ActivityToolCall[] {
  const ts = m.createdAt ?? baseTs;
  switch (m.type) {
    case 'tool_call': {
      const c = m.content as ToolItemView;
      return [
        {
          id: String(c.callId ?? m.msg_id ?? m.id),
          name: String(c.name ?? 'tool'),
          detail: c.error,
          status: toStatus(c.status, c.error),
          startTime: ts,
        },
      ];
    }
    case 'acp_tool_call':
    case 'codex_tool_call': {
      const u = (m.content as { update?: { toolCallId?: string; status?: string; title?: string; kind?: string } }).update;
      if (!u) return [];
      return [{
        id: String(u.toolCallId ?? m.msg_id ?? m.id),
        name: String(u.title ?? u.kind ?? 'tool'),
        status: toStatus(u.status as any),
        startTime: ts,
      }];
    }
case 'tool_group': {
      const items = Array.isArray(m.content) ? (m.content as ToolItemView[]) : [];
      return items.map((t, idx) => ({
        id: String(t.callId ?? `${m.id}:${t.name ?? 'tool'}:${idx}`),
        name: String(t.name ?? 'tool'),
        detail: t.command ?? t.description ?? (t.fileName ? `${t.fileName}${t.fileDiff ? ' (diff)' : ''}` : undefined),
        status: toStatus(t.status),
        startTime: ts,
      }));
    }
    case 'sub_agent': {
      const c = m.content as ToolItemView;
      const nodes = Array.isArray(c.nodes) ? c.nodes : [];
      const agent = c.agentName;
      const out: ActivityToolCall[] = [
        {
          id: `sa:${c.parentCallId ?? m.id}`,
          name: String(agent ?? 'sub-agent'),
          status: toStatus(c.status),
          agent,
          startTime: ts,
        },
      ];
      for (const n of nodes) {
        if (!n || (n.kind && n.kind !== 'tool')) continue;
        out.push({
          id: `n:${n.callId ?? n.id ?? m.id}`,
          name: String(n.name ?? 'tool'),
          detail: n.command ?? n.detail,
          status: toStatus(n.status),
          agent,
          startTime: ts,
        });
      }
      return out;
    }
    case 'activity': {
      const c = m.content as { nodes?: ToolItemView[] };
      const out: ActivityToolCall[] = [];
      const walk = (list: ToolItemView[] | undefined, parentAgent?: string) => {
        for (const n of list ?? []) {
          if (!n) continue;
          const kind = String(n.kind ?? 'tool');
          const isTool = kind === 'tool' || kind === 'cua' || kind === 'browser';
          const isSub = kind === 'sub_agent';
          if (isTool || isSub) {
            out.push({
              id: `a:${n.callId ?? n.id ?? m.id}`,
              name: String(n.name ?? kind),
              detail: n.command ?? n.detail,
              status: toStatus(n.status),
              agent: isSub ? (n.name ?? parentAgent) : parentAgent,
              startTime: ts,
              endTime: n.endTime,
            });
            if (isSub) walk(n.children, n.name ?? parentAgent);
          } else if (n.children) {
            walk(n.children, parentAgent);
          }
        }
      };
      walk(c.nodes);
      return out;
    }
    default:
      return [];
  }
}

const EMPTY_COUNTERS: ActivityCounters = {
  calls: 0,
  tokens: 0,
  costUsd: 0,
  prompts: 0,
  waitingReplies: 0,
};

export type UseAgentActivityReturn = {
  tasks: ActivityTask[];
  counters: ActivityCounters;
  loading: boolean;
  refresh: () => Promise<void>;
};

export function useAgentActivity(conversationId?: string): UseAgentActivityReturn {
  const [tasks, setTasks] = useState<ActivityTask[]>([]);
  const [counters, setCounters] = useState<ActivityCounters>(EMPTY_COUNTERS);
  const [loading, setLoading] = useState(false);
  const tasksRef = useRef<ActivityTask[]>([]);
  const countersRef = useRef<ActivityCounters>(EMPTY_COUNTERS);

  const recomputeCounters = useCallback((list: ActivityTask[], waitingReplies: number) => {
    let calls = 0;
    for (const t of list) calls += t.calls.length;
    countersRef.current = { ...countersRef.current, calls, prompts: list.filter((t) => t.kind === 'prompt').length, waitingReplies };
    setCounters({ ...countersRef.current });
  }, []);

  /** Append/merge a tool call into the current (last) task. */
  const pushCall = useCallback((call: ActivityToolCall) => {
    const list = tasksRef.current;
    if (list.length === 0) {
      const task: ActivityTask = {
        id: `implicit:${call.startTime ?? Date.now()}`,
        title: 'autonomous',
        startTime: call.startTime ?? Date.now(),
        kind: 'ritual',
        calls: [call],
        running: call.status === 'running',
      };
      tasksRef.current = [task];
      setTasks([...tasksRef.current]);
      recomputeCounters(tasksRef.current, countersRef.current.waitingReplies);
      return;
    }
    const target = list[list.length - 1];
    const idx = target.calls.findIndex((c) => c.id === call.id);
    if (idx >= 0) {
      const merged = { ...target.calls[idx], ...call };
      target.calls[idx] = merged;
      target.running = target.calls.some((c) => c.status === 'running');
    } else {
      target.calls.push(call);
      if (call.status === 'running') target.running = true;
    }
    tasksRef.current = [...list];
    setTasks(tasksRef.current);
    recomputeCounters(tasksRef.current, countersRef.current.waitingReplies);
  }, [recomputeCounters]);

  const ingestMessages = useCallback((messages: TMessage[]) => {
    const sorted = [...messages].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
    const built: ActivityTask[] = [];
    let current: ActivityTask | null = null;
    let waitingReplies = 0;
    let lastWaitingTs = 0;

    for (const m of sorted) {
      const ts = m.createdAt ?? 0;
      if (isHumanPrompt(m)) {
        current = {
          id: m.id,
          title: String((m.content as { content?: string }).content ?? '(prompt)').slice(0, 160),
          startTime: ts,
          kind: 'prompt',
          calls: [],
          running: false,
        };
        built.push(current);
        continue;
      }
      if (m.type === 'agent_status' || m.type === 'tips') continue;
      const calls = extractToolCalls(m, ts);
      if (calls.length === 0) continue;
      if (!current) {
        current = {
          id: `implicit:${ts}`,
          title: 'autonomous',
          startTime: ts,
          kind: 'ritual',
          calls: [],
          running: false,
        };
        built.push(current);
      }
      for (const c of calls) {
        const idx = current.calls.findIndex((x) => x.id === c.id);
        if (idx >= 0) current.calls[idx] = { ...current.calls[idx], ...c };
        else current.calls.push(c);
      }
      current.running = current.calls.some((c) => c.status === 'running');
    }

    for (const m of sorted) {
      if (!isHumanPrompt(m)) continue;
      const ts = m.createdAt ?? 0;
      if (lastWaitingTs > 0 && ts - lastWaitingTs < 60_000) waitingReplies += 1;
      lastWaitingTs = ts;
    }

    tasksRef.current = built;
    setTasks(built);
    countersRef.current = { ...EMPTY_COUNTERS };
    recomputeCounters(built, waitingReplies);
  }, [recomputeCounters]);

  const loadTokens = useCallback(async (cid: string) => {
    try {
      const agg = await ipcBridge.cost.byConversation.invoke({
        fromMs: 0,
        toMs: Date.now(),
      });
      const row = (agg ?? []).find((a) => a.key === cid);
      if (row) {
        countersRef.current = {
          ...countersRef.current,
          tokens: row.tokensTotal ?? 0,
          costUsd: row.costUsd ?? 0,
        };
        setCounters({ ...countersRef.current });
      }
    } catch (e) {
      console.warn('[useAgentActivity] cost.byConversation failed', e);
    }
  }, []);

  const refresh = useCallback(async () => {
    if (!conversationId) return;
    setLoading(true);
    try {
      const messages = await ipcBridge.database.getConversationMessages.invoke({
        conversation_id: conversationId,
        page: 0,
        pageSize: PAGE_SIZE,
      });
      ingestMessages(messages);
      await loadTokens(conversationId);
    } catch (e) {
      console.warn('[useAgentActivity] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [conversationId, ingestMessages, loadTokens]);

  useEffect(() => {
    if (!conversationId) {
      setTasks([]);
      setCounters(EMPTY_COUNTERS);
      return;
    }
    void refresh();

    const unsubStream = ipcBridge.conversation.responseStream.on((msg) => {
          if (msg.conversation_id !== conversationId) return;
          if (msg.type === 'tool_group' || msg.type === 'tool_call' || msg.type === 'acp_tool_call' || msg.type === 'codex_tool_call') {
            const fake: TMessage = {
              id: msg.msg_id,
              msg_id: msg.msg_id,
              conversation_id: msg.conversation_id,
              type: msg.type as 'tool_group',
              content: msg.data as never,
              createdAt: Date.now(),
            };
            for (const c of extractToolCalls(fake, Date.now())) pushCall(c);
          }
        });

        // Remote agent (Hermes/OpenClaw) conversations stream tool calls on a
        // separate emitter. Subscribe too so remote agents (e.g. secretaria with
        // all integrations) show up in the Activity tab.
        const onRemote = (msg: IResponseMessage) => {
          if (msg.conversation_id !== conversationId) return;
          if (msg.type === 'tool_group' || msg.type === 'tool_call' || msg.type === 'acp_tool_call' || msg.type === 'codex_tool_call') {
            const fake: TMessage = {
              id: msg.msg_id,
              msg_id: msg.msg_id,
              conversation_id: msg.conversation_id,
              type: msg.type as 'tool_group',
              content: msg.data as never,
              createdAt: Date.now(),
            };
            for (const c of extractToolCalls(fake, Date.now())) pushCall(c);
          }
        };
        const unsubStreamRemote = ipcBridge.openclawConversation.responseStream.on(onRemote);

    const unsubTurn = ipcBridge.conversation.turnCompleted.on((evt) => {
      if (evt.sessionId !== conversationId) return;
      if (evt.state === 'ai_waiting_input') {
        const list = tasksRef.current;
        if (list.length > 0) {
          list[list.length - 1].running = false;
          tasksRef.current = [...list];
          setTasks(tasksRef.current);
        }
      }
      void loadTokens(conversationId);
    });

    return () => {
          unsubStream();
          unsubTurn();
          unsubStreamRemote();
        };
  }, [conversationId, refresh, pushCall, loadTokens]);

  return { tasks, counters, loading, refresh };
}
