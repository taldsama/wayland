# Concierge — Session Handoff

**Date:** 2026-06-29 · **Branch:** `feat/concierge` · **Base:** `266d42e9e` (ferrox/main) ·
**Worktree:** `/private/tmp/wt-concierge` · **gh account:** FerroxLabs · **push remote:** `ferrox`

Read order for the next session: this file → `CONTRACT.md` → `CONCIERGE-SPEC.md`. The spec is the
contract; CONTRACT.md has exact signatures + file-ownership; this file is the live state + the plan
to finish the complete unit.

---

## 1. TL;DR — where we are

A "complete unit" = Concierge that **knows** (Phase 1) + **diagnoses** (Phase 2a) + **acts**
(Phase 2b). 

- **Phase 1 (knows)** — ✅ BUILT, AUDITED, REMEDIATED, GREEN.
- **Phase 2a (diagnoses, read-only)** — ✅ BUILT, REGISTERED, AUDITED, REMEDIATED, GREEN.
- **Phase 2b (acts, mutating config)** — ❌ NOT BUILT. Architecture LOCKED in `CONTRACT.md §2b`.
  This is the remaining work to make it a complete unit.
- **Phase 2c (remote access)** — ❌ NOT BUILT. Designed-by-dependency, optional/last (SPEC §2c).

**The work is UNCOMMITTED** in the worktree (55 changed files, all green). Nothing pushed, no PR.
Per Sean: finish 2b next session, then the WHOLE unit gets the full test/verify/cross-audit
treatment and ships as one complete, reviewable thing.

### Verification state (last run this session — all green)
| Gate | Result | Command |
|---|---|---|
| Typecheck | **exit 0** | `bun run typecheck` |
| Full unit suite | **11,505 passed / 0 failed** (8 skipped, pre-existing) | `bun run test` |
| Lint (new files) | **0 errors** (2 pre-existing warnings in untouched agentUtils paths) | `bunx oxlint <files>` |
| i18n | **passed** | `node scripts/check-i18n.js` (after `bun run i18n:types`) |
| AI signatures | **none** | — |

NOT yet run (do before PR): `prek run --from-ref origin/main --to-ref HEAD` (needs a commit first),
and the e2e suite (electron — environmental; the launchpad e2e fixtures were updated to 7 cards).

### To resume
```
cd /private/tmp/wt-concierge
gh auth switch --user FerroxLabs        # it drifts to TradeCanyon
bun install
bun run typecheck && bun run test       # confirm still green
```

---

## 2. What Phase 1 + 2a deliver (the design, locked)

Two lodestars (SPEC top): **Rory Sutherland** (solve the perceived problem — uncertainty — not the
literal one; defaults are the design; specificity = costly-to-fake trust) and Sean's **"it just
fucking works"** (on by default, never guesses about itself, tells the truth when something breaks).

The 7 locked decisions (SPEC "DESIGN DECISIONS"):
1. **Self-knowledge everywhere, paid for nowhere** — Concierge always carries the live manifest;
   every other assistant/backend gets it only on a capability-intent turn via per-turn retrieval.
2. **Concierge is the default front door** — pre-selected landing persona behind reversible setting
   `concierge.defaultPersona` (default ON); pinned first in launchpad + assistant list.
3. **Proactive live-state starter prompts** — "What can Wayland do?" panel keyed off connected
   providers / scheduled state / counts.
4. **Every answer ends in a door** — answer-first persona, one offer; Phase-2 bridge built into the
   answer format now.
5. **Diagnostics first** (2a) — highest trust, lowest risk, the honesty anchor.
6. **Security designed-in** — guarded in-process surface, existing confirmation flow, secrets
   redacted/keychain-only, no open loopback HTTP (the AionUI butler's flaw).
7. **Reviewable delivery** — Phase 1 / 2a / 2b each independently reviewable.

**AionUI butler prior art:** it's an ordinary built-in assistant (3 plain-language domains:
configure/diagnose/remote) whose brain lives in the closed **AionCore** backend via an
**unauthenticated localhost** control plane that returns API keys in **plaintext**. We copy the
*pattern*, fix the security by using in-process services + the existing consent flow.

---

## 3. Complete file inventory (this session)

### Phase 1 — NEW
- `src/process/services/capabilities/CapabilitiesManifest.ts` — `buildCapabilitiesManifest(opts?)`,
  token-bounded (`CAPABILITIES_MANIFEST_MAX_CHARS=2400`), cached on **provider identity** (not
  count), `invalidateCapabilitiesManifestCache()`, graceful degrade, `sanitizeToken()` hardening.
- `src/process/resources/assistant/concierge/concierge.md` (+ `.zh-CN.md`) — persona.
- `src/process/resources/skills-library/bodies/skills/productivity/concierge/SKILL.md` — how-to
  skill (`name: concierge`), registered in `index.json` (2105→2106 entries).
- `src/renderer/pages/guid/components/newChatStarter/WaylandCapabilitiesPanel.tsx` (+ `.module.css`)
  — live-state suggestion panel.
- `src/renderer/services/i18n/locales/*/concierge.json` — 12 locales (en-US + zh-CN translated;
  others en fallback). Keys: `panel.*`, `suggest.*` (the 4 dead keys card/pill/assistant.description
  were removed per audit).
- Tests: `tests/unit/process/services/capabilities/CapabilitiesManifest.test.ts`,
  `tests/unit/process/task/conciergeCapabilities.test.ts` (intent + gating + per-turn),
  `tests/unit/process/task/conciergeInjection.test.ts` (system-prompt injection presence — the
  acceptance-critical path), `tests/unit/renderer/guid/WaylandCapabilitiesPanel.dom.test.tsx`,
  `tests/unit/renderer/guid/conciergeDefaultPersona.dom.test.tsx`.

### Phase 1 — MODIFIED (single-owner edits)
- `src/process/task/agentUtils.ts` — `FirstMessageConfig.capabilitiesManifest`, exported
  `CAPABILITIES_MANIFEST_HEADER`, `isCapabilityIntent()` (noun-anchored), `resolveCapabilitiesManifest()`,
  `resolveTurnCapabilityAdvert()`, injection in the 3 assemblers, per-turn injection (survives the
  BM25 early-return gates).
- `src/process/task/{WCoreManager,GeminiAgentManager,AcpAgentManager}.ts` — wire the manifest at
  first-message (Concierge-only) + pass `assistantId`/`agentKey` to per-turn. **ACP also injects in
  the native-skills branch** (Claude Code/Codex) — audit fix.
- `src/common/config/presets/assistantPresets.ts` — `concierge` preset (first).
- `src/process/utils/initStorage.ts` — `concierge` in `enabledByDefault`.
- `src/common/config/storage.ts` — `'concierge.defaultPersona'?: boolean`.
- `src/renderer/pages/guid/{GuidPage.tsx, quickLaunchAnchors.ts, useGuidAgentSelection.ts,
  components/newChatStarter/launchpadCatalog.ts}` — mount panel, pin anchor, default-persona, sparkles icon.
- `src/common/config/i18n-config.json` — `concierge` module; `i18n-keys.d.ts` regenerated.

### Phase 2a — NEW
- `src/process/resources/builtinMcp/conciergeDiagServer.ts` — factory `createConciergeDiagServer(deps?)`,
  READ-ONLY tools (`overview/scheduledTasks/mcpHealth/providers/recentErrors`), **hardened `redact()`**
  (key-name + AWS + base64url + hex + prefixes). Reads on-disk only (no Electron/singletons/ipc).
- `src/process/resources/builtinMcp/conciergeDiagServerEntry.ts` — stdio MCP wrapper.
- `tests/unit/process/resources/builtinMcp/conciergeDiagServer.test.ts` (23 tests incl. 6 redaction
  regressions).

### Phase 2a — MODIFIED (registration)
- `src/process/resources/builtinMcp/constants.ts` — `BUILTIN_CONCIERGE_DIAG_*` + helpers.
- `src/process/utils/initStorage.ts` — `ensureBuiltinMcpServers()` seeds `concierge-diag` with env
  paths (`WAYLAND_CONFIG_PATH=cacheDir/wayland-config.txt`, `WAYLAND_CRON_DB`/`WAYLAND_PROVIDER_DB=getDataPath()/wayland.db`,
  `WAYLAND_LOG_DIR=getLogsDir()`).
- `scripts/build-mcp-servers.js` — 5th esbuild target.
- `installer/scripts/build-payload.mjs` — `REQUIRED_MCP`.
- `electron-builder.yml` — `asarUnpack` entry.
- `src/process/utils/mcpScriptDir.ts` — `MCP_STDIO_SCRIPT_NAMES` (+ test "four"→"five").

### Test fixtures fixed (regressions from the new anchor/preset/server)
- `tests/unit/renderer/guid/{LaunchpadBar,QuickLaunchRow}.dom.test.tsx`, `quickLaunchAnchors.test.ts`,
  `tests/e2e/specs/launchpad-customize.e2e.ts` (6→7 cards), mocks in
  `tests/unit/{AcpAgentManagerSkillInjection,WCoreManagerStartFailure}.test.ts`,
  `tests/unit/process/utils/mcpScriptDir.test.ts`.

---

## 4. Cross-audit results (this session) — all 19 fixed

A 6-dimension adversarial workflow (security/correctness/perf/gaps/tests/conventions) →
every finding verified against live code → 23 raw, **19 confirmed, all remediated**. Then the full
suite caught **2 more** completeness gaps the 2a-registration agent missed — also fixed.

HIGH (5): diagnostics `redact()` secret-format bypass (hardened + 6 tests) · `isCapabilityIntent`
fired on generic verbs (noun-anchored) · 3 CI-blocking test regressions (launchpad counts; 2 manager
mocks missing `resolveCapabilitiesManifest`, one hanging 10s).
MEDIUM (4): Concierge on native ACP got no manifest (fixed) · injection-presence tests added · 2a
registration completed · e2e card count.
LOW (7): ACP double-inject removed · missed phrasings added · cache staleness (key on provider
identity) · dead `agentKey` cache key dropped · 4 dead i18n keys removed · manifest token-sanitize.

**Conscious scope decisions (not bugs):** cache staleness is fixed via the cache KEY (busts on
provider/model change); explicit `invalidateCapabilitiesManifestCache()` wiring into the
provider-connect path is optional future hardening, not required. `agentKey` is kept as a documented
**reserved** option for future per-agent model curation (excluded from the cache key).

---

## 5. NEXT SESSION — build Phase 2b (the remaining piece of the complete unit)

**Goal:** Concierge can *do* config changes the user asks for in plain language — securely.
Architecture is LOCKED in `CONTRACT.md §2b`: **propose → confirm → apply, NO MCP subprocess.**
Mirror the existing, battle-tested **cron** flow. Secrets only ever touch the MAIN process.

### Why not an MCP tool: a stdio subprocess can't use Electron `safeStorage`, main singletons, or
`ipcBridge`. So config mutations go through a chat-tag the model emits, exactly like `[CRON_PROPOSE]`.

### The flow + reusable pieces (read these before building)
1. **Propose (agent → block):** new `[CONCIERGE_PROPOSE]` tag with
   `kind: 'provider_connect' | 'set_default_model' | 'add_mcp' | 'edit_assistant'` + fields.
   - Parser mirrors `src/process/task/CronCommandDetector.ts`.
   - Message creation + state machine (`pending|processing|accepted|cancelled`) mirrors
     `src/process/task/MessageMiddleware.ts` (new message type `concierge_propose`).
   - The `concierge` SKILL.md documents the block format so the model emits it from natural language
     (works native + ACP, same as cron). **Add the block spec to the SKILL.md.**
2. **Confirm card (renderer):** new `ConciergeConfigCard.tsx` mirroring
   `src/renderer/pages/conversation/Messages/components/CronProposeCard.tsx`. Shows a **diff/summary**;
   secrets rendered **last-4 only**. Yes/Edit/Cancel → `ipcBridge.conciergeConfig.confirmProposal.invoke(...)`.
3. **Apply (MAIN bridge):** new `src/process/bridge/conciergeConfigBridge.ts` mirroring
   `src/process/bridge/cronBridge.ts` (DB lookup + auth + status guard + atomic `processing` + emit).
   On `accept`, call the REAL write paths **in main** (confirmed during research):
   - `provider_connect` → `connectModelRegistryProvider(providerId, creds)` (from
     `@process/providers/ipc/modelRegistryIpc`; encrypts via safeStorage in main).
   - `set_default_model` → `ProcessConfig.set('wcore.defaultModel'|'gemini.defaultModel', {id,useModel,accountId})`
     (MAIN → **ProcessConfig**, NOT ConfigStorage).
   - `add_mcp` → read+write `ProcessConfig.get/set('mcp.config', IMcpServer[])`.
   - `edit_assistant` → `writeAssistantResource('rules', assistantId, content, locale, ...)` (fsBridge).
   - **After apply: verify + report the result** (the one good AionUI UX instinct).

### Security requirements (HARD — from SPEC §2b)
- Every mutation goes through the confirm card; never apply without `accept`. No bypass path.
- Never echo secrets in plaintext (input field last-4; store encrypted via existing keychain path).
- In-process/IPC only — no open loopback HTTP.
- Destructive/overwrite → show before/after diff in the card.

### Shared files 2b will touch (single-owner at integration): `MessageMiddleware.ts`,
`CronCommandDetector.ts` (or a sibling detector), `src/common/adapter/ipcBridge.ts` (+ `src/preload.ts`),
the renderer message renderer that maps message type → card. NEW: `conciergeConfigBridge.ts`,
`ConciergeConfigCard.tsx`, proposal types, tests.

### Tests 2b must add
- Parser truth table (each `kind`, malformed blocks).
- Bridge apply per kind (mock the write paths); **a mutation without `accept` never calls a write path**.
- Secret redaction in the card payload (last-4 only).
- Cross-backend parse (native + ACP).

### Build discipline (Sean's standard)
Build 2b → run **a fresh adversarial cross-audit** (reuse the workflow at
`.../workflows/scripts/concierge-cross-audit-wf_8a4fe712-cea.js` — update SCOPE for 2b) → fix every
verified finding → **full `bun run test` + `bun run typecheck` green** → then commit the COMPLETE unit
(1 + 2a + 2b) and open the PR via the `oss-pr` skill (base `ferrox/main`, remote `ferrox`, gh
FerroxLabs, no AI signatures). Optionally live-test in the running app (Sean's standing rule):
`WAYLAND_DEV_PROFILE=Concierge WAYLAND_CDP_PORT=9250 bun run start`.

---

## 6. Watch items / notes for next session
- Re-run `gh auth switch --user FerroxLabs` — it drifts to TradeCanyon.
- 2a `concierge-diag` is seeded **enabled by default** (mirrors search-skills; read-only, only runs
  when an agent invokes it). Confirm that's intended vs gating it behind the Concierge assistant.
- `WAYLAND_PROVIDER_DB` and `WAYLAND_CRON_DB` both point at `wayland.db` (correct today — shared DB).
- Existing installs get the `concierge-diag` entry added on next `ensureBuiltinMcpServers()`; worth a
  live smoke that the subprocess spawns and `wayland_concierge_diag` returns redacted output.
- The mockup (`scratchpad/concierge-mockup.html`) shows the intended UX across Home/Knows/Hands —
  reference for 2b's confirm-card feel.
- `AGENTS.md` / `CLAUDE.md` modifications in the diff are the IJFW linter, not our work — leave them.
- Phase 1 acceptance (SPEC §1.7) to live-verify when convenient: "what can you do?" in a native AND
  an ACP chat returns real counts/providers; "how do I connect a provider / schedule a task?" returns
  correct steps + one offer.
