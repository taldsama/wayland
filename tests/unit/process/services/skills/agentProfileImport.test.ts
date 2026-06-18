/**
 * @license
 * Copyright 2026 Ferrox Labs
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi } from 'vitest';
import {
  buildAssistantFromSkillMd,
  importAgentProfile,
  type AgentProfileImportIo,
} from '@process/services/skills/agentProfileImport';
import type { AcpBackendConfig } from '@/common/types/acpTypes';

const SKILL_MD = `---
name: Research Buddy
description: A diligent research assistant
type: agent-profile
avatar: lucide:Telescope
main-agent: codex
---

You are Research Buddy. Always cite your sources.`;

describe('buildAssistantFromSkillMd', () => {
  it('maps frontmatter + body into an AcpBackendConfig', () => {
    const config = buildAssistantFromSkillMd(
      { name: 'Research Buddy', description: 'A diligent research assistant' },
      SKILL_MD,
      1700000000000
    );

    expect(config.id).toBe('imported-research-buddy-1700000000000');
    expect(config.name).toBe('Research Buddy');
    expect(config.description).toBe('A diligent research assistant');
    expect(config.avatar).toBe('lucide:Telescope');
    expect(config.presetAgentType).toBe('codex');
    expect(config.isPreset).toBe(true);
    expect(config.isBuiltin).toBe(false);
    expect(config.kind).toBe('specialist');
    expect(config.enabled).toBe(true);
    // Body after the frontmatter becomes the system prompt (context).
    expect(config.context).toBe('You are Research Buddy. Always cite your sources.');
  });

  it('applies defaults when avatar and main-agent are omitted', () => {
    const body = `---
name: Bare Bot
---

Be helpful.`;
    const config = buildAssistantFromSkillMd({ name: 'Bare Bot' }, body, 42);

    expect(config.id).toBe('imported-bare-bot-42');
    expect(config.avatar).toBe('lucide:Bot');
    expect(config.presetAgentType).toBe('claude');
    expect(config.description).toBe('');
    expect(config.context).toBe('Be helpful.');
  });

  it('reads presetAgentType as an alias for main-agent', () => {
    const body = `---
name: Alias Bot
presetAgentType: qwen
---

x`;
    expect(buildAssistantFromSkillMd({ name: 'Alias Bot' }, body, 1).presetAgentType).toBe('qwen');
  });
});

describe('importAgentProfile', () => {
  function makeIo(initial: AcpBackendConfig[] = []): {
    io: AgentProfileImportIo;
    store: AcpBackendConfig[];
    writeRule: ReturnType<typeof vi.fn>;
  } {
    const store = [...initial];
    const writeRule = vi.fn(async () => {});
    const io: AgentProfileImportIo = {
      getAssistants: vi.fn(async () => store),
      setAssistants: vi.fn(async (next: AcpBackendConfig[]) => {
        store.length = 0;
        store.push(...next);
      }),
      writeRule,
      now: () => 99,
    };
    return { io, store, writeRule };
  }

  it('appends the assistant to the store and writes its rule file', async () => {
    const { io, store, writeRule } = makeIo();

    const result = await importAgentProfile(
      { name: 'Research Buddy', description: 'desc' },
      SKILL_MD,
      io
    );

    expect(result).toEqual({ id: 'imported-research-buddy-99', name: 'Research Buddy' });
    expect(store).toHaveLength(1);
    expect(store[0].id).toBe('imported-research-buddy-99');
    expect(writeRule).toHaveBeenCalledWith(
      'imported-research-buddy-99',
      'You are Research Buddy. Always cite your sources.'
    );
  });

  it('skips (returns null) when an assistant with the same id already exists', async () => {
    const existing: AcpBackendConfig = { id: 'imported-research-buddy-99', name: 'Research Buddy' };
    const { io, store, writeRule } = makeIo([existing]);

    const result = await importAgentProfile({ name: 'Research Buddy' }, SKILL_MD, io);

    expect(result).toBeNull();
    expect(store).toHaveLength(1);
    expect(writeRule).not.toHaveBeenCalled();
  });
});
