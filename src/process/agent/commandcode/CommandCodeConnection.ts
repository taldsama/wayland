/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { getEnhancedEnv } from '@process/utils/shellEnv';

/**
 * CommandCodeConnection — spawns the Command Code CLI headless per message
 * and streams NDJSON events.
 *
 * Command: command-code "<message>" --print --output-format json
 *          --permission-mode auto-accept [--session <realSessionId>]
 *
 * IMPORTANT: --session does NOT accept arbitrary ids. It only accepts either
 * an existing .jsonl transcript path or a real session-id returned by a
 * previous run (run_start event). Passing a random conversation id makes the
 * process exit immediately with "Process exited unexpectedly". So we:
 *   1. On first message: no --session flag → CLI creates a fresh session.
 *   2. Capture the real sessionId from the run_start event.
 *   3. Persist it to <workingDir>/.command-code-session.json.
 *   4. On subsequent messages: resume with --session <realSessionId> so the
 *      conversation keeps context across messages.
 */
export class CommandCodeConnection {
  private child: ReturnType<typeof spawn> | null = null;
  private workingDir: string;
  private cliPath: string;
  private sessionId: string | null = null;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.cliPath = this.resolveCliPath();
    this.sessionId = this.loadSessionId();
  }

  /**
   * Resolve the Command Code CLI binary. Prefers PATH lookup
   * ('command-code'), falls back to ~/.npm-global/bin/command-code and
   * ~/.local/bin/command-code (npm global install locations).
   */
  private resolveCliPath(): string {
    const candidates = ['command-code', 'commandcode'];
    for (const c of candidates) {
      try {
        const found = require('child_process').execSync(`command -v ${c}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'ignore'],
          timeout: 3000,
        } as any);
        if (found.trim()) return found.trim();
      } catch {
        /* not on PATH */
      }
    }
    const home = os.homedir();
    for (const p of [
      path.join(home, '.npm-global', 'bin', 'command-code'),
      path.join(home, '.local', 'bin', 'command-code'),
    ]) {
      try {
        require('fs').accessSync(p);
        return p;
      } catch {
        /* skip */
      }
    }
    return 'command-code';
  }

  /** Load persisted real session id for this workspace (if any). */
  private loadSessionId(): string | null {
    try {
      const p = path.join(this.workingDir, '.command-code-session.json');
      const raw = fs.readFileSync(p, 'utf-8');
      const parsed = JSON.parse(raw) as { sessionId?: string };
      return parsed.sessionId && parsed.sessionId.length > 0 ? parsed.sessionId : null;
    } catch {
      return null;
    }
  }

  /** Persist the real session id so future messages resume the same thread. */
  private saveSessionId(sessionId: string): void {
    try {
      fs.writeFileSync(
        path.join(this.workingDir, '.command-code-session.json'),
        JSON.stringify({ sessionId }),
        'utf-8'
      );
    } catch {
      /* workspace may be read-only — context just won't persist */
    }
  }

  /**
   * Send a message spawning a one-shot Command Code process.
   * Resolves with the accumulated response text, rejects on spawn/exit errors.
   * Context resumes via the persisted real session id (not a caller-supplied one).
   */
  sendMessage(message: string): Promise<string> {
    return new Promise<string>((resolve, reject) => {
      const env = getEnhancedEnv();

      const args = [
        message,
        '--print',
        '--output-format',
        'json',
        '--permission-mode',
        'auto-accept',
        '--model',
        'deepseek/deepseek-v4-flash',
      ];
      // Resume with the REAL session id (from a previous run) if we have one.
      // NEVER pass a random id (e.g. a Wayland conversation uuid) — the CLI
      // rejects it and the process exits immediately. First message has no
      // --session flag: the CLI creates a fresh session we capture below.
      if (this.sessionId) {
        args.push('--session', this.sessionId);
      }

      this.child = spawn(this.cliPath, args, {
        cwd: this.workingDir,
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        windowsHide: true,
      });

      let stdout = '';
      let stderr = '';
      let finalText = '';
      let runError: string | null = null;
      let capturedSessionId: string | null = null;

      this.child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Parse NDJSON lines incrementally
        let nl = stdout.indexOf('\n');
        while (nl !== -1) {
          const line = stdout.slice(0, nl).trim();
          stdout = stdout.slice(nl + 1);
          if (line) {
            this.parseLine(
              line,
              (t) => (finalText += t),
              (e) => (runError = e),
              (sid) => (capturedSessionId = sid)
            );
          }
          nl = stdout.indexOf('\n');
        }
      });

      this.child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      this.child.on('error', (error) => {
        reject(new Error(`Failed to spawn ${this.cliPath}: ${error.message}`));
      });

      this.child.on('close', (code) => {
        // Capture the real session id for next message (first run only).
        if (capturedSessionId) {
          this.sessionId = capturedSessionId;
          this.saveSessionId(capturedSessionId);
        }
        if (runError) {
          reject(new Error(runError));
        } else if (code !== 0 && !finalText) {
          reject(
            new Error(
              `${this.cliPath} exited with code ${code}: ${stderr.trim() || 'no output'}`
            )
          );
        } else {
          resolve(finalText);
        }
      });
    });
  }

  /**
   * Parse a single NDJSON line. Accumulates text deltas; captures run errors
   * and the real session id (run_start).
   */
  private parseLine(
    line: string,
    onDelta: (text: string) => void,
    onError: (msg: string) => void,
    onSessionId: (sid: string) => void
  ): void {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'event' && obj.event) {
        const ev = obj.event;
        if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
          onDelta(ev.delta);
        } else if (ev.type === 'run_start' && typeof ev.sessionId === 'string') {
          onSessionId(ev.sessionId);
        } else if (ev.type === 'run_error' && ev.error?.message) {
          onError(ev.error.message);
        }
      } else if (obj.type === 'result') {
        if (obj.error) {
          onError(String(obj.error));
        } else if (typeof obj.finalText === 'string' && obj.finalText) {
          onDelta(obj.finalText);
        }
      }
    } catch {
      /* non-JSON line (e.g. log noise) — ignore */
    }
  }

  /** Kill any running child process tree. */
  kill(): void {
    if (this.child && !this.child.killed) {
      try {
        this.child.kill('SIGKILL');
      } catch {
        /* already dead */
      }
    }
    this.child = null;
  }
}
