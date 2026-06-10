/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * WorkflowNeedsInputCard - the blue "your move" beat.
 *
 * Shown above the composer when the agent's turn has ended and the current
 * step is not done (i.e. it asked you something / is waiting on you). It is
 * deliberately loud and unmistakable - blue, a clear heading, and a focused
 * input right here - so the user never has to read a wall of transcript to
 * realize it is their turn. Sending routes the reply into the same
 * conversation, which resumes the run.
 */

import { CornerDownLeft, MessageCircleQuestion } from 'lucide-react';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ipcBridge } from '@/common';

import styles from './WorkflowNeedsInputCard.module.css';

export type WorkflowNeedsInputCardProps = {
  conversationId: string;
  /** Fired after a reply is sent, so the parent can reset transient state. */
  onSent?: () => void;
};

export const WorkflowNeedsInputCard: React.FC<WorkflowNeedsInputCardProps> = ({ conversationId, onSent }) => {
  const { t } = useTranslation();
  const [value, setValue] = useState('');
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const send = useCallback(() => {
    const input = value.trim();
    if (!input || sending) return;
    setSending(true);
    void ipcBridge.conversation.sendMessage
      .invoke({
        input,
        msg_id: `workflow-reply-${conversationId}-${Date.now()}`,
        conversation_id: conversationId,
      })
      .then(() => {
        setValue('');
        onSent?.();
      })
      .catch((err: unknown) => {
        console.warn('[WorkflowNeedsInputCard] reply send failed:', err);
      })
      .finally(() => setSending(false));
  }, [value, sending, conversationId, onSent]);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    },
    [send]
  );

  return (
    <div className={styles.card} data-testid='workflow-needs-input-card'>
      <div className={styles.head}>
        <span className={styles.icon}>
          <MessageCircleQuestion size={16} aria-hidden='true' />
        </span>
        <span className={styles.title}>
          {t('workflow.needsInput.title', { defaultValue: 'Wayland needs your input' })}
        </span>
      </div>
      <div className={styles.sub}>
        {t('workflow.needsInput.sub', {
          defaultValue: 'It is waiting on you to continue. Answer here and the run picks up where it left off.',
        })}
      </div>
      <div className={styles.inputRow}>
        <textarea
          ref={textareaRef}
          className={styles.input}
          value={value}
          autoFocus
          rows={1}
          placeholder={t('workflow.needsInput.placeholder', { defaultValue: 'Type your answer to continue…' })}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
        />
        <button
          type='button'
          className={styles.send}
          disabled={!value.trim() || sending}
          onClick={send}
          aria-label={t('workflow.needsInput.send', { defaultValue: 'Send answer' })}
        >
          <CornerDownLeft size={15} aria-hidden='true' />
        </button>
      </div>
    </div>
  );
};

export default WorkflowNeedsInputCard;
