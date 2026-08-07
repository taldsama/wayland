/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextToSpeechConfig } from '@/common/types/ttsTypes';
import { StreamingTextToSpeechV12, type ClauseAudioChunk } from './StreamingTextToSpeechV12';

export type VoiceStateV12 = 'idle' | 'listening' | 'processing' | 'speaking' | 'interrupted';

export type VoiceControllerV12Config = {
  ttsConfig: TextToSpeechConfig;
  /** Wake word string, e.g. "hey hermes" or "maid-chan" */
  wakeWord?: string;
  /** Enable automatic barge-in interruption when mic detects speech during TTS */
  enableBargeIn?: boolean;
};

/**
 * FullDuplexVoiceControllerV12 (Voice Backend v1.2)
 *
 * Full-duplex conversational voice state machine and session orchestrator.
 * Supports streaming TTS, barge-in voice interruption, hands-free stop commands,
 * and seamless turn-taking without losing context.
 */
export class FullDuplexVoiceControllerV12 {
  private state: VoiceStateV12 = 'idle';
  private streamingTTS = new StreamingTextToSpeechV12();
  private config: VoiceControllerV12Config;
  private onStateChange?: (state: VoiceStateV12) => void;
  private onAudioChunk?: (chunk: ClauseAudioChunk) => void;

  constructor(
    config: VoiceControllerV12Config,
    listeners?: {
      onStateChange?: (state: VoiceStateV12) => void;
      onAudioChunk?: (chunk: ClauseAudioChunk) => void;
    }
  ) {
    this.config = config;
    this.onStateChange = listeners?.onStateChange;
    this.onAudioChunk = listeners?.onAudioChunk;
  }

  public getState(): VoiceStateV12 {
    return this.state;
  }

  private setState(newState: VoiceStateV12): void {
    if (this.state !== newState) {
      this.state = newState;
      this.onStateChange?.(newState);
    }
  }

  /** Start a new voice conversation turn */
  public startTurn(): void {
    this.streamingTTS.reset();
    this.setState('listening');
  }

  /** Mic finished capturing audio, now sending to LLM */
  public finishListening(): void {
    this.setState('processing');
  }

  /**
   * Called when LLM emits a new token chunk.
   * Feeds token into Clause-by-Clause TTS streaming engine.
   */
  public async handleLLMToken(token: string): Promise<void> {
    if (this.state === 'interrupted') return;

    if (this.state !== 'speaking') {
      this.setState('speaking');
    }

    await this.streamingTTS.processToken(token, this.config.ttsConfig, (chunk) => {
      if (this.state === 'speaking') {
        this.onAudioChunk?.(chunk);
      }
    });
  }

  /** Called when LLM generation completes */
  public async finishTurn(): Promise<void> {
    if (this.state === 'speaking') {
      await this.streamingTTS.finalize(this.config.ttsConfig, (chunk) => {
        this.onAudioChunk?.(chunk);
      });
    }
    if (this.state !== 'interrupted') {
      this.setState('idle');
    }
  }

  /**
   * BARGE-IN EVENT: User started speaking while assistant was talking/thinking,
   * or user said "stop". Immediately halts TTS playback and signals interruption.
   */
  public triggerBargeIn(reason: 'user_speech_detected' | 'stop_command' | 'manual_cancel' = 'user_speech_detected'): void {
    this.streamingTTS.interrupt();
    this.setState('interrupted');
    console.log(`[VoiceV1.2] Barge-in triggered (${reason}). TTS streaming halted.`);
    
    // Auto reset to idle or listening after barge-in acknowledgement
    setTimeout(() => {
      if (this.state === 'interrupted') {
        this.setState(reason === 'stop_command' ? 'idle' : 'listening');
      }
    }, 150);
  }
}
