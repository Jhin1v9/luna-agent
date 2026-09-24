# Chats Kimi Work dedicados (decreto owner 2026-09-24 08:16)

> "um chat do kimi work PROPRIO pra chamadas, outro proprio pro cron task e outro
> proprio pra coisas gerais tipo receber mencoes no wpp e responder, e telegram e
> realizar tarefas pedidas. cada uma dedicada e sempre ser usada aquele em
> especifico pra nao misturar os assuntos."

## Os três chats

| Chat | Automação | Dispara quando | Escopo |
|---|---|---|---|
| **Voz** | `Luna — Voz (chamadas)` (`automation_277533a3…`) | a cada 30s: `call.incoming` pending OU turno `channel='voice'` pending | atender/recusar chamadas (fail-closed), turnos da conductora (pessoa na linha — latência máxima) |
| **Cron** | `Luna — Cron (varredura Nexo)` (`automation_6a9e9480…`) | a cada 2min: varredura atrasada (>10 min de `.brain/.last_sweep.json`) | VPS Nexo (solicitações/clientes/projetos), reconciliação de relatórios, sweep de commits, brain remoto, autoconf |
| **Geral** | `Luna — Geral (menções e tarefas)` (`automation_b4f53729…`) | a cada 1min: `whatsapp.message`/`telegram.message` pending OU turno `channel='geral'` pending | menções grupo productions (WhatsApp), menções grupo do Telegram (responde citando + executa tarefas pedidas), fast brain do orchestrator, auto-reparo |

A antiga "Luna — Cérebro 24/7" (tudo-em-um) foi **deletada** em 2026-09-24.

## Roteamento (disjunto por construção)

- **Inbox** (`kimiwork_inbox.kind`): `call.incoming` → só Voz · `whatsapp.message`/`telegram.message` → só Geral. Cada `should_fire.py` filtra seu kind; prompts proíbem explicitamente os outros assuntos.
- **Turnos LLM** (`kimiwork_llm_turns.channel`, migração 011): `conductor:*`/`operator:*` → `voice` (só Voz responde) · todo o resto → `geral` (só Geral). Derivação no `KimiWorkAdapter.sendTurn` — callers não precisam saber que os chats existem.
- Claim atômico: `UPDATE … WHERE id=… AND status='pending'` — corrida entre execuções da mesma automação não duplica resposta.
- **Cron não responde turnos nem inbox** — se um turno `geral`/`voice` ficar pendente, a culpa é do chat dono; o Cron não pega emprego dos outros.

## Fast path de chamada (contexto)

Quem está na `WHATSAPP_OUTBOUND_ALLOWLIST` é atendido pelo **daemon whatsplay em ~2s**
(`apps/whatsplay/src/voice/incoming-fastpath.ts`) — clique de atender imediato, ChatGPT
do Operador aberto em paralelo, prompt com contexto buildado injetado via `sendTextFast`,
conductora lendo captions do voice mode. O evento de inbox vai `done` com
`payload.fastpath=true` — o chat Voz só registra. Quem está FORA da allowlist é quem
chega pending pro chat Voz decidir (recusar + alertar, por padrão fail-closed).
