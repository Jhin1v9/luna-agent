# SWEEP → KIMI CODE — pipeline de execução (decreto owner 2026-09-26)

Quem decide **se** dispara é o Kimi Work (classificação do sweep). Quem decide
**o que executar** é o Kimi Code (regra de autonomia). Nada dispara sozinho sem
novidade real.

## Fluxo

```
Kimi Work (automação "Cron", a cada 2 min quando sweep atrasado)
  └─ grava .brain/luna/sweeps/<ts>-projetos.md
  └─ CLASSIFICA o resultado:
       "sem novidade" (saúde OK, fila zerada, 0 commits, 0 pendências novas)
         → NÃO FAZ NADA. Nem chama Kimi Code. (não gasta token à toa)
       tem algo acionável (commits novos, pedidos/comentários, alertas,
       falhas, pendências novas ou mudadas)
         → roda: node scripts/dispatch-sweep.mjs <arquivo-do-sweep>
               └─ lockfile + dedupe por hash (mesmo sweep nunca dispara 2x)
               └─ dispara detached: kimi -p --agent-file agents/sweep-triage.agent.md -y
Kimi Code (sweep-triage)
  └─ lê SWEEP_FILE, lista achados acionáveis
  └─ PEQUENO → executa em fases e confere cada fase
  └─ GRANDE  → plano em fases + ask-owner.mjs --ask (WhatsApp) e ENCERRA
  └─ ao terminar (obrigatório):
       1. brain: append "## Kimi Code — <data>" no lugar certo + commit + push
       2. sweep: append "## Ações do Kimi Code" no próprio arquivo
       3. WhatsApp: ask-owner.mjs "resumo" pro grupo 🏆Production - 2026🙏🏻
       4. relatório de cliente no portal, se o sweep tocou cliente
Resposta do owner no grupo → ingest whatsplay → automação "Geral" (Kimi Work)
  → numa sweep futura, o assunto reaparece e o ciclo recomeça
```

## Regra de autonomia (resumo)

- **Pequeno** = fix pontual, config, doc, relatório, ajuste isolado verificável → faz sozinho.
- **Grande** = múltiplas fases, muitos arquivos, deploy arriscado, migração,
  decisão de produto, ou custo alto de tokens → **não executa**; pergunta no
  WhatsApp e aguarda. Em dúvida → trata como grande.
- **Nunca** sem OK explícito: secrets/.env, deploy produção, deletar dados,
  push --force, reiniciar whatsplay/orchestrator em horário de atendimento.

## Fios para ligar (Kimi Work)

As automações do Kimi Work vivem na UI do `kimi web` (http://127.0.0.1:58629),
não em arquivo editável. Adicionar ao **prompt da automação "Cron"** (a que gera
o sweep de projetos), depois da geração do relatório:

```
REGRA DE DISPATCH (decreto owner 2026-09-26): após gravar o sweep, avalie o
resultado. Se foi "sem novidade" (saúde OK, fila zerada, 0 commits novos,
nenhuma pendência nova ou alterada), NÃO chame o Kimi Code — encerre aqui.
Se houver QUALQUER coisa acionável (commits novos, pedidos/comentários de
clientes, alertas, falhas, pendências novas/mudadas), rode:
  node scripts/dispatch-sweep.mjs <caminho-do-sweep-que-você-acabou-de-gravar>
O dispatch tem dedupe — se já foi despachado, ele avisa e não repete.
```

## Arquivos

| Arquivo | Papel |
|---|---|
| `scripts/agents/sweep-triage.agent.md` | system prompt do Kimi Code (contrato completo) |
| `scripts/dispatch-sweep.mjs` | gate mecânico (lock/dedupe) + disparo detached |
| `scripts/ask-owner.mjs` | mensagem pro grupo via fila outbound (whatsplay) |
| `.brain/.kimi-dispatch.json` | estado do dedupe (hash do último sweep despachado) |
| `.brain/logs/kimi-dispatch-*.log` | saída das sessões despachadas |

## Testar sem disparar nada

```bash
node scripts/dispatch-sweep.mjs --dry-run
node scripts/ask-owner.mjs --dry-run "texto de teste"
```
