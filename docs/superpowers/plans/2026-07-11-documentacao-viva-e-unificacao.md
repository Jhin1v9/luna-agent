# Documentação Viva e Unificação da Luna — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar toda a documentação da Luna em docs de agente (`.agents/`, inglês) e guia humano (espanhol), deletar lixo obsoleto, e criar o sistema de memória viva (`.brain` + hook pós-commit) que impede regressão entre sessões.

**Architecture:** Três camadas de documentação por público: `.agents/` (técnico, inglês, para agentes de IA), `docs/guia-humano.md` (espanhol, para humanos), `packages/kernel/.brain/` (memória viva em inglês, alimentada por hook pós-commit + script `luna-brain-sync`). Tudo dentro do repo, propagando pros 3 PCs via sync cron existente.

**Tech Stack:** Markdown, bash (hook + script), git. Nenhuma dependência nova.

**Spec:** `docs/superpowers/specs/2026-07-11-documentacao-viva-e-unificacao-design.md`

**Convenções de execução:**
- Todos os comandos rodam a partir de `~/.luna-kernel` (cd implícito)
- Commits seguem o padrão existente do repo (`docs:`, `chore:`, `feat:`)
- Nenhum arquivo é deletado sem que seu conteúdo útil tenha sido extraído antes
- Deleções de arquivos NÃO rastreados exigem checkpoint com o usuário (Task 5)

---

### Task 1: Consolidar `.brain/` — bugs, decisions, status

O `.brain` já existe em `packages/kernel/.brain/` com 4 arquivos desatualizados. Esta task o transforma na fonte da verdade do estado atual.

**Files:**
- Modify: `packages/kernel/.brain/bugs.md`
- Modify: `packages/kernel/.brain/decisions.md`
- Modify: `packages/kernel/.brain/status.md`
- Read (fonte): `AUDITORIA_v10.8.md`, `packages/kernel/.brain/auditoria-contexto-tools-portabilidade.md`, `packages/kernel/CHANGELOG_MULTIPROVIDERS.md`

- [ ] **Step 1: Reescrever `bugs.md` em inglês — estrutura limpa, SEM conteúdo de auditorias**

DECISÃO DO USUÁRIO (2026-07-11): as auditorias antigas (v10.8, v10.32) não são fonte confiável — não há como saber o que ainda é real. Bugs serão fornecidos manualmente pelo dono depois. O arquivo fica só com a estrutura:

```markdown
# Bugs

> Living document. Updated by luna-brain-sync and by the owner manually.
> Old audit documents (v10.8, v10.32) are NOT a reliable source — verify against code before listing anything here.

## Open

(none registered yet — the owner will provide the current bug list manually)

## Resolved

(none tracked yet — resolved bugs moved here by luna-brain-sync reference the fixing commit)
```

- [ ] **Step 2: Reescrever `decisions.md` em inglês**

Manter as 9 decisões do Modo Detetive (já no arquivo) + adicionar com data:
- 2026-06-08: Lazy Connect (server starts without Chrome) — v10.0 refactor
- 2026-06-26→29: Multi-provider via `provider-configs/*.json` (Kimi + DeepSeek); agent/swarm modes Kimi-only
- 2026-07-03: Compaction 100% manual (removed 3 automatic triggers after bad experience)
- 2026-07-03: "Luna Mirror" identity frame (Kimi K2.6 refused the "you control the computer" identity)
- 2026-07-04: Monorepo pnpm merge (kernel → `packages/kernel`, dashboard → `apps/dashboard`)
- 2026-07-04: Telegram bot NOT distributed to end-user installs (owner's PC only)
- 2026-07-05: Telegram dedicated pipeline (classify intent → dashboard tool registry → persona formatting)
- 2026-07-11: Docs split by audience — `.agents/` + `.brain/` in English, human guide in Spanish

- [ ] **Step 3: Reescrever `status.md` em inglês**

Conteúdo obrigatório (estado presente, sem histórico):
- What Luna is in one paragraph (mirror agent over Kimi/DeepSeek web)
- What's working: web chat (:3458), Telegram pipeline, manual compaction, plan mode, multi-provider, audit log/trash (commit c51561e)
- Known broken/risky: link to bugs.md Open section
- Current focus: documentation unification + living memory (this plan)
- How to run: `pm2 status` expects 5 processes (luna-server :3458, nexo-dashboard :3456, telegram-bot, luna-vite :5173, luna-health-watchdog)

- [ ] **Step 4: Verificar que os arquivos refletem a realidade**

Run: `grep -c "TODO\|TBD" packages/kernel/.brain/*.md`
Expected: `0` em todos (ou só em checkboxes intencionais de bugs abertos)

- [ ] **Step 5: Commit**

```bash
git add packages/kernel/.brain/
git commit -m "docs(brain): consolidate bugs, decisions and status in English"
```

---

### Task 2: Changelog retroativo do `.brain`

Criar `changelog.md` com a linha do tempo dos últimos ~25 commits, para que um agente novo entenda a evolução recente.

**Files:**
- Create: `packages/kernel/.brain/changelog.md`

- [ ] **Step 1: Gerar a lista de commits**

Run: `git log --oneline -25 --format="%h %ad %s" --date=short`
Expected: lista de 25 commits (ou menos se o repo tiver menos)

- [ ] **Step 2: Escrever `changelog.md` em inglês**

Formato obrigatório (mais novo no topo, uma linha por commit):

```markdown
# Changelog

> Living document. One entry per commit, newest first. Maintained by luna-brain-sync.

- [2026-07-06 c51561e] feat(dashboard): audit log, trash and undo/restore via Telegram
- [2026-07-11 4bbd29c] docs: spec - living documentation and unification (.agents + .brain + human guide)
...
```

Para cada commit do `git log`, escrever uma linha `- [YYYY-MM-DD hash] subject — uma frase do que mudou de verdade (ler o diff com `git show <hash> --stat` quando a mensagem for ambígua)`.

- [ ] **Step 3: Commit**

```bash
git add packages/kernel/.brain/changelog.md
git commit -m "docs(brain): add retroactive changelog"
```

---

### Task 3: Criar `.agents/` — docs para agentes (inglês)

**Files:**
- Create: `.agents/README.md`
- Create: `.agents/architecture.md`
- Create: `.agents/conventions.md`
- Create: `.agents/prompts.md`
- Create: `.agents/runbooks/login-kimi-caiu.md`
- Create: `.agents/runbooks/telegram-409-conflict.md`
- Create: `.agents/runbooks/compactacao-travou.md`

Fontes de verdade (ler antes de escrever): `packages/kernel/luna-soul.cjs`, `packages/kernel/kimi-bridge.cjs`, `packages/kernel/config/luna-config.js`, `packages/kernel/telegram-luna-adapter.cjs`, `packages/kernel/dashboard-tool-registry.cjs`, `packages/kernel/COOKIES_KIMI.md`, `README.md` raiz, `pm2-ecosystem.config.js`. Não copiar docs antigos cegamente — verificar contra o código quando houver dúvida.

- [ ] **Step 1: `.agents/architecture.md`**

Seções obrigatórias:
- **What Luna is**: mirror agent — reasoning happens in Kimi/DeepSeek web (real Chrome, CDP :9222), Luna translates JSON tool blocks into real Linux actions
- **Pipeline diagram** (web): User → Luna Web (Svelte, :3458) → `luna-server.js` → `luna-soul.cjs::processMessageStream` → `kimi-bridge.cjs` (Playwright/CDP) → kimi.com → JSON tool blocks → `luna-tools.cjs` → result back to Kimi → loop
- **Telegram pipeline**: adapter → `channel: 'telegram'` → `_telegramPipeline` (classify intent → `_selectDashboardTool` from `dashboard-tool-registry.cjs` → execute `dashboard*` tools only → persona formatting). Local tools (shell/file/git) are rejected on this channel
- **Key components table**: file → responsibility (luna-soul.cjs, kimi-bridge.cjs + bridge-libs/, luna-tools.cjs, luna-tool-guard.cjs, luna-code-validator.cjs, luna-chat-routes.js, telegram-luna-adapter.cjs, dashboard-tool-registry.cjs, luna-extension/, provider-configs/)
- **Detection of tool calls**: Chrome extension (MAIN world MutationObserver, `window.__lunaEventQueue`) primary; Playwright DOM mirror fallback
- **Dedup**: 4 layers (emittedActionCodes per stream, executedDomActionHashes per loop, _executedActionCache global TTL 5min, idempotency pre-check for createLead/createTask)
- **Modes**: instant/thinking/agent/swarm; agent/swarm are Kimi-only
- **Compaction**: 100% manual, button → `POST /api/luna/compact` → `_compactContext` (summary → newChat → `sendMessageNoWait` → capture URL → clear local context; invariant: local context only cleared after new thread confirmed)
- **Multi-provider**: `provider-configs/*.json`; cookies/localStorage per provider in `cookies/<provider>-master-*`

- [ ] **Step 2: `.agents/conventions.md`**

Seções obrigatórias:
- Monorepo layout (`packages/kernel` = @luna/kernel, `apps/dashboard` = @luna/dashboard), pnpm workspaces
- Prereqs: Node ≥22, pnpm 11.9 via corepack, Chrome, PM2
- Commands: `corepack pnpm install`, `corepack pnpm build`, `corepack pnpm dev:kernel`, `corepack pnpm dev:dashboard`, `pm2 start pm2-ecosystem.config.js`
- Code style: `.cjs` for kernel scripts, Express routes in `luna-chat-routes.js`, Svelte 4 + Vite frontend
- Env vars: `TELEGRAM_BOT_TOKEN`, `INTERNAL_API_TOKEN`, `JWT_SECRET`, `LUNA_PORT`, `LUNA_KERNEL_DIR` — `.env` at repo root (source of truth)
- Regression test example that exists: `node tests/url-landing.test.cjs` (verificar que o path existe antes de documentar; se não existir, citar o teste real equivalente)
- Git: main branch, only Jhin pushes, 3-PC sync via cron every 5min (`luna-sync.sh`)

- [ ] **Step 3: `.agents/prompts.md`**

Seções obrigatórias:
- Active prompt: `LUNA_MASTER_PROMPT.md` (v6.2), loaded via `packages/kernel/config/luna-config.js` → `masterPrompt`, interpolated with `{{USER_ID}}`/`{{WORKSPACE}}` in `luna-soul.cjs:139/318`
- Output contract: ONLY ` ```json ` blocks; three shapes: `{"response"}`, `{"tool", "params": {...}}`, `{"script"}`; ONE JSON per message; `params` always object
- "Luna Mirror" frame: Kimi is told it is Kimi K2.6 used through an agent named LUNA; LUNA executes on real Linux
- Dead variants (deleted in Task 5): v6.1 pure/strict/json-agent/workspace, SYSTEM_PROMPT.md, SYSTEM_PROMPT_MINIMAL.md — do not resurrect
- Known tension: zero-refusal framing vs LunaPersona.md boundaries; persona ages inconsistent (18/19/28) — LunaPersona.md in `apps/agents/core/` is editorial source of truth
- Telegram persona: `telegram-assistant.json` (verify exact path before documenting)

- [ ] **Step 4: Runbooks (3 arquivos)**

`login-kimi-caiu.md`: symptoms (login screen in kimi.com tab, JWT expired), fix steps: (1) manual login in the isolated Chrome on CDP :9222 (check `http://localhost:9222/json`), system saves cookies within 5min; (2) restore from `kimi-cookies.json` backup; (3) export from personal Chrome to `kimi-cookies.manual.json` + restart backend. Warning: NEVER `Ctrl+Shift+R` the Kimi tab (discards login). Keep the isolated Chrome always open.

`telegram-409-conflict.md`: cause = multiple polling instances on same token. Fix: `pm2 delete telegram-bot`, kill orphan `telegram-luna-adapter` processes, `pm2 restart telegram-bot` (verify exact pm2 name in `pm2-ecosystem.config.js`). Note: bot runs only on owner's PC by design.

`compactacao-travou.md`: flow and invariants (summary → newChat → checkpoint via `sendMessageNoWait` → capture URL → clear local). If it fails: local context is preserved by design, retry. Known causes: `NEW_CHAT_FAILED` (trailing slash — fixed via `normalizeBaseUrl`), Lexical editor not filled (`_fillContentEditable`), login lost / Chinese locale (modeUrls force `/en?chat_enter_method=shortcut`). Verification: `node tests/url-landing.test.cjs` (verify path exists; adjust if not).

- [ ] **Step 5: `.agents/README.md`**

Mapa curto (< 60 linhas): ordem de leitura para agente novo — 1) `architecture.md`, 2) `conventions.md`, 3) `.brain/status.md` + `.brain/changelog.md`, 4) `prompts.md` antes de mexer em prompts, 5) runbooks quando algo quebra. Regra de ouro: **atualizar o doc correspondente sempre que mudar comportamento do sistema**.

- [ ] **Step 6: Commit**

```bash
git add .agents/
git commit -m "docs(agents): add .agents knowledge base (architecture, conventions, prompts, runbooks)"
```

---

### Task 4: `docs/guia-humano.md` — guia humano em espanhol

**Files:**
- Create: `docs/guia-humano.md`

Fontes: `docs/HUMAN-GUIDE.md`, `packages/kernel/SYNC_GUIDE.md`, `packages/kernel/COOKIES_KIMI.md`, `README.md` raiz. Corrigir TODAS as referências a paths pré-monorepo (`~/NEXO_DASHBOARD_PRO`, `config-server.cjs`) para o layout atual.

- [ ] **Step 1: Escrever o guia em espanhol**

Seções obrigatórias:
1. **Qué es Luna** — párrafo simples, sin jerga
2. **Instalación** — one-command: `bash <(curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-kernel/main/install.sh)` + requisitos (Node 22+, Chrome, PM2)
3. **Encender y apagar** — comandos `luna` / `dashboard` en `~/.local/bin`, `pm2 stop all`, `pm2 status` (5 procesos esperados: luna-server :3458, nexo-dashboard :3456, telegram-bot, luna-vite :5173, luna-health-watchdog)
4. **Uso diario** — web (localhost:3458), Telegram (@lunanexobot, `/kimi on`), login manual en Kimi la primera vez
5. **Login de Kimi** — por qué hay que hacerlo manual, Chrome aislado que nunca se cierra, qué hacer si pide login otra vez
6. **Sincronización entre los 3 PCs** — Jhin pushea, Pai y Nonoke pullean vía cron cada 5 min (`luna-sync.sh`); regla de oro: solo Jhin hace push
7. **Actualización tras git pull** — `corepack pnpm install && corepack pnpm build && pm2 restart all && pm2 save`
8. **Problemas comunes** — puerto 3458 ocupado (`kill -9 $(lsof -ti:3458)`), MODULE_NOT_FOUND (`corepack pnpm install`), Luna no conecta con Kimi (verificar `http://localhost:9222/json`)
9. **Dónde está cada cosa** — mapa de carpetas del monorepo

- [ ] **Step 2: Revisão de precisão**

Verificar que todo comando do guia funciona no sistema atual:
Run: `pm2 list` (confirmar nomes dos processos) e `ls ~/.local/bin/luna`
Expected: nomes batem com o que o guia documenta; corrigir o que divergir

- [ ] **Step 3: Commit**

```bash
git add docs/guia-humano.md
git commit -m "docs: add unified human guide in Spanish"
```

---

### Task 5: Deletar lixo obsoleto

**Files:** deleções via `git rm` (rastreados) + lista de não-rastreados para aprovação

- [ ] **Step 1: Deletar prompts mortos e docs contraditórios (rastreados)**

Antes de cada `git rm`, confirmar que o conteúdo útil já está em `.agents/` ou `.brain/` (Tasks 1-3).

```bash
git rm packages/kernel/LUNA_MASTER_PROMPT.v6.1-json-agent.md \
       packages/kernel/LUNA_MASTER_PROMPT.v6.1-pure.md \
       packages/kernel/LUNA_MASTER_PROMPT.v6.1-strict.md \
       packages/kernel/LUNA_MASTER_PROMPT.v6.1-workspace.md \
       packages/kernel/SYSTEM_PROMPT.md \
       packages/kernel/SYSTEM_PROMPT_MINIMAL.md \
       packages/kernel/KIMI.md \
       packages/kernel/COOKIES_KIMI.md \
       packages/kernel/SYNC_GUIDE.md \
       packages/kernel/CHANGELOG_MULTIPROVIDERS.md \
       docs/HUMAN-GUIDE.md \
       packages/kernel/.telegram-group-ref.md \
       packages/kernel/plans/web-mqayj50x-p2yq.md \
       packages/kernel/plans/web-mqtigdf7-qk32.md \
       packages/kernel/plans/web-mqtjbada-ogey.md
git rm -r packages/kernel/luna-installer/
```

Notas:
- `KIMI.md` (Luna Web 8.4), `COOKIES_KIMI.md`, `SYNC_GUIDE.md`: conteúdo absorvido em `.agents/` e `guia-humano.md`
- `CHANGELOG_MULTIPROVIDERS.md`: absorvido em `.agents/architecture.md` + `decisions.md`
- `.telegram-group-ref.md`: mover o CHAT_ID para `.agents/runbooks/telegram-409-conflict.md` ou `conventions.md` ANTES de deletar
- `luna-installer/` (geração antiga): substituída pelo installer da raiz; verificar que nenhum script em `scripts/` ou PM2 referencia esse path antes de deletar (`grep -r "luna-installer" --include="*.cjs" --include="*.js" --include="*.sh" packages/ apps/ scripts/`)
- Specs/plans antigos em `docs/superpowers/` e `packages/kernel/docs/superpowers/`: manter (são histórico de design do fluxo superpowers, pequenos e referenciáveis). Exceção: `packages/kernel/docs/LUNA-MANUAL-COMPACTACAO-MANUAL.md` — conteúdo absorvido no runbook; deletar com `git rm`

- [ ] **Step 2: Verificar que nada quebrou**

Run: `grep -rn "SYSTEM_PROMPT\|v6.1\|luna-installer\|KIMI.md\|COOKIES_KIMI" packages/kernel/*.cjs packages/kernel/config/ apps/dashboard/*.js | grep -v node_modules`
Expected: zero referências a arquivos deletados no código. Se houver referência viva (ex: `luna-soul.cjs` carregando SYSTEM_PROMPT_MINIMAL), NÃO deletar esse arquivo e reportar.

- [ ] **Step 3: Commit**

```bash
git commit -m "chore(docs): remove obsolete prompts and pre-monorepo docs"
```

- [ ] **Step 4: CHECKPOINT — listar não-rastreados para aprovação do usuário**

Run: `git status --porcelain | grep '^??'`
Apresentar ao usuário a lista exata dos candidatos a deleção permanente (esperados: `AUDITORIA_v10.8.md`, `backup-merge-inteligente-*`, `backup-src-*`, `apply-fix.js`, `current_session`, `session_index.json`, `packages/kernel/current_session`, `packages/kernel/session_index.json`, `packages/kernel/test_*.cjs`, `packages/data/`). **Aguardar aprovação explícita antes de apagar** — deleção é irreversível.

---

### Task 6: Hook pós-commit + `luna-brain-sync`

**Files:**
- Create: `.githooks/post-commit`
- Create: `scripts/luna-brain-sync.sh`
- Create: `scripts/luna-brain-sync-prompt.md`

- [ ] **Step 1: Criar o hook**

```bash
mkdir -p .githooks
cat > .githooks/post-commit <<'EOF'
#!/bin/bash
# Luna living-memory hook: queue the commit hash for luna-brain-sync.
# Must be instant — never blocks the commit.
REPO_ROOT="$(git rev-parse --show-toplevel)"
PENDING="$REPO_ROOT/packages/kernel/.brain/.pending-commits"
git rev-parse HEAD >> "$PENDING" 2>/dev/null || true
EOF
chmod +x .githooks/post-commit
git config core.hooksPath .githooks
```

- [ ] **Step 2: Testar o hook**

```bash
git commit --allow-empty -m "test: hook check"
cat packages/kernel/.brain/.pending-commits
```
Expected: o hash do commit vazio aparece no arquivo. Depois limpar: `git reset --soft HEAD~1` e esvaziar o arquivo (`> packages/kernel/.brain/.pending-commits`).

- [ ] **Step 3: Criar `scripts/luna-brain-sync-prompt.md`**

Prompt fixo (em inglês) para o subagente anotador:

```markdown
You are the Luna brain-sync agent. You receive `git show` output for one or more commits to the luna-kernel repo.

Update files under packages/kernel/.brain/ following these rules:

1. changelog.md — prepend one line per commit: `- [YYYY-MM-DD short-hash] subject — one sentence on what actually changed`. Newest first. Never delete entries.
2. bugs.md — if a commit fixes a bug listed in Open, move it to Resolved with the commit hash. If a commit introduces a new known bug (only if explicit in the commit message), add it to Open.
3. decisions.md — append only if the commit makes an architectural/product decision (new component, removed feature, changed invariant). Include date, hash, motive. When in doubt, skip.
4. status.md — update "Current focus" and "What's working/broken" only if these commits changed the present state. No history here.
5. Write everything in English. Be terse. Do not invent information not present in the diff or commit message.

After editing, output a one-paragraph summary of what you changed.
```

- [ ] **Step 4: Criar `scripts/luna-brain-sync.sh`**

```bash
#!/bin/bash
# luna-brain-sync: drains .brain/.pending-commits and updates .brain via an AI subagent.
set -euo pipefail
REPO_ROOT="$(git -C "$(dirname "$0")/.." rev-parse --show-toplevel)"
BRAIN="$REPO_ROOT/packages/kernel/.brain"
PENDING="$BRAIN/.pending-commits"

if [ ! -s "$PENDING" ]; then
  echo "luna-brain-sync: nothing pending."
  exit 0
fi

HASHES=$(sort -u "$PENDING")
TMP_DIFF=$(mktemp)
trap 'rm -f "$TMP_DIFF"' EXIT

for h in $HASHES; do
  git -C "$REPO_ROOT" show --stat --format="COMMIT %h %ad %s" --date=short "$h" >> "$TMP_DIFF"
  echo "---" >> "$TMP_DIFF"
done

PROMPT=$(cat "$REPO_ROOT/scripts/luna-brain-sync-prompt.md")

# Kimi Code headless mode; adjust CLI name if kimi binary differs
if command -v kimi >/dev/null 2>&1; then
  (cd "$REPO_ROOT" && kimi --headless --prompt "$PROMPT

Commits to process:

$(cat "$TMP_DIFF")")
else
  echo "luna-brain-sync: 'kimi' CLI not found; pending commits kept in queue." >&2
  exit 1
fi

> "$PENDING"
echo "luna-brain-sync: done. Review .brain changes and commit them."
```

`chmod +x scripts/luna-brain-sync.sh`

Nota de implementação: verificar o nome real do binário do Kimi Code CLI (`which kimi`) e a flag de modo headless (`kimi --help`) ANTES de finalizar o script; ajustar o comando conforme a CLI real. Se headless não existir, fallback documentado: o script imprime o prompt + diffs em `~/.luna-brain-sync-last.md` para rodar manualmente numa sessão de agente.

- [ ] **Step 5: Criar atalho**

```bash
ln -sf ~/.luna-kernel/scripts/luna-brain-sync.sh ~/.local/bin/luna-brain-sync
```

- [ ] **Step 6: Teste end-to-end**

```bash
echo "# test" >> /tmp/luna-sync-test-note && git add -A packages/kernel/.brain/ 2>/dev/null || true
git commit --allow-empty -m "test: brain sync e2e"
luna-brain-sync
```
Expected: `.brain/changelog.md` ganha a entrada do commit de teste; `.pending-commits` fica vazio. Verificar o diff com `git diff packages/kernel/.brain/`. Depois reverter o commit de teste (`git reset --soft HEAD~1`) e limpar a entrada de teste do changelog.

- [ ] **Step 7: Commit**

```bash
git add .githooks/ scripts/
git commit -m "feat(brain): add post-commit hook and luna-brain-sync living-memory automation"
```

---

### Task 7: `AGENTS.md` na raiz + verificação final

**Files:**
- Create: `AGENTS.md` (raiz)

- [ ] **Step 1: Escrever `AGENTS.md` curto (< 40 linhas, inglês)**

Conteúdo:
- One-line: what Luna is
- Read order for agents: `.agents/README.md` → `.agents/architecture.md` → `packages/kernel/.brain/status.md` + `changelog.md`
- Golden rules: (1) update `.agents/` docs when behavior changes; (2) `.brain` is living memory — don't hand-edit changelog (luna-brain-sync owns it); (3) humans read `docs/guia-humano.md` (Spanish)
- Pointer to the spec: `docs/superpowers/specs/2026-07-11-documentacao-viva-e-unificacao-design.md`

- [ ] **Step 2: Verificação final completa**

Run:
```bash
git status --porcelain                    # esperado: só os não-rastreados aprovados pelo usuário
grep -c "TBD\|TODO" .agents/*.md docs/guia-humano.md   # esperado: 0
ls .agents/ .agents/runbooks/ packages/kernel/.brain/
```
Expected: working tree limpo de mudanças da tarefa, zero placeholders, toda a estrutura presente.

- [ ] **Step 3: Teste de aceitação (simular agente novo)**

Ler apenas `AGENTS.md` → `.agents/README.md` → `.brain/status.md` → `.brain/changelog.md` e verificar que respondem: o que é a Luna, o que funciona, o que está quebrado, o que mudou recentemente, como rodar. Se qualquer pergunta ficar sem resposta, corrigir o doc correspondente.

- [ ] **Step 4: Commit final**

```bash
git add AGENTS.md
git commit -m "docs: add root AGENTS.md entrypoint for agents"
```

---

## Self-Review (preenchido)

**Spec coverage:**
- Estrutura `.agents/` → Task 3 ✓
- Guia humano em espanhol → Task 4 ✓
- `.brain` consolidado + changelog → Tasks 1-2 ✓
- Deleção de lixo com extração prévia + checkpoint de não-rastreados → Task 5 ✓
- Hook pós-commit + luna-brain-sync + fila → Task 6 ✓
- AGENTS.md raiz → Task 7 ✓
- Propagação pros 3 PCs: automática via sync cron existente (documentado em conventions.md e guia-humano.md) ✓

**Placeholders:** nenhum — comandos e conteúdos obrigatórios explícitos por task.

**Consistency:** nomes de arquivos consistentes entre tasks; o CHAT_ID do `.telegram-group-ref.md` tem destino explícito antes da deleção; referência a teste `tests/url-landing.test.cjs` marcada para verificação de existência antes de documentar.
