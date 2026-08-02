/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { CommandCodeAgent, type CommandCodeAgentConfig } from '@process/agent/commandcode';
import { ipcBridge } from '@/common';
import type { TMessage } from '@/common/chat/chatLib';
import { transformMessage } from '@/common/chat/chatLib';
import type { IResponseMessage } from '@/common/adapter/ipcBridge';
import { uuid } from '@/common/utils';
import { addMessage, addOrUpdateMessage } from '@process/utils/message';
import { cronBusyGuard } from '@process/services/cron/CronBusyGuard';
import { skillSuggestWatcher } from '@process/services/cron/SkillSuggestWatcher';
import BaseAgentManager from '@process/task/BaseAgentManager';
import { IpcAgentEventEmitter } from '@process/task/IpcAgentEventEmitter';
import { teamEventBus } from '@process/team/teamEventBus';
import { channelEventBus } from '@process/channels/agent/ChannelEventBus';

export interface CommandCodeAgentManagerData {
  conversation_id: string;
  workspace?: string;
  customWorkspace?: boolean;
  enabledSkills?: string[];
  presetAssistantId?: string;
  yoloMode?: boolean;
}

class CommandCodeAgentManager extends BaseAgentManager<CommandCodeAgentManagerData> {
  agent!: CommandCodeAgent;
  bootstrap: Promise<CommandCodeAgent>;
  conversation_id: string;
  workspace: string;

  constructor(data: CommandCodeAgentManagerData) {
    super('command-code', data, new IpcAgentEventEmitter(), false);
    this.conversation_id = data.conversation_id;
    this.workspace = data.workspace ?? '';

    this.bootstrap = this.initAgent(data);
    // Prevent unhandled promise rejection when agent fails to start.
    this.bootstrap.catch(() => {});
  }

  private async initAgent(data: CommandCodeAgentManagerData): Promise<CommandCodeAgent> {
    const config: CommandCodeAgentConfig = {
      id: data.conversation_id,
      workingDir: data.workspace ?? process.cwd(),
      onStreamEvent: (message) => this.handleStreamEvent(message),
      onSignalEvent: (message) => this.handleSignalEvent(message),
    };

    this.agent = new CommandCodeAgent(config);

    try {
      await this.agent.start();
      return this.agent;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(`Failed to start Command Code agent: ${errorMsg}`);
      throw error;
    }
  }

  private handleStreamEvent(message: IResponseMessage): void {
    const msg = { ...message, conversation_id: this.conversation_id };

    // Persist messages to database
    const tMessage = transformMessage(msg);
    if (tMessage) {
      if (msg.type === 'content' && msg.msg_id) {
        addOrUpdateMessage(this.conversation_id, tMessage);
      } else {
        addMessage(this.conversation_id, tMessage);
      }
    }

    // Emit frontend unified conversation stream
    ipcBridge.conversation.responseStream.emit(msg);
    // Only emit terminal events to team bus for agent lifecycle management
    if (msg.type === 'finish' || msg.type === 'error') {
      teamEventBus.emit('responseStream', msg);
    }
    // Emit Channel event bus so channel-bound conversations get replies
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  private handleSignalEvent(message: IResponseMessage): void {
    const msg = { ...message, conversation_id: this.conversation_id };

    // Handle finish event
    if (msg.type === 'finish') {
      cronBusyGuard.setProcessing(this.conversation_id, false);
      skillSuggestWatcher.onFinish(this.conversation_id);
    }

    // Emit signal events to frontend
    ipcBridge.conversation.responseStream.emit(msg);
    // Only emit terminal events to team bus for agent lifecycle management
    if (msg.type === 'finish' || msg.type === 'error') {
      teamEventBus.emit('responseStream', msg);
    }
    // Forward signals (finish/error) to Channel event bus so channel
    // turn completes per-conversation send queue released.
    channelEventBus.emitAgentMessage(this.conversation_id, msg);
  }

  async sendMessage(data: {
    content: string;
    files?: string[];
    msg_id?: string;
    hidden?: boolean;
    silent?: boolean;
  }): Promise<{ success: boolean; data: unknown }> {
    cronBusyGuard.setProcessing(this.conversation_id, true);
    try {
      await this.bootstrap;

      // Save user message to chat history (frontend handles display directly)
      if (data.msg_id && data.content && !data.silent) {
        const userMessage: TMessage = {
          id: data.msg_id,
          msg_id: data.msg_id,
          type: 'text',
          position: 'right',
          conversation_id: this.conversation_id,
          content: { content: data.content },
          createdAt: Date.now(),
          ...(data.hidden ? { hidden: true } : {}),
        };
        addMessage(this.conversation_id, userMessage);
      }

      // Fire-and-forget: Command Code CLI blocks until completion, must not
      // await here. IPC response needs to return immediately so the
      // frontend displays user message. Response finish events are
      // emitted asynchronously via handleStreamEvent/handleSignalEvent.
      this.agent.sendMessage({ content: data.content }).catch((error) => {
        cronBusyGuard.setProcessing(this.conversation_id, false);
        const errorMsg = error instanceof Error ? error.message : String(error);
        this.emitErrorMessage(`Failed to send message: ${errorMsg}`);
      });

      return { success: true, data: null } as const;
    } catch (error) {
      cronBusyGuard.setProcessing(this.conversation_id, false);

      const errorMsg = error instanceof Error ? error.message : String(error);
      this.emitErrorMessage(`Failed to send message: ${errorMsg}`);
      throw error;
    }
  }

  private emitErrorMessage(error: string): void {
    const message: IResponseMessage = {
      type: 'error',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: error,
    };

    const tMessage = transformMessage(message);
    if (tMessage) {
      addMessage(this.conversation_id, tMessage);
    }

    ipcBridge.conversation.responseStream.emit(message);
    teamEventBus.emit('responseStream', message);

    // Deliver error to channels and release per-conversation send queue
    // (ChannelMessageService only releases 'finish'), mirroring WCore/Acp:
    // start/send failure doesn't hang channel.
    channelEventBus.emitAgentMessage(this.conversation_id, message);
    channelEventBus.emitAgentMessage(this.conversation_id, {
      type: 'finish',
      conversation_id: this.conversation_id,
      msg_id: uuid(),
      data: null,
    });
  }

  /**
   * Command Code does not support dynamic yolo mode.
   */
  async ensureYoloMode(): Promise<boolean> {
    return false;
  }

  stop() {
    return this.agent?.stop?.() ?? Promise.resolve();
  }
}

export default CommandCodeAgentManager;
