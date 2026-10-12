# Luna Chat Reset, Shell Fixes e DeepSeek Tools — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans.

**Goal:** Resetar as conversas da Luna, garantir carregamento rápido das sessões, consertar `executeShell` para usar diretório próprio e `bash`, e fazer tools/actions funcionarem no DeepSeek.

**Architecture:** Manter a arquitetura existente (backend Express + PostgreSQL, frontend Svelte, bridge Playwright/CDP), corrigir apenas os pontos de fricção identificados: tmp dir, shell padrão, parser de tools no DeepSeek e limpeza de sessões antigas.

**Tech Stack:** Node.js, Svelte, Playwright, PostgreSQL, PM2.

---

## Task 1: Consertar `executeShell` (tmp + bash)

**Files:**
- Modify: `/home/jhin/.luna-kernel/luna-tools.cjs`

- [ ] **Step 1: Adicionar `LUNA_TMP_DIR`**
  No topo do arquivo, após os `require`, adicionar:
  ```js
  const LUNA_TMP_DIR = path.join(require('os').homedir(), '.luna-kernel', '.luna-tmp');
  try {
    if (!fs.existsSync(LUNA_TMP_DIR)) {
      fs.mkdirSync(LUNA_TMP_DIR, { recursive: true, mode: 0o700 });
    }
  } catch (e) {
    console.warn('[luna-tools] Could not create LUNA_TMP_DIR:', e.message);
  }
  ```

- [ ] **Step 2: Trocar `os.tmpdir()` por `LUNA_TMP_DIR` em `executeShellVisible`**
  Linhas ~736-737:
  ```js
  const tmpFile = path.join(LUNA_TMP_DIR, `luna-shell-${Date.now()}.log`);
  const scriptFile = path.join(LUNA_TMP_DIR, `luna-script-${Date.now()}.sh`);
  ```

- [ ] **Step 3: Trocar `os.tmpdir()` por `LUNA_TMP_DIR` em `applyPatch`**
  Linha ~1103:
  ```js
  const tmpFile = path.join(LUNA_TMP_DIR, `luna-patch-${Date.now()}.patch`);
  ```

- [ ] **Step 4: Forçar `/bin/bash` em `executeShell` invisível**
  Linha ~883:
  ```js
  const child = spawn('/bin/bash', ['-c', command], { cwd, env: process.env });
  ```

- [ ] **Step 5: Testar executeShell**
  Reiniciar luna-server e enviar mensagem DeepSeek pedindo `ls -la /home/jhin/luna`.

---

## Task 2: Resetar conversas antigas

**Files:**
- Modify: `/home/jhin/NEXO_DASHBOARD_PRO/backend/data/chat-sessions.json`
- SQL opcional: PostgreSQL tabela `chat_sessions`

- [ ] **Step 1: Fazer backup do arquivo atual**
  ```bash
  cp /home/jhin/NEXO_DASHBOARD_PRO/backend/data/chat-sessions.json /home/jhin/NEXO_DASHBOARD_PRO/backend/data/chat-sessions.json.bak.$(date +%s)
  ```

- [ ] **Step 2: Limpar JSON de sessões**
  Escrever `[]` em `chat-sessions.json` (ou manter estrutura `{ "sessions": [] }` conforme formato real).

- [ ] **Step 3: Limpar PostgreSQL se houver tabela de sessões**
  Verificar em `luna-chat-routes.js` se usa PG. Se sim, truncar/apagar registros do usuário `abner`.

- [ ] **Step 4: Reiniciar luna-server**
  ```bash
  pm2 restart luna-server
  ```

---

## Task 3: Garantir carregamento rápido das sessões

**Files:**
- Read: `/home/jhin/NEXO_DASHBOARD_PRO/backend/luna-chat-routes.js`

- [ ] **Step 1: Identificar onde sessões são listadas**
  Verificar se há delays artificiais, queries pesadas ou sincronização lenta com PG.

- [ ] **Step 2: Otimizar ou simplificar listagem**
  Se a listagem estiver lenta por causa de JSON + PG, adicionar cache em memória ou garantir índice na coluna `user_id`/`created_at`.

---

## Task 4: Fazer tools/actions funcionarem no DeepSeek

**Files:**
- Modify: `/home/jhin/.luna-kernel/kimi-bridge.cjs`
- Modify: `/home/jhin/.luna-kernel/provider-configs/deepseek.json`
- Modify: `/home/jhin/.luna-kernel/luna-soul.cjs` (parser se necessário)

- [ ] **Step 1: Melhorar seletores DeepSeek para JSON blocks**
  Adicionar em `deepseek.json`:
  ```json
  "codeBlock": "pre code, .ds-markdown pre code, .ds-message pre code",
  "assistantMessage": ".ds-message:last-child"
  ```

- [ ] **Step 2: Reforçar extração de JSON tools em `_genericProviderExtraction`**
  Além de limpar code-block artifacts, varrer o DOM por blocos `pre code` e JSON brutos contendo `"tool"`.

- [ ] **Step 3: Adicionar endpoints DeepSeek no `ProviderNetworkInterceptor`**
  Incluir `/api/chat/completions` e `chat.deepseek.com` em `_isChatUrl` para interceptar respostas/tools via rede.

- [ ] **Step 4: Testar tools no DeepSeek**
  Pedir para ler 10 diretórios aleatórios e depois criar um jogo espacial HTML/JS/Tailwind.

---

## Task 5: Commit e merge

**Files:**
- All modified

- [ ] **Step 1: Commit das mudanças**
  ```bash
  cd /home/jhin/.luna-kernel
  git add -A
  git commit -m "fix: luna tmp dir, bash shell, deepseek tools, chat reset"
  ```

- [ ] **Step 2: Merge para main**
  ```bash
  git checkout main
  git merge feat/manual-compaction-v10.32 --no-ff -m "Merge fixes: shell, tools, chat reset"
  ```
