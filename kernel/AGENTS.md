# AGENTS.md — entrypoint for AI agents

**Luna** is an autonomous "mirror" agent: reasoning happens inside the Kimi or DeepSeek
web apps, driven through a real Chrome via CDP by `kimi-bridge.cjs`; Luna (`luna-soul.cjs`)
parses the model's JSON tool blocks and executes them on a real Linux PC — files, shell,
git, dashboards — then feeds results back for the next turn.

## Read order (new agent)

1. `.agents/README.md` — index + golden rule
2. `.agents/architecture.md` — how the system actually works
3. `packages/kernel/.brain/status.md` + `changelog.md` — current state and recent history

## Golden rules

1. **Update `.agents/` docs whenever you change behavior** — same commit. Drifted docs
   are worse than none.
2. **`.brain` is living memory.** Do NOT hand-edit `changelog.md` — `luna-brain-sync`
   owns it. Update `status.md`, `decisions.md`, `bugs.md` when reality changes.
3. **Humans read `docs/guia-humano.md`** (Spanish). `.agents/` and `.brain/` are
   English-only, for agents.

## Design spec

`docs/superpowers/specs/2026-07-11-documentacao-viva-e-unificacao-design.md`
