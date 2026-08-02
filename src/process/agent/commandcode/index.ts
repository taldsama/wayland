/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { uuid } from '@/common/utils';
import { CommandCodeConnection } from './CommandCodeConnection';
import type { AcpResult } from '@/common/types/acpTypes';
import { createAcpError, AcpErrorType } from '@/common/types/acpTypes';

export interface CommandCodeAgentConfig {
  /** Conversation id */
  id: string;
  /** Working directory */
  workingDir: string;
  /** Stream event callback (for persisted messages) */
  onStreamEvent: (data: IResponseMessage) => void;
  /** Signal event callback (for lifecycle events like finish) */
  onSignalEvent: (data: IResponseMessage) => void;
}

/**
 * CommandCodeAgent spawns `command-code "<msg>" --print --output-format json
 * --permission-mode auto-accept` per message, parses the NDJSON event stream
 * and emits IResponseMessage events (same shape as NanobotAgent).
 */
export class CommandCodeAgent {
  private readonly id: string;
  private readonly config: CommandCodeAgentConfig;
  private connection: CommandCodeConnection;
  private sessionId: string;

  constructor(config: CommandCodeAgentConfig) {
    this.id = config.id;
    this.config = config;
    this.connection = new CommandCodeConnection(config.workingDir);
    // Reuse conversation id as the Command Code session id to keep context.
    this.sessionId = config.id;
  }

  /** No-op: Command Code CLI is stateless per invocation. */
  async start(): Promise<void> {
    /* nothing to start */
  }

  /**
   * Send a message to the Command Code CLI and emit response streaming events.
   */
  async sendMessage(data: { content: string; msg_id?: string }): Promise<AcpResult> {
    const responseMsgId = uuid();

    try {
      const responseText = await this.connection.sendMessage(data.content);

      this.config.onStreamEvent({
        type: 'content',
        conversation_id: this.id,
        msg_id: responseMsgId,
        data: responseText,
      });

      this.config.onSignalEvent({
        type: 'finish',
        conversation_id: this.id,
        msg_id: uuid(),
        data: null,
      });

      return { success: true, data: null };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.config.onStreamEvent({
        type: 'error',
        conversation_id: this.id,
        msg_id: uuid(),
        data: errorMsg,
      });

      this.config.onSignalEvent({
        type: 'finish',
        conversation_id: this.id,
        msg_id: uuid(),
        data: null,
      });

      return {
        success: false,
        error: createAcpError(AcpErrorType.UNKNOWN, errorMsg, false),
      };
    }
  }

  /** Stop/kill any running Command Code process. */
  stop(): Promise<void> {
    this.connection.kill();
    return Promise.resolve();
  }

  kill(): void {
    this.connection.kill();
  }
}
