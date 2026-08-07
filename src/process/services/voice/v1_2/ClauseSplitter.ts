/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * ClauseSplitter (Voice Backend v1.2)
 *
 * Buffers incoming LLM stream tokens and splits them into complete grammatical
 * clauses (sentences or major phrase units) as soon as punctuation markers appear,
 * allowing instant clause-by-clause TTS synthesis with low latency.
 */
export class ClauseSplitter {
  private buffer = '';

  /** Punctuation marks that delimit a pronounceable clause */
  private static readonly CLAUSE_DELIMITERS = /[.!?;\n:]+/;

  /**
   * Push a chunk of text from the LLM stream.
   * @param token Text token chunk.
   * @returns Array of complete clauses ready to synthesize (if any).
   */
  push(token: string): string[] {
    this.buffer += token;
    const clauses: string[] = [];

    let match: RegExpExecArray | null;
    while ((match = ClauseSplitter.CLAUSE_DELIMITERS.exec(this.buffer)) !== null) {
      const splitIndex = match.index + match[0].length;
      const rawClause = this.buffer.slice(0, splitIndex).trim();
      this.buffer = this.buffer.slice(splitIndex);

      if (rawClause.length > 0) {
        clauses.push(rawClause);
      }
    }

    return clauses;
  }

  /**
   * Flush any remaining text in the buffer (end of stream).
   * @returns Remaining clause or empty if buffer is empty.
   */
  flush(): string[] {
    const remaining = this.buffer.trim();
    this.buffer = '';
    return remaining.length > 0 ? [remaining] : [];
  }

  /** Reset buffer */
  reset(): void {
    this.buffer = '';
  }
}
