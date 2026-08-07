/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * SpokenTextPreprocessor (Voice Backend v1.2)
 *
 * Normalizes and cleans LLM-generated text before TTS synthesis so that the
 * vocal engine speaks clean natural sentences instead of reading markdown symbols,
 * technical syntax, raw URLs, or code blocks aloud.
 */
export class SpokenTextPreprocessor {
  /**
   * Preprocess text for speech synthesis.
   * @param text Raw markdown/formatted text from LLM.
   * @returns Cleaned plain text ready for TTS.
   */
  static process(text: string): string {
    if (!text) return '';

    let cleaned = text;

    // 1. Remove fenced code blocks (```lang ... ```) entirely or replace with brief placeholder
    cleaned = cleaned.replace(/```[\s\S]*?```/g, ' [bloque de código omitido] ');

    // 2. Remove inline code snippets (`code`)
    cleaned = cleaned.replace(/`([^`]+)`/g, '$1');

    // 3. Clean Markdown links [link text](http://...) -> link text
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');

    // 4. Clean raw URLs (http://... or https://...) -> 'enlace' or domain
    cleaned = cleaned.replace(/https?:\/\/[^\s]+/g, ' enlace ');

    // 5. Strip Markdown formatting: **bold**, *italic*, __bold__, _italic_, ~~strikethrough~~
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, '$1');
    cleaned = cleaned.replace(/\*([^*]+)\*/g, '$1');
    cleaned = cleaned.replace(/__([^_]+)__/g, '$1');
    cleaned = cleaned.replace(/_([^_]+)_/g, '$1');
    cleaned = cleaned.replace(/~~([^~]+)~~/g, '$1');

    // 6. Strip Markdown headers (# Header)
    cleaned = cleaned.replace(/^#{1,6}\s+/gm, '');

    // 7. Strip list bullet prefixes (*, -, +, 1.)
    cleaned = cleaned.replace(/^[\s]*[-*+]\s+/gm, '');
    cleaned = cleaned.replace(/^[\s]*\d+\.\s+/gm, '');

    // 8. Remove HTML tags
    cleaned = cleaned.replace(/<[^>]*>/g, '');

    // 9. Normalize multiple spaces, newlines and tabs
    cleaned = cleaned.replace(/\s+/g, ' ').trim();

    return cleaned;
  }
}
