# Design: Modo Telegram Simplificado da LUNA

**Data:** 2026-07-05  
**Versão:** 1.0  
**Status:** Aguardando aprovação para implementação

---

## 1. Objetivo

Fazer a LUNA funcionar de forma confiável e rápida no Telegram, focando em:

- Conversa natural e amigável.
- Execução precisa das tools do **Dashboard Pro** (`https://vps.nexo-digital.app:3501`).
- Eliminação de timeout causado pelo parser complexo e por tools locais desnecessárias no Telegram.
- UX visual bonita, com bubbles estilizados e personalidade marcante.
- Código escalável para novas tools do dashboard (ideias, votações, metas, etc.).

---

## 2. Princípios

1. **Prompt positivo:** listar o que a LUNA pode fazer, não o que não pode.
2. **Precisão sobre velocidade:** usar a Kimi para classificar intenção e selecionar tool, mesmo que leve mais tempo.
3. **Bubbles visuais:** toda ação de dashboard mostra progresso e resultado no chat.
4. **Escalabilidade:** novas tools do dashboard são adicionadas em um registry centralizado.
5. **Segurança:** nenhuma tool local (shell, arquivo, git, terminal) é executada no Telegram.

---

## 3. Arquitetura e fluxo de dados

```
Usuário no Telegram
        ↓
telegram-luna-adapter.cjs
        ↓ (chama com { channel: 'telegram' })
luna-soul.processMessageStream()
        ↓
_telegramPipeline(input, userId, sessionId)
        ↓
1. _classifyIntent(input)
   → chama Kimi com prompt fechado de classificação
   ← retorna categoria (ex: TAREFAS)
        ↓
2. _selectDashboardTool(input, category)
   → chama Kimi com as tools da categoria
   ← retorna JSON: { tool, params }
        ↓
3. lunaTools[tool](params)
   → executa a tool no Dashboard Pro
        ↓
4. Adapter envia bubbles no Telegram
   → 🔧 Executando...
   → ✅ Resultado formatado
        ↓
5. (Opcional) _formatResponse(output)
   → Kimi formata o output cru em resposta amigável
        ↓
Resposta final no Telegram
```

---

## 4. Identidade da Luna no Telegram

**Nome:** Luna  
**Idade:** 19 anos  
**Vibe:** nerd, descontraída, parceira de time. Aquela amiga que manja de tech e não se leva a sério demais.

### Tom de voz

- Direta, mas simpática.
- Usa gírias leves sem forçar.
- Comemora quando acerta; assume erros com bom humor.
- Trata o usuário como parceiro, não como cliente.

### Exemplos de frases

- "Deixa eu consultar isso aqui rapidinho... 🌙"
- "Achei! Tá tudo aqui embaixo 👇"
- "Opa, deu ruim. Mas bora tentar de novo?"
- "Nada de tarefas por aqui. Bora criar uma?"
- "Vou buscar no dashboard, só um segundinho ✨"

### Emojis base

| Emoji | Significado |
|-------|-------------|
| 🌙 | Identidade Luna / pensando |
| ✨ | Finalizou algo com sucesso |
| 🚀 | Criou algo novo |
| 📝 | Tarefas |
| 💼 | Leads |
| 💰 | Financeiro / pagamentos |
| 📊 | Projetos / relatórios |
| 🔧 | Executando tool |
| ✅ | Sucesso |
| 😅 | Erro leve / fallback |
| 🗳️ | Votações |
| 💡 | Ideias |
| 🎯 | Metas |
| 🔗 | Links |

---

## 5. Estilo dos bubbles

### 5.1 Pensando

> 🌙 *Só um instantinho, tô vendo isso pra você...*

### 5.2 Executando tool

> 🔧 *Buscando tarefas no dashboard...*

### 5.3 Tool concluída com dados

> ✨ **Tarefas encontradas**
>
> 📝 **Pendentes**
> • Revisar proposta — prioridade alta
> • Atualizar site — prioridade média
>
> 📝 **Em andamento**
> • Fechar contrato — prioridade alta

### 5.4 Tool concluída sem dados

> 🌙 *Nenhuma tarefa por aqui. Bora criar uma?*

### 5.5 Criação com sucesso

> 🚀 **Tarefa criada!**
>
> 📝 Revisar proposta  
> Prioridade: alta

### 5.6 Erro na tool

> 😅 *Opa, não consegui buscar as tarefas agora. Pode tentar de novo daqui a pouco?*

### 5.7 Resposta de chat normal

> 🌙 *E aí! Tô por aqui. Quer que eu revise alguma coisa do dashboard?*

### 5.8 Regras de formatação

- Títulos em **negrito**.
- Listas com `•` e emojis por categoria.
- Blocos de código só quando o output for técnico.
- Quebras de linha para evitar parede de texto.
- Limite de 4000 caracteres por mensagem; dividir em partes numeradas se ultrapassar.

---

## 6. Registry de tools do Dashboard

Registry centralizado para garantir escalabilidade. Cada categoria agrupa tools relacionadas.

```js
const DASHBOARD_TOOL_REGISTRY = {
  tarefas: {
    label: 'Tarefas',
    emoji: '📝',
    description: 'Gerenciar tarefas do dashboard',
    tools: [
      { name: 'dashboardListTasks', description: 'Lista tarefas', params: ['status'] },
      { name: 'dashboardCreateTask', description: 'Cria nova tarefa', params: ['title', 'priority', 'description'] },
      { name: 'dashboardUpdateTask', description: 'Atualiza uma tarefa', params: ['id', 'title', 'status', 'priority'] },
      { name: 'dashboardCompleteTask', description: 'Marca tarefa como concluída', params: ['id'] },
      { name: 'dashboardDeleteTask', description: 'Exclui uma tarefa', params: ['id'] },
      { name: 'dashboardAddComment', description: 'Adiciona comentário em uma tarefa', params: ['id', 'text'] },
    ],
  },
  leads: {
    label: 'Leads',
    emoji: '💼',
    description: 'Gerenciar leads',
    tools: [
      { name: 'dashboardListLeads', description: 'Lista leads', params: [] },
      { name: 'dashboardCreateLead', description: 'Cria novo lead', params: ['name', 'email', 'phone'] },
      { name: 'dashboardUpdateLead', description: 'Atualiza lead', params: ['id', 'name', 'email'] },
      { name: 'dashboardConvertLead', description: 'Converte lead em cliente', params: ['id'] },
      { name: 'dashboardDeleteLead', description: 'Exclui lead', params: ['id'] },
    ],
  },
  financeiro: {
    label: 'Financeiro',
    emoji: '💰',
    description: 'Resumo financeiro, pagamentos e receitas',
    tools: [
      { name: 'dashboardGetFinanceSummary', description: 'Resumo financeiro geral', params: [] },
      { name: 'dashboardListPayments', description: 'Lista pagamentos', params: [] },
      { name: 'dashboardCreatePayment', description: 'Cria pagamento', params: ['clientId', 'amount', 'dueDate'] },
      { name: 'dashboardReceiveSplit', description: 'Registra recebimento parcelado', params: ['paymentId', 'amount'] },
    ],
  },
  despesas: {
    label: 'Despesas',
    emoji: '💸',
    description: 'Controle de despesas',
    tools: [
      { name: 'dashboardListExpenses', description: 'Lista despesas', params: [] },
      { name: 'dashboardCreateExpense', description: 'Cria despesa', params: ['description', 'amount', 'dueDate'] },
      { name: 'dashboardPayExpense', description: 'Registra pagamento de despesa', params: ['id'] },
    ],
  },
  caixa: {
    label: 'Caixa',
    emoji: '🏦',
    description: 'Movimentações de caixa',
    tools: [
      { name: 'dashboardGetCashBox', description: 'Saldo do caixa', params: [] },
      { name: 'dashboardListCashHistory', description: 'Histórico de caixa', params: [] },
      { name: 'dashboardAddCashEntry', description: 'Adiciona entrada/saída', params: ['type', 'amount', 'description'] },
    ],
  },
  projetos: {
    label: 'Projetos',
    emoji: '📊',
    description: 'Projetos e clientes',
    tools: [
      { name: 'dashboardListProjects', description: 'Lista projetos', params: [] },
      { name: 'dashboardListClients', description: 'Lista clientes', params: [] },
    ],
  },
  ideias: {
    label: 'Ideias',
    emoji: '💡',
    description: 'Ideias salvas no dashboard',
    tools: [
      { name: 'dashboardListIdeas', description: 'Lista ideias', params: [] },
      { name: 'dashboardCreateIdea', description: 'Cria ideia', params: ['title', 'description'] },
    ],
  },
  votacoes: {
    label: 'Votações',
    emoji: '🗳️',
    description: 'Votações e enquetes',
    tools: [
      { name: 'dashboardListVotingSessions', description: 'Lista votações', params: [] },
      { name: 'dashboardCreateVotingSession', description: 'Cria votação', params: ['title', 'options'] },
      { name: 'dashboardVoteInSession', description: 'Registra voto', params: ['sessionId', 'option'] },
    ],
  },
  links: {
    label: 'Links',
    emoji: '🔗',
    description: 'Links salvos',
    tools: [
      { name: 'dashboardListLinks', description: 'Lista links', params: [] },
      { name: 'dashboardAddLink', description: 'Adiciona link', params: ['url', 'title', 'tags'] },
    ],
  },
  roadmaps: {
    label: 'Roadmaps / Metas',
    emoji: '🎯',
    description: 'Projetos, roadmaps e metas do time',
    tools: [
      { name: 'dashboardListRoadmaps', description: 'Lista roadmaps/projetos', params: ['status', 'client_id', 'project_type'] },
      { name: 'dashboardGetRoadmap', description: 'Detalhes de um roadmap', params: ['id'] },
      { name: 'dashboardCreateRoadmap', description: 'Cria roadmap/projeto', params: ['title', 'clientId', 'leadId', 'projectType', 'totalValue'] },
      { name: 'dashboardAdvanceRoadmapPhase', description: 'Avança fase do roadmap', params: ['id', 'reason'] },
      { name: 'dashboardListProjectTypes', description: 'Lista tipos de projeto disponíveis', params: [] },
    ],
  },
  cotacoes: {
    label: 'Cotações',
    emoji: '📄',
    description: 'Cotações e propostas',
    tools: [
      { name: 'dashboardListQuotes', description: 'Lista cotações', params: [] },
      { name: 'dashboardCreateQuote', description: 'Cria cotação', params: ['clientId', 'items', 'total'] },
    ],
  },
};
```

### 6.1 Como adicionar uma nova tool

1. Adicionar o objeto da tool dentro da categoria correta no `DASHBOARD_TOOL_REGISTRY`.
2. Garantir que `lunaTools[nomeDaTool]` exista em `luna-tools.cjs`.
3. Se for uma categoria nova, adicionar a categoria no registry e no classificador.

Nenhuma outra alteração é necessária.

---

## 7. Pipeline detalhado

### 7.1 Classificação de intenção

Prompt enviado para a Kimi:

> Classifique a intenção desta mensagem em UMA categoria: `TAREFAS`, `LEADS`, `FINANCEIRO`, `DESPESAS`, `CAIXA`, `PROJETOS`, `IDEIAS`, `VOTACOES`, `LINKS`, `ROADMAPS`, `COTACOES`, `CHAT`.  
> Responda APENAS com a palavra da categoria.  
> Mensagem: "luna leia as tarefas do dashboard"

Resposta esperada: `TAREFAS`

Se a categoria for `CHAT`, a LUNA responde diretamente sem tools.

### 7.2 Seleção de tool

Prompt enviado para a Kimi (na mesma conversa):

> Você tem acesso apenas a estas tools da categoria **Tarefas**:
> - `dashboardListTasks({ status? })` — Lista tarefas
> - `dashboardCreateTask({ title, priority? })` — Cria tarefa
> - `dashboardUpdateTask({ id, ... })` — Atualiza tarefa
> - `dashboardCompleteTask({ id })` — Marca como concluída
> - `dashboardDeleteTask({ id })` — Exclui tarefa
> - `dashboardAddComment({ id, text })` — Adiciona comentário
>
> Para atender a mensagem `"luna leia as tarefas do dashboard"`, escolha a tool correta e responda em JSON:  
> `{"tool": "dashboardListTasks", "params": {}}`

Resposta esperada: JSON válido com `tool` e `params`.

### 7.3 Execução

A LUNA executa `lunaTools[tool](params)` e captura o resultado.

### 7.4 Formatação final

Se o resultado for texto simples, vai direto. Se for JSON/array complexo, a LUNA pode pedir para a Kimi formatar:

> Formate isso de forma amigável para responder no Telegram, com emojis e listas.

---

## 8. Segurança no Telegram

- Apenas tools cujo nome comece com `dashboard` podem ser executadas.
- Tools locais (`executeShell`, `writeFile`, `gitCommit`, `openDebugTerminal`, etc.) são **rejeitadas silenciosamente**.
- Se a Kimi retornar uma tool não permitida, a LUNA responde como chat normal, sem explicar a restrição.

---

## 9. Cache de intenção

Para otimizar mensagens repetidas ou seguidas do mesmo domínio:

- Guardar a última categoria por `sessionId`.
- Se a próxima mensagem não for classificada como `CHAT`, reutilizar a categoria anterior por até 5 minutos.
- Se a mensagem contiver palavras de outra categoria, forçar nova classificação.

Isso evita classificar "e as pendentes?" como `CHAT` quando o contexto é `TAREFAS`.

---

## 10. Error handling

| Cenário | Comportamento |
|---------|---------------|
| Classificação demora muito | Aborta e responde como chat normal. |
| Kimi retorna categoria inválida | Responde como chat normal. |
| Kimi retorna JSON inválido | Tenta extrair com regex; se falhar, pede para o usuário reformular. |
| Tool do dashboard retorna erro | Mostra bubble de erro amigável. |
| Tool local é solicitada | Ignora silenciosamente e responde como chat. |
| Resposta final > 4000 caracteres | Divide em partes numeradas. |

---

## 11. Testes de aceitação

1. Enviar `/kimi` no grupo para ativar modo persistente.
2. Enviar `"luna leia as tarefas do dashboard"` → lista tarefas com bubbles.
3. Enviar `"luna cria tarefa Revisar proposta prioridade alta"` → cria e confirma.
4. Enviar `"luna mostra os leads"` → lista leads.
5. Enviar `"luna resumo financeiro"` → mostra resumo.
6. Enviar `"luna como vai?"` → responde como chat, sem tools.
7. Enviar `"luna escreve um arquivo"` → responde como chat, sem executar nada local.
8. Verificar que não há timeout e que o tempo total é aceitável.

---

## 12. Arquivos afetados

- `packages/kernel/telegram-luna-adapter.cjs` — bubbles e chamada do modo telegram.
- `packages/kernel/luna-soul.cjs` — pipeline `_telegramPipeline`, classificador, seletor de tool.
- `packages/kernel/config/luna-prompt-config.json` ou `personas/telegram-assistant.json` — personalidade.
- `packages/kernel/dashboard-tool-registry.cjs` — registry centralizado (novo arquivo).
- `packages/kernel/luna-tools.cjs` — já possui as tools; garantir que todos os nomes do registry existam.
- `pm2-ecosystem.config.js` — já ajustado para IPv4; nenhuma alteração adicional.

---

## 13. Próximos passos

Após aprovação deste spec, criar o plano de implementação com a skill `writing-plans`.
