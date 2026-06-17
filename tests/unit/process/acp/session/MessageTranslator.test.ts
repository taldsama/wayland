// tests/unit/process/acp/session/MessageTranslator.test.ts
import { describe, it, expect } from 'vitest';
import { MessageTranslator } from '@process/acp/session/MessageTranslator';
import type { SessionNotification } from '@agentclientprotocol/sdk';

describe('MessageTranslator', () => {
  it('translates agent_message_chunk to TMessage', () => {
    const translator = new MessageTranslator();
    const notification: SessionNotification = {
      sessionId: 'sess-1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg-1',
        content: { type: 'text', text: 'Hello' },
      },
    };
    const messages = translator.translate(notification);
    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages[0].type).toBeDefined();
  });

  it('accumulates chunks for same messageId', () => {
    const translator = new MessageTranslator();
    translator.translate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'Hello ' },
      },
    });
    const msgs = translator.translate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'world' },
      },
    });
    expect(msgs.length).toBeGreaterThanOrEqual(1);
  });

  it('translates tool_call to TMessage', () => {
    const translator = new MessageTranslator();
    const messages = translator.translate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'tc-1',
        title: 'read_file',
        rawInput: { path: '/foo' },
      },
    });
    expect(messages.length).toBeGreaterThanOrEqual(1);
  });

  it('onTurnEnd clears completed entries (INV-S-12)', () => {
    const translator = new MessageTranslator();
    translator.translate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'test' },
      },
    });
    expect(translator.activeEntryCount).toBeGreaterThan(0);
    translator.onTurnEnd();
    expect(translator.activeEntryCount).toBe(0);
  });

  it('reset clears all state', () => {
    const translator = new MessageTranslator();
    translator.translate({
      sessionId: 's1',
      update: {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'test' },
      },
    });
    translator.reset();
    expect(translator.activeEntryCount).toBe(0);
  });

  it('returns empty array for config-type updates (handled by AcpSession directly)', () => {
    const translator = new MessageTranslator();
    const msgs = translator.translate({
      sessionId: 's1',
      update: { sessionUpdate: 'current_mode_update', currentModeId: 'code' },
    });
    expect(msgs).toEqual([]);
  });

  // Accumulate every emitted text delta the way the renderer does (append by
  // msg_id), so the test asserts on the final on-screen text per message.
  const renderText = (translator: MessageTranslator, chunks: Array<{ messageId?: string; text: string }>) => {
    const byId = new Map<string, string>();
    for (const c of chunks) {
      const msgs = translator.translate({
        sessionId: 's1',
        update: { sessionUpdate: 'agent_message_chunk', messageId: c.messageId, content: { type: 'text', text: c.text } },
      } as unknown as SessionNotification);
      for (const m of msgs) {
        if (m.type === 'text') {
          byId.set(m.msg_id ?? '', (byId.get(m.msg_id ?? '') ?? '') + (m.content as { content: string }).content);
        }
      }
    }
    return byId;
  };

  it('does not double text when undefined-id deltas are followed by the full text under a real messageId (regression: PongPong)', () => {
    const translator = new MessageTranslator();
    // claude-code-acp emits: a thought claims the messageId, deltas stream under
    // messageId=undefined, then the full text repeats under the real messageId.
    translator.translate({
      sessionId: 's1',
      update: { sessionUpdate: 'agent_thought_chunk', messageId: 'msg_real', content: { type: 'text', text: '' } },
    } as unknown as SessionNotification);
    const byId = renderText(translator, [
      { messageId: undefined, text: '' },
      { messageId: undefined, text: 'A' },
      { messageId: undefined, text: ' Notion server is now connecting.' },
      { messageId: 'msg_real', text: 'A Notion server is now connecting.' },
    ]);
    expect(Array.from(byId.values())).toEqual(['A Notion server is now connecting.']);
  });

  it('does not double a single-chunk reply repeated under a real messageId (Pong -> not PongPong)', () => {
    const translator = new MessageTranslator();
    const byId = renderText(translator, [
      { messageId: undefined, text: 'Pong' },
      { messageId: 'msg_real', text: 'Pong' },
    ]);
    expect(Array.from(byId.values())).toEqual(['Pong']);
  });

  it('still accumulates normal incremental deltas without dropping text', () => {
    const translator = new MessageTranslator();
    const byId = renderText(translator, [
      { messageId: 'm1', text: 'Hello ' },
      { messageId: 'm1', text: 'wor' },
      { messageId: 'm1', text: 'ld' },
    ]);
    expect(Array.from(byId.values())).toEqual(['Hello world']);
  });
});
