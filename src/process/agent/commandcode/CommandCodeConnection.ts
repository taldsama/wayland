/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { spawn } from 'child_process';
import path from 'node:path';
import os from 'node:os';
import { getEnhancedEnv } from '@process/utils/shellEnv';

/**
 * CommandCodeConnection — spawns the Command Code CLI headless per message
 * and streams NDJSON events.
 *
 * Command: command-code "<message>" --print --output-format json
 *          --permission-mode auto-accept --session <id>
 *
 * Output is NDJSON: lines like
 *   {"type":"event","event":{"type":"text_delta","delta":"..."}}
 *   {"type":"result","finalText":"...","error":"..."}
 * We accumulate text_delta deltas and resolve with the final text.
 */
export class CommandCodeConnection {
  private child: ReturnType<typeof spawn> | null = null;
  private workingDir: string;
  private cliPath: string;

  constructor(workingDir: string) {
    this.workingDir = workingDir;
    this.cliPath = this.resolveCliPath();
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
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const r = require('child_process');
        const found = r.execSync(`command -v ${c}`, {
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

  /**
   * Send a message spawning a one-shot Command Code process.
   * Resolves with the accumulated response text, rejects on spawn/exit errors.
   */
  sendMessage(message: string, sessionId: string): Promise<string> {
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
        '--session',
        sessionId,
      ];

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

      this.child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
        // Parse NDJSON lines incrementally
        let nl = stdout.indexOf('\n');
        while (nl !== -1) {
          const line = stdout.slice(0, nl).trim();
          stdout = stdout.slice(nl + 1);
          if (line) this.parseLine(line, (t) => (finalText += t), (e) => (runError = e));
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
   * Parse a single NDJSON line. Accumulates text deltas; captures run errors.
   */
  private parseLine(
    line: string,
    onDelta: (text: string) => void,
    onError: (msg: string) => void
  ): void {
    try {
      const obj = JSON.parse(line);
      if (obj.type === 'event' && obj.event) {
        const ev = obj.event;
        if (ev.type === 'text_delta' && typeof ev.delta === 'string') {
          onDelta(ev.delta);
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
