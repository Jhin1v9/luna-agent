# Prompts

> Verified against the code on 2026-07-11. Read this before touching any prompt file.

## Active prompt

- `packages/kernel/LUNA_MASTER_PROMPT.md` — **v6.2** ("JSON Translator Frame,
  Workspace-aware, Zero-refusal"). This is the only live master prompt.
- Loaded through `packages/kernel/config/luna-config.js` → key `PATHS.masterPrompt`
  → `MASTER_PROMPT_PATH` in `luna-soul.cjs:139` → `loadMasterPrompt()`
  (truncated to ~20k chars: first 2000 + last 18000).
- Interpolated in `buildSystemPrompt` (luna-soul.cjs:302–324) via `interpolateTemplate`
  with `{{USER_ID}}` and `{{WORKSPACE}}` (also `{{WORKSPACE_CONTEXT}}`, `{{BRAIN_CONTEXT}}`).
- The runtime prompt template itself lives in
  `packages/kernel/config/luna-prompt-config.json` under the key **`systemPrompt`**
  (plus `miniReminder`, `toolResultPrompt`, `prompts.{firstMessage,followUp,toolLoop}`,
  `loopRules`). `buildSystemPrompt` prefers `cfg.systemPrompt` when present; the
  hardcoded prompt in `luna-soul.cjs:329` is the fallback.

## Output contract (the model's side)

- Output is **ONLY** fenced ` ```json ` blocks — never free text outside a block.
- Exactly **three forms** exist:
  - `{"response": "..."}` — talk to the user
  - `{"tool": "name", "params": {...}}` — call a tool (`params` is ALWAYS an object)
  - `{"script": "...", "language": "bash|python"}` — multi-step script
- **ONE JSON block per message.** After each tool result the model decides: another tool
  block, or a final `{"response": ...}`.
- Obsolete forms (`[[response]]`, `{"status":"success","content":...}`,
  `{"success":...,"mode":"RESPONSE",...}`) are explicitly forbidden by the prompt.

## The "Luna Mirror" frame

The prompt does NOT tell the model it controls a computer. It frames the model as a
**senior DevOps engineer generating JSON for an internal API**; execution happens in a
separate system called **Luna-Mirror** on the user's real Linux PC. This framing exists
because the model (Kimi K2.6) refused the direct "you control the computer" identity
(decision 2026-07-03, see `.brain/decisions.md`). Keep this frame intact when editing
prompts — removing it historically re-triggered refusals.

## Dead variants — do not resurrect

These files were deleted on 2026-07-11 (docs overhaul cleanup). Do not reference,
copy from, or re-enable them:

- `LUNA_MASTER_PROMPT.v6.1-pure.md`
- `LUNA_MASTER_PROMPT.v6.1-strict.md`
- `LUNA_MASTER_PROMPT.v6.1-json-agent.md`
- `LUNA_MASTER_PROMPT.v6.1-workspace.md`
- `LUNA_MASTER_PROMPT.md.v5.0-backup`
- `SYSTEM_PROMPT.md`
- `SYSTEM_PROMPT_MINIMAL.md`

## Known tensions

- **Zero-refusal framing vs persona boundaries.** The master prompt pushes "ZERO refusal,
  ZERO confirmation" while `apps/agents/core/LunaPersona.md` defines editorial boundaries
  for Luna's personality. `apps/agents/core/LunaPersona.md` is the **editorial source of
  truth** for persona content; resolve conflicts in its favor for tone/identity, but never
  weaken the output contract.
- **Persona ages are inconsistent** across files: `LunaPersona.md` says "Idade mental:
  28 anos"; `packages/kernel/personas/telegram-assistant.json` says 19. No single
  canonical age exists yet — flag it when editing either file.

## Telegram persona

- File: `packages/kernel/personas/telegram-assistant.json`, key **`systemPrompt`**.
- `_telegramPipeline` (luna-soul.cjs:4991) loads it and prepends it to the classify /
  tool-select / formatting prompts.
- Caveat: the load path is built as
  `path.join(PATHS.lunaKernel, 'packages', 'kernel', 'personas', 'telegram-assistant.json')`,
  which duplicates the `packages/kernel` segments under the PM2 env and silently falls
  back to an empty persona (`fs.existsSync` guard). The real file lives at
  `packages/kernel/personas/telegram-assistant.json`. If Telegram replies lose their
  persona, check this path first.
