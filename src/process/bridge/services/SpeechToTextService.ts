/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import type {
  SpeechToTextAudioBuffer,
  SpeechToTextConfig,
  SpeechToTextProvider,
  SpeechToTextRequest,
  SpeechToTextResult,
} from '@/common/types/speech';
import { mainError, mainLog, mainWarn } from '@process/utils/mainLogger';
import { ProcessConfig } from '@process/utils/initStorage';
import { WhisperLocal } from '@process/services/voice/WhisperLocal';
import { readConnectedFluxKey } from '@process/connectors/fluxKey';
import { resolveFluxSttDefault } from '@process/utils/fluxSttDefault';

type OpenAITranscriptionResponse = {
  language?: string;
  text?: string;
};

type DeepgramTranscriptionResponse = {
  results?: {
    channels?: Array<{
      alternatives?: Array<{
        transcript?: string;
      }>;
      detected_language?: string;
    }>;
  };
};

const DEFAULT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_OPENAI_MODEL = 'whisper-1';
const DEFAULT_DEEPGRAM_BASE_URL = 'https://api.deepgram.com/v1/listen';
const DEFAULT_DEEPGRAM_MODEL = 'nova-2';
const DEFAULT_WHISPER_LOCAL_MODEL = 'base';
const FLUX_VOICE_BASE_URL = 'https://api.fluxrouter.ai/v1';
const FLUX_VOICE_MODEL = 'flux-voice';
const STT_LOG_TAG = '[SpeechToText]';

const createRequestId = () => `stt-${Date.now().toString(36)}-${Math.random().toString(16).slice(2, 8)}`;

const getErrorMessage = (error: unknown) => {
  return error instanceof Error ? error.message : String(error);
};

const getErrorCode = (error: unknown) => {
  const message = getErrorMessage(error);
  const [code] = message.split(':');
  return code || 'STT_UNKNOWN';
};

const normalizeAudioBuffer = (audioBuffer: SpeechToTextAudioBuffer): Uint8Array => {
  if (audioBuffer instanceof Uint8Array) {
    return audioBuffer;
  }

  if (Array.isArray(audioBuffer)) {
    return Uint8Array.from(audioBuffer);
  }

  const orderedKeys = Object.keys(audioBuffer)
    .filter((key) => /^\d+$/.test(key))
    .toSorted((a, b) => Number(a) - Number(b));

  return Uint8Array.from(orderedKeys.map((key) => audioBuffer[key] ?? 0));
};

const getRequestLogMeta = (request: SpeechToTextRequest) => {
  const normalizedAudioBuffer = normalizeAudioBuffer(request.audioBuffer);
  return {
    audioBytes: normalizedAudioBuffer.byteLength,
    hasLanguageHint: Boolean(request.languageHint),
    languageHint: request.languageHint || undefined,
    mimeType: request.mimeType || 'application/octet-stream',
  };
};

const normalizeBaseUrl = (baseUrl: string | undefined, fallback: string) => {
  const trimmed = baseUrl?.trim();
  return trimmed && trimmed.length > 0 ? trimmed.replace(/\/+$/, '') : fallback;
};

const toErrorMessage = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as {
      error?: {
        message?: string;
        code?: string;
      };
      err_msg?: string;
    };
    return payload.error?.message || payload.err_msg || `${response.status} ${response.statusText}`;
  } catch {
    return `${response.status} ${response.statusText}`;
  }
};

const toFluxErrorCode = async (response: Response): Promise<string> => {
  try {
    const payload = (await response.json()) as {
      error?: { code?: string; message?: string };
    };
    return payload.error?.code || '';
  } catch {
    return '';
  }
};

const buildOpenAIUrl = (baseUrl?: string) => {
  const normalized = normalizeBaseUrl(baseUrl, DEFAULT_OPENAI_BASE_URL);
  return normalized.endsWith('/audio/transcriptions') ? normalized : `${normalized}/audio/transcriptions`;
};

const buildDeepgramUrl = (config: SpeechToTextConfig['deepgram'], languageHint?: string) => {
  const normalized = normalizeBaseUrl(config?.baseUrl, DEFAULT_DEEPGRAM_BASE_URL);
  const url = new URL(normalized);
  url.searchParams.set('model', config?.model || DEFAULT_DEEPGRAM_MODEL);
  url.searchParams.set('punctuate', String(config?.punctuate !== false));
  url.searchParams.set('smart_format', String(config?.smartFormat !== false));

  const effectiveLanguage = languageHint || config?.language;
  if (effectiveLanguage) {
    url.searchParams.set('language', effectiveLanguage);
  } else if (config?.detectLanguage !== false) {
    url.searchParams.set('detect_language', 'true');
  }

  return url.toString();
};

/**
 * Resolves the effective STT config. When the user has not configured any STT
 * engine and Flux Router is connected, transparently seeds Flux Voice as the
 * default (zero-config). An explicit user choice is never overridden.
 */
const resolveSpeechToTextConfig = async (): Promise<SpeechToTextConfig> => {
  const stored = await ProcessConfig.get('tools.speechToText');
  if (!stored?.enabled) {
    mainWarn(STT_LOG_TAG, 'Speech-to-text request rejected because feature is disabled');
    throw new Error('STT_DISABLED');
  }

  // Zero-config default: if Flux is connected and the user hasn't configured
  // another STT engine, use Flux Voice transparently for this request.
  if (stored.provider !== 'flux-voice' && stored.provider !== 'deepgram' && stored.provider !== 'whisper-local') {
    const hasOpenAiKey = Boolean(stored.openai?.apiKey?.trim());
    if (!hasOpenAiKey) {
      try {
        const fluxKey = await readConnectedFluxKey();
        const seeded = resolveFluxSttDefault({ current: stored, fluxKey });
        if (seeded) {
          mainLog(STT_LOG_TAG, 'Using Flux Voice as default STT (Flux connected, no STT engine configured)');
          return { ...seeded, enabled: true };
        }
      } catch {
        // Non-fatal: fall through to the stored config.
      }
    }
  }

  return stored;
};

const resolveProviderApiKey = (provider: SpeechToTextProvider, config: SpeechToTextConfig): string => {
  if (provider === 'openai' || provider === 'flux-voice') {
    const apiKey = config.openai?.apiKey?.trim();
    if (!apiKey) {
      throw new Error(provider === 'flux-voice' ? 'STT_FLUX_NOT_CONFIGURED' : 'STT_OPENAI_NOT_CONFIGURED');
    }
    return apiKey;
  }

  if (provider === 'deepgram') {
    const apiKey = config.deepgram?.apiKey?.trim();
    if (!apiKey) {
      throw new Error('STT_DEEPGRAM_NOT_CONFIGURED');
    }
    return apiKey;
  }

  throw new Error('STT_OPENAI_NOT_CONFIGURED');
};

const resolveProviderModel = (config: SpeechToTextConfig): string | undefined => {
  if (config.provider === 'openai') {
    return config.openai?.model || DEFAULT_OPENAI_MODEL;
  }
  if (config.provider === 'flux-voice') {
    return config.openai?.model || FLUX_VOICE_MODEL;
  }
  if (config.provider === 'deepgram') {
    return config.deepgram?.model || DEFAULT_DEEPGRAM_MODEL;
  }
  return config.whisperLocal?.model || DEFAULT_WHISPER_LOCAL_MODEL;
};

export class SpeechToTextService {
  static async transcribe(request: SpeechToTextRequest): Promise<SpeechToTextResult> {
    const requestId = createRequestId();
    const startedAt = Date.now();
    mainLog(STT_LOG_TAG, 'Transcription requested', {
      requestId,
      ...getRequestLogMeta(request),
    });

    try {
      const config = await resolveSpeechToTextConfig();
      mainLog(STT_LOG_TAG, 'Resolved speech-to-text provider', {
        requestId,
        provider: config.provider,
        model: resolveProviderModel(config),
      });

      const result =
        config.provider === 'flux-voice'
          ? await this.transcribeWithFluxVoice(config, request)
          : config.provider === 'openai'
            ? await this.transcribeWithOpenAI(config, request)
            : config.provider === 'deepgram'
              ? await this.transcribeWithDeepgram(config, request)
              : await this.transcribeWithWhisperLocal(config, request);

      mainLog(STT_LOG_TAG, 'Transcription completed', {
        requestId,
        durationMs: Date.now() - startedAt,
        language: result.language,
        model: result.model,
        provider: result.provider,
        textLength: result.text.length,
      });

      return result;
    } catch (error) {
      mainError(STT_LOG_TAG, 'Transcription failed', {
        requestId,
        durationMs: Date.now() - startedAt,
        errorCode: getErrorCode(error),
        message: getErrorMessage(error),
      });
      throw error;
    }
  }

  /**
   * Transcribes audio via Flux Voice (`POST /v1/audio/transcriptions`).
   * Uses the same multipart wire format as OpenAI Whisper.
   *
   * Error mapping per the handoff spec §5:
   *   402 premium_locked → STT_FLUX_PREMIUM_LOCKED (upgrade prompt, no retry)
   *   401               → STT_FLUX_AUTH_ERROR      (bad/missing key)
   *   413 file_too_large → STT_FILE_TOO_LARGE
   *   429 rate_limit    → STT_RATE_LIMITED
   *   other 4xx/5xx     → STT_REQUEST_FAILED
   */
  private static async transcribeWithFluxVoice(
    config: SpeechToTextConfig,
    request: SpeechToTextRequest
  ): Promise<SpeechToTextResult> {
    const apiKey = resolveProviderApiKey('flux-voice', config);
    const model = config.openai?.model || FLUX_VOICE_MODEL;
    const baseUrl = normalizeBaseUrl(config.openai?.baseUrl, FLUX_VOICE_BASE_URL);
    const url = baseUrl.endsWith('/audio/transcriptions') ? baseUrl : `${baseUrl}/audio/transcriptions`;

    const audioBuffer = Buffer.from(normalizeAudioBuffer(request.audioBuffer));
    const blob = new Blob([audioBuffer], { type: request.mimeType || 'application/octet-stream' });
    const formData = new FormData();
    formData.append('file', blob, request.fileName);
    formData.append('model', model);

    const language = request.languageHint || config.openai?.language;
    if (language) {
      formData.append('language', language.split('-')[0].toLowerCase());
    }
    if (config.openai?.prompt) {
      formData.append('prompt', config.openai.prompt);
    }
    if (typeof config.openai?.temperature === 'number') {
      formData.append('temperature', String(config.openai.temperature));
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: formData,
    });

    if (!response.ok) {
      if (response.status === 402) {
        const code = await toFluxErrorCode(response);
        if (code === 'premium_locked') {
          throw new Error('STT_FLUX_PREMIUM_LOCKED');
        }
      }
      if (response.status === 401) {
        throw new Error('STT_FLUX_AUTH_ERROR');
      }
      if (response.status === 413) {
        throw new Error('STT_FILE_TOO_LARGE');
      }
      if (response.status === 429) {
        throw new Error('STT_RATE_LIMITED');
      }
      throw new Error(`STT_REQUEST_FAILED:${await toErrorMessage(response)}`);
    }

    const payload = (await response.json()) as OpenAITranscriptionResponse;
    return {
      language: payload.language || language,
      model,
      provider: 'flux-voice',
      text: payload.text?.trim() || '',
    };
  }

  private static async transcribeWithOpenAI(
    config: SpeechToTextConfig,
    request: SpeechToTextRequest
  ): Promise<SpeechToTextResult> {
    const apiKey = resolveProviderApiKey('openai', config);
    const audioBuffer = Buffer.from(normalizeAudioBuffer(request.audioBuffer));
    const blob = new Blob([audioBuffer], {
      type: request.mimeType || 'application/octet-stream',
    });
    const formData = new FormData();
    formData.append('file', blob, request.fileName);
    formData.append('model', config.openai?.model || DEFAULT_OPENAI_MODEL);

    const language = request.languageHint || config.openai?.language;
    if (language) {
      // OpenAI Whisper requires ISO 639-1 codes (e.g. "en"), not BCP 47 (e.g. "en-us")
      formData.append('language', language.split('-')[0].toLowerCase());
    }
    if (config.openai?.prompt) {
      formData.append('prompt', config.openai.prompt);
    }
    if (typeof config.openai?.temperature === 'number') {
      formData.append('temperature', String(config.openai.temperature));
    }

    const response = await fetch(buildOpenAIUrl(config.openai?.baseUrl), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`STT_REQUEST_FAILED:${await toErrorMessage(response)}`);
    }

    const payload = (await response.json()) as OpenAITranscriptionResponse;
    return {
      language: payload.language || language,
      model: config.openai?.model || DEFAULT_OPENAI_MODEL,
      provider: 'openai',
      text: payload.text?.trim() || '',
    };
  }

  private static async transcribeWithDeepgram(
    config: SpeechToTextConfig,
    request: SpeechToTextRequest
  ): Promise<SpeechToTextResult> {
    const apiKey = resolveProviderApiKey('deepgram', config);
    const response = await fetch(buildDeepgramUrl(config.deepgram, request.languageHint), {
      method: 'POST',
      headers: {
        Authorization: `Token ${apiKey}`,
        'Content-Type': request.mimeType || 'application/octet-stream',
      },
      body: Buffer.from(normalizeAudioBuffer(request.audioBuffer)),
    });

    if (!response.ok) {
      throw new Error(`STT_REQUEST_FAILED:${await toErrorMessage(response)}`);
    }

    const payload = (await response.json()) as DeepgramTranscriptionResponse;
    const channel = payload.results?.channels?.[0];
    const transcript = channel?.alternatives?.[0]?.transcript?.trim() || '';
    return {
      language: request.languageHint || config.deepgram?.language || channel?.detected_language,
      model: config.deepgram?.model || DEFAULT_DEEPGRAM_MODEL,
      provider: 'deepgram',
      text: transcript,
    };
  }

  private static async transcribeWithWhisperLocal(
    config: SpeechToTextConfig,
    request: SpeechToTextRequest
  ): Promise<SpeechToTextResult> {
    return WhisperLocal.transcribe(request, config.whisperLocal ?? { model: DEFAULT_WHISPER_LOCAL_MODEL });
  }
}
