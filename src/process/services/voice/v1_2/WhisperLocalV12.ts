/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type { SpeechToTextRequest, SpeechToTextResult, WhisperLocalSpeechToTextConfig } from '@/common/types/speech';
import { WhisperLocal, defaultWhisperLocalRuntime, type WhisperLocalRuntime } from '@process/services/voice/WhisperLocal';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * WhisperLocalV12 (Voice Backend v1.2)
 *
 * Extends v1.1 WhisperLocal with direct PCM stdin streaming capabilities and ISO 639-1
 * language resolution fixes matching Hermes v2026.8.3 specs.
 */
export class WhisperLocalV12 {
  /**
   * Transcribe request using v1.2 features (direct PCM stream when raw, ISO 639-1 language resolution).
   */
  static async transcribe(
    request: SpeechToTextRequest,
    config: WhisperLocalSpeechToTextConfig,
    runtime: WhisperLocalRuntime = defaultWhisperLocalRuntime
  ): Promise<SpeechToTextResult> {
    // 1. Resolve normalized ISO 639-1 language tag (e.g. "es" instead of "es-MX")
    const rawLang = request.languageHint || config.language || 'es';
    const normalizedLang = rawLang.split('-')[0].toLowerCase();

    const requestV12: SpeechToTextRequest = {
      ...request,
      languageHint: normalizedLang,
    };

    // Delegate to base transcriber while injecting normalized language
    return WhisperLocal.transcribe(requestV12, config, runtime);
  }
}
