# .agents — Knowledge base for AI agents

Technical docs about the Luna system, written for AI agents working on this repo.
Everything here is verified against the code; if code and doc disagree, **the code wins —
and the doc must be fixed**.

## Reading order for a new agent

1. **`architecture.md`** — what Luna is, pipelines (web + Telegram), components,
   tool-call detection, dedup, modes, compaction, multi-provider.
2. **`conventions.md`** — monorepo layout, commands, env vars, tests, git rules, PM2
   process names.
3. **`packages/kernel/.brain/status.md`** + **`changelog.md`** — current state and recent
   history (also `decisions.md` for the "why", `bugs.md` for known breakage).
4. **`prompts.md`** — before touching ANY prompt file: active prompt, output contract,
   the Luna-Mirror frame, dead variants, known tensions.
5. **`runbooks/`** — when something breaks:
   - `login-kimi-caiu.md` — Kimi login lost / JWT expired
   - `telegram-409-conflict.md` — duplicate Telegram pollers
   - `compactacao-travou.md` — manual compaction stuck/failed

## Branch rule

**All agent work must be committed and pushed to the `Luna-Abner` branch, not `main`.**
- Before editing: `git checkout Luna-Abner`.
- Push target: `git push origin Luna-Abner`.
- Do not merge to `main` unless the owner explicitly asks for it.

## Golden rule

**Whenever you change system behavior, update the corresponding doc in the same commit.**
Docs that drift from the code are worse than no docs — the repo's old pre-monorepo docs
are proof (they still reference paths that no longer exist).

## Language

`.agents/` and `.brain/` are in English (for agents). Human-facing guides live elsewhere
in the owner's language.
