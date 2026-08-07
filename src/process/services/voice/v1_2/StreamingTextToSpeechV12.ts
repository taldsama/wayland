/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { TextToSpeechAudio, TextToSpeechConfig } from '@/common/types/ttsTypes';
import { synthesize as synthesizeV11 } from '@process/services/voice/TextToSpeechService';
import { ClauseSplitter } from './ClauseSplitter';
import { SpokenTextPreprocessor } from './SpokenTextPreprocessor';

export type ClauseAudioChunk = {
  clauseText: string;
  cleanedText: string;
  audio: TextToSpeechAudio;
  index: number;
};

/**
 * StreamingTextToSpeechV12 (Voice Backend v1.2)
 *
 * Implements Clause-by-Clause streaming TTS with text preprocessing and barge-in signal support.
 * Allows synthesizing audio incrementally as LLM streams text, drastically lowering latency.
 */
export class StreamingTextToSpeechV12 {
  private splitter = new ClauseSplitter();
  private isInterrupted = false;
  private clauseIndex = 0;

  /** Interrupt any active streaming synthesis immediately (Barge-in event) */
  interrupt(): void {
    this.isInterrupted = true;
    this.splitter.reset();
  }

  /** Reset state for a new streaming response */
  reset(): void {
    this.isInterrupted = false;
    this.clauseIndex = 0;
    this.splitter.reset();
  }

  /**
   * Process a stream token, pre-process clauses, and yield audio chunks as they complete.
   * @param token Text token from stream.
   * @param config TTS configuration.
   * @param onChunk Callback receiving synthesized audio chunk.
   */
  async processToken(
    token: string,
    config: TextToSpeechConfig,
    onChunk: (chunk: ClauseAudioChunk) => void
  ): Promise<void> {
    if (this.isInterrupted) return;

    const clauses = this.splitter.push(token);
    for (const clause of clauses) {
      if (this.isInterrupted) break;
      await this.synthesizeClause(clause, config, onChunk);
    }
  }

  /**
   * Flush final clause at end of stream.
   */
  async finalize(
    config: TextToSpeechConfig,
    onChunk: (chunk: ClauseAudioChunk) => void
  ): Promise<void> {
    if (this.isInterrupted) return;

    const clauses = this.splitter.flush();
    for (const clause of clauses) {
      if (this.isInterrupted) break;
      await this.synthesizeClause(clause, config, onChunk);
    }
  }

  private async synthesizeClause(
    rawClause: string,
    config: TextToSpeechConfig,
    onChunk: (chunk: ClauseAudioChunk) => void
  ): Promise<void> {
    const cleanedText = SpokenTextPreprocessor.process(rawClause);
    if (!cleanedText) return;

    try {
      const audio = await synthesizeV11(cleanedText, config);
      if (!this.isInterrupted) {
        onChunk({
          clauseText: rawClause,
          cleanedText,
          audio,
          index: this.clauseIndex++,
        });
      }
    } catch (err) {
      console.error('[StreamingTTSV12] Clause synthesis error:', err);
    }
  }
}
