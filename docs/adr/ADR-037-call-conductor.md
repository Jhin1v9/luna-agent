# ADR-037 — Call Conductor: Kimi Live como maestra da chamada (arquitetura)

- **Status:** aceito (2026-09-22, decreto owner pós-1ª chamada real)
- **Contexto:** com o sistema a trés no ar (WhatsApp ⇄ Luna ⇄ ChatGPT-voz),
  precisávamos decidir QUEM conduz a conversa em tempo real: o Kimi API
  (fast brain) lendo transcrições e despachando handoffs, ou o Kimi Live
  (CLI, ADR-033) como conductora ativa o tempo todo.

## Decisão

**Kimi Live conductora (CallConductor, `voice/call-conductor.ts`).** Durante
a chamada, um loop (~3s) lê as transcrições do chat do ChatGPT CONFORME SAEM
(cursor) e envia à Kimi Live com o contexto completo (participantes,
objetivo, histórico). Ela decide por turno: **say** (escreve no chat do
Operador o que falar — a VOZ nunca decide nada), **act** (ação real com
evidência via executor injetado), ou **hold** (marca de espera). Tudo
auditado (`call_conductor.*` no audit_log).

## Trade-offs (análise pedida)

- **Manter sessão viva (custo/latência)** vs simplicidade: cada turno spawna
  o CLI (~2-9s) — na prática fica em "poucos segundos por turno", aceitável
  pra conversa (o dono fala em blocos de 10-30s). Pré-voo (ADR-036) já
  esquenta a sessão antes de discar.
- **Kimi API (fast) dentro do loop?** NÃO no v1: duas mentes na mesma
  conversa = personalidade quebrada e race de decisões. A conductora é UMA
  (Kimi Live). O fast brain (Kimi API) fica pra classificações triviais
  pós-chamada (classifier, summaries). Decisão registrada.
- **Ferramentas/memória viva**: a conductora usa o CLI com o repo inteiro —
  contexto do cliente, brain, tools. É o que a Kimi API não tem.
- **Robustez**: loop falho ou Kimi caindo NÃO derruba a chamada — o Operador
  segue com o que tem; falha explícita em log + alerta (nunca silêncio sem
  aviso — hold text como rede de segurança).

## Consequências

- Papéis conscientizados nos prompts: Operador = só voz (nunca decide);
  Kimi Live = conductora que vê tudo e intervem.
- O que a conductora PODE fazer por chamada é declarado no brief dela
  (`poderes`) — default conservador.
