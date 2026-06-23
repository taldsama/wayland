/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Tests for the WSL fallback in src/process/agent/acp/AcpDetector.ts (#258).
 *
 * On Windows, `where`/PowerShell only see the Windows PATH, so CLIs installed
 * inside WSL (claude, hermes, ...) were reported "not found". The detector now
 * probes the WSL login-shell PATH via `wsl.exe -e bash -lc 'command -v <cli>'`
 * for anything missing on the Windows side.
 *
 * We pin process.platform = 'win32' and mock the safeExec exec boundary so the
 * win32 + WSL branches run (and are asserted) on any CI host. The three cases:
 *   (a) found on Windows PATH (`where` succeeds) -> reported found
 *   (b) not on Windows PATH but found via the WSL probe -> reported found
 *   (c) on neither -> not found, no throw
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// Mocks - declared before importing the module under test
// ---------------------------------------------------------------------------

const safeExecFileMock = vi.fn();
const safeExecMock = vi.fn();

vi.mock('@process/utils/safeExec', () => ({
  safeExec: (...args: unknown[]) => safeExecMock(...args),
  safeExecFile: (...args: unknown[]) => safeExecFileMock(...args),
}));

vi.mock('@process/utils/shellEnv', () => ({
  getEnhancedEnv: () => ({ PATH: 'C:\\\\Windows\\\\System32' }),
}));

// ExtensionRegistry / ProcessConfig are unused by detectBuiltinAgents but are
// imported at module load; stub them so the module evaluates.
vi.mock('@process/extensions', () => ({
  ExtensionRegistry: { getInstance: () => ({ getAcpAdapters: () => [] }) },
}));
vi.mock('@process/utils/initStorage', () => ({
  ProcessConfig: { get: async () => undefined },
}));

// Pin a small, fixed CLI list so assertions don't depend on the real catalog.
vi.mock('@/common/types/acpTypes', () => ({
  POTENTIAL_ACP_CLIS: [
    { cmd: 'claude', args: ['--experimental-acp'], name: 'Claude Code', backendId: 'claude' },
    { cmd: 'hermes', args: ['--acp'], name: 'Hermes', backendId: 'hermes' },
    { cmd: 'codex', args: ['--acp'], name: 'Codex', backendId: 'codex' },
  ],
}));

const originalPlatform = process.platform;

async function freshDetector() {
  vi.resetModules();
  const mod = await import('@process/agent/acp/AcpDetector');
  return mod.acpDetector;
}

/** Build a safeExecFile mock: `where <cmd>` resolves for cmds in winPath. */
function whereResolvesFor(winPath: Set<string>, wslFound: string[] = []) {
  return (file: string, args: string[]): Promise<{ stdout: string; stderr: string }> => {
    if (file === 'where') {
      const cmd = args[0];
      if (winPath.has(cmd)) return Promise.resolve({ stdout: `C:\\\\bin\\\\${cmd}.exe`, stderr: '' });
      return Promise.reject(new Error(`'where' could not find ${cmd}`));
    }
    if (file === 'powershell') {
      // No PowerShell-only installs in these tests.
      return Promise.reject(new Error('Get-Command failed'));
    }
    if (file === 'wsl.exe') {
      // args: ['-e', 'bash', '-lc', script]. Emit the cmds present in WSL.
      return Promise.resolve({ stdout: wslFound.join('\n') + (wslFound.length ? '\n' : ''), stderr: '' });
    }
    return Promise.reject(new Error(`unexpected exec: ${file}`));
  };
}

describe('AcpDetector WSL fallback (#258)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(process, 'platform', { value: 'win32' });
  });

  afterEach(() => {
    Object.defineProperty(process, 'platform', { value: originalPlatform });
  });

  it('(a) reports a CLI found on the Windows PATH', async () => {
    safeExecFileMock.mockImplementation(whereResolvesFor(new Set(['claude'])));

    const detector = await freshDetector();
    const agents = await detector.detectBuiltinAgents();

    expect(agents.map((a) => a.backend)).toContain('claude');
    expect(agents.map((a) => a.backend)).not.toContain('hermes');
  });

  it('(b) reports a CLI not on Windows PATH but present inside WSL', async () => {
    // claude on Windows, hermes only in WSL.
    safeExecFileMock.mockImplementation(whereResolvesFor(new Set(['claude']), ['hermes']));

    const detector = await freshDetector();
    const agents = await detector.detectBuiltinAgents();

    const backends = agents.map((a) => a.backend);
    expect(backends).toContain('claude'); // Windows PATH
    expect(backends).toContain('hermes'); // WSL probe
    expect(backends).not.toContain('codex'); // neither

    // The WSL probe was invoked via wsl.exe -e bash -lc '<script>'.
    const wslCall = safeExecFileMock.mock.calls.find((c) => c[0] === 'wsl.exe');
    expect(wslCall).toBeDefined();
    expect(wslCall![1].slice(0, 3)).toEqual(['-e', 'bash', '-lc']);
    expect(wslCall![1][3]).toContain("command -v 'hermes'");
    // claude was already found on Windows, so it must NOT be re-probed in WSL.
    expect(wslCall![1][3]).not.toContain("command -v 'claude'");
  });

  it('(c) reports not-found and does not throw when WSL is unavailable', async () => {
    // Nothing on Windows PATH; wsl.exe itself rejects (WSL not installed).
    safeExecFileMock.mockImplementation((file: string, args: string[]) => {
      if (file === 'wsl.exe') return Promise.reject(new Error('wsl.exe not recognized'));
      if (file === 'where') return Promise.reject(new Error(`not found ${args[0]}`));
      return Promise.reject(new Error('Get-Command failed'));
    });

    const detector = await freshDetector();
    const agents = await detector.detectBuiltinAgents();

    expect(agents).toEqual([]); // none found, no throw
  });
});
