# Design: Documentação Viva e Unificação da Luna

**Data:** 2026-07-11
**Status:** Aprovado pelo usuário
**Escopo:** `~/.luna-kernel` (monorepo da Luna) — kernel apenas; dashboard fora do escopo por enquanto

## Contexto e problema

A Luna está em desenvolvimento há meses. A documentação acumulou-se em camadas sem consolidação:

- 5 variantes de master prompt (v6.1 pure/strict/json-agent/workspace + v6.2 ativo) sem indicação clara de qual é o vigente
- 2 SYNC_GUIDEs, 2 gerações de installer, 2 READMEs com informações divergentes
- Personas com idades contraditórias (18, 19, 28 anos) em arquivos diferentes
- Docs citando paths pré-monorepo (`~/NEXO_DASHBOARD_PRO`, `config-server.cjs`)
- Auditorias (v10.8, v10.32) com bugs documentados que ninguém mais lê
- Consequência prática: **regressões entre sessões** — um agente novo não sabe o estado real do sistema e refaz/desfaz trabalho

O usuário quer: (1) documentação unificada e correta, separada por público (agentes vs humanos), (2) um sistema de memória viva onde mudanças são registradas automaticamente a cada commit, para que nenhum reset de contexto cause regressão.

## Decisões tomadas no brainstorming

| Decisão | Escolha | Motivo |
|---|---|---|
| Consumidor principal | Agentes de código (Kimi Code, Claude, Codex) | São quem sofre com regressão entre sessões |
| Onde vive a memória | Dentro do repo (`.brain/`) | Versionado, propaga pros 3 PCs via sync cron existente, grátis, offline |
| Gatilho do registro | Git hook pós-commit | Automático, nada depende de lembrar |
| Local do `.agents` | Dentro do repo (`~/.luna-kernel/.agents/`) | Viaja com o código e sincroniza |
| Idioma por público | `.agents/` e `.brain/` em **inglês** (consumidos por agentes); `guia-humano.md` em **espanhol** (consumido por humanos) | Melhor resultado por consumidor, não por preferência do criador |
| Arquivos velhos | **Deletar**, não arquivar | Usuário não quer lixo no repo; histórico do git preserva o que estava commitado |

## Estrutura final

```
~/.luna-kernel/
├── AGENTS.md                     # raiz, curto: aponta pra .agents/ e .brain/
├── .agents/                      # DOCS PARA AGENTES — EM INGLÊS (língua ideal pra agentes de IA)
│   ├── README.md                 # mapa: o que ler primeiro e por quê
│   ├── architecture.md           # pipeline: soul → bridge → Kimi/DeepSeek → tools
│   ├── conventions.md            # build, run, test, padrões de código, monorepo
│   ├── prompts.md                # master prompt ativo (v6.2) vs variantes mortas; frame "Luna Mirror"
│   └── runbooks/                 # incidentes conhecidos e resolução
│       ├── login-kimi-caiu.md
│       ├── telegram-409-conflict.md
│       └── compactacao-travou.md
├── docs/
│   └── guia-humano.md            # guia humano unificado, EM ESPANHOL (instalação, operação, sync 3 PCs, cookies Kimi)
└── packages/kernel/.brain/       # MEMÓRIA VIVA (expande o que já existe)
    ├── status.md                 # estado atual: o que funciona, o que está quebrado, no que se está trabalhando
    ├── decisions.md              # decisões com data + motivo
    ├── bugs.md                   # abertos e resolvidos (com referência ao commit que resolveu)
    └── changelog.md              # NOVO: linha do tempo de mudanças, alimentada pelo hook
```

### Política de deleção

- **Deletar:** variantes v6.1 dos master prompts, `SYSTEM_PROMPT.md`/`SYSTEM_PROMPT_MINIMAL.md` (presets mortos), SYNC_GUIDE e installer antigos em `packages/kernel/luna-installer/`, docs com paths pré-monorepo, planos web truncados em `packages/kernel/plans/`, auditorias antigas (após extrair bugs ainda abertos para `.brain/bugs.md`)
- **Antes de deletar qualquer arquivo:** extrair para os docs novos tudo que ainda é verdade e útil
- **Exceção com confirmação explícita:** arquivos NÃO rastreados pelo git (`AUDITORIA_v10.8.md`, `backup-merge-inteligente-*`, `backup-src-*`, `*.bak.*`, `current_session`, `session_index.json`) — deleção é permanente. Serão listados um a um para o usuário aprovar antes de apagar
- Deleções de arquivos rastreados são seguras: recuperáveis via `git log -- <path>`

## Sistema de memória viva ("agente anotador")

### Componentes

1. **Hook pós-commit** (`.githooks/post-commit`, ativado via `git config core.hooksPath .githooks`):
   - Escreve o hash do commit em `.brain/.pending-commits` (append, instantâneo — nunca trava o commit)
2. **Comando `luna-brain-sync`** (script `scripts/luna-brain-sync.sh` + atalho em `~/.local/bin`):
   - Lê `.brain/.pending-commits`
   - Para cada commit pendente, coleta `git show` (diff + mensagem)
   - Dispara subagente (Kimi Code headless) com prompt fixo: "atualize `.brain/` conforme estas mudanças"
   - O subagente: move bugs resolvidos, registra decisões, atualiza `status.md` e `changelog.md`, limpa a fila
   - Mudanças no `.brain` entram em commit próprio: `docs(brain): sync pós-commit <hash>`
3. **Formato dos arquivos do `.brain`** — regras rígidas para o subagente:
   - `changelog.md`: uma entrada por commit, mais novo no topo, formato `- [2026-07-11 c51561e] feat(dashboard): audit log — resumo de 1 linha do que mudou e por quê`
   - `decisions.md`: só decisões arquiteturais/de produto, com data, motivo e alternativas rejeitadas
   - `bugs.md`: duas seções (Abertos / Resolvidos); resolvido referencia o commit
   - `status.md`: reescrito quando o estado muda; sempre reflete o presente, sem histórico

### Por que fila + comando, e não subagente direto no hook

Hooks de git devem ser instantâneos. Rodar um subagente de IA dentro do commit travaria o fluxo e poderia falhar de forma opaca. A fila garante que nada se perde; o sync pode rodar no fim da sessão, manualmente, ou via cron.

## Ordem de execução

1. **Extrair verdade dos docs antigos** — varrer cada arquivo a ser deletado e resgatar o que é útil
2. **Criar `.agents/`** — escrever architecture.md, conventions.md, prompts.md, runbooks, README
3. **Reescrever `docs/guia-humano.md`** — merge corrigido de HUMAN-GUIDE + SYNC_GUIDE + COOKIES_KIMI, **escrito em espanhol** (o usuário mora na Espanha; qualquer outro leitor humano provavelmente será hispanohablante). Os docs de agentes (`.agents/`) são escritos **em inglês** — língua em que agentes de IA raciocinam melhor e padrão dos docs técnicos em que foram treinados
4. **Atualizar `.brain/`** — consolidar bugs abertos reais (v10.8 + v10.32), decisions, status atual; criar changelog.md retroativo dos últimos ~20 commits
5. **Deletar lixo** — rastreados via git rm; não-rastreados só após lista aprovada pelo usuário
6. **Implementar hook + `luna-brain-sync`** — testar com commit real e verificar que `.brain` foi atualizado corretamente
7. **AGENTS.md na raiz** — índice curto apontando para `.agents/` e `.brain/`

## Critérios de sucesso

- Um agente novo, lendo apenas `AGENTS.md` → `.agents/README.md` → `.brain/status.md` + `changelog.md`, sabe o estado real da Luna em < 5 minutos
- Zero arquivos contraditórios no repo (uma fonte da verdade por assunto)
- Após qualquer commit + `luna-brain-sync`, o `.brain/changelog.md` reflete a mudança
- Guia humano unificado sem referência a paths pré-monorepo

## Fora do escopo

- Dashboard (`apps/dashboard`) — exceto onde o kernel o referencia
- Correção dos bugs documentados (serão tratados depois; o usuário tem uma lista nova de bugs para registrar no `.brain`)
- Mudanças no código da Luna (prompts, soul, bridge) — apenas documentação e automação
- Notion ou qualquer serviço externo
