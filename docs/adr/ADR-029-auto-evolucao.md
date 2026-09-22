# ADR-029 — Auto-evolução (§16): pipeline real, prova ao vivo, e o que ainda é humano

- **Status:** aceito (2026-09-22, F7) — auto-reparo de componentes PRÓPRIOS ativo
- **Contexto:** v3.1 §16 + ADR-013: auto-modificação livre para componentes
  próprios com test/rollback/LKG. Guardrails: projetos de cliente continuam
  VEDADOS (§4 — nem a tool existe); máx 3 tentativas; nada de migration
  destrutiva.

## O que está IMPLEMENTADO e PROVADO ao vivo

1. **Pipeline `runHeal` (worker/selfheal)**: detect → branch `luna/fix-*` →
   applyFix → **gate duro** (typecheck + testes do componente) → commit autor
   Luna → merge --ff-only pra main → restart (pm2) → health check → ok:
   LKG atualizado + activity + audit `self_evolution.healed` + incident no
   Brain (appendIncident) + sinapse. Falha: **rollback automático pro LKG**
   (git reset --hard) a cada tentativa; 3 esgotadas → incident + alerta +
   Brain entry.
2. **Limites em código**: `assertOwnComponent` — whitelist (orchestrator,
   worker, whatsplay, watchdog, pingline); qualquer outro nome é RECUSADO
   ("projetos de cliente VEDADOS"); paths com `migrations` recusados
   (append-only). MAX_REPAIR_ATTEMPTS = 3.
3. **Prova controlada ao vivo** (evidência em 2026-09-22): bug reversível
   plantado no `pingline` (componente próprio, zero blast radius) → health
   quebrou → auto-diagnóstico detectou → reparo commitado (`fb32cbd`, autor
   Luna) → testes verdes → restart → **health verde**. Audit healed +
   sinapse `corr_prova_f7` + activity. Uma execução anterior também provou o
   caminho de **exhausted**: 3 tentativas → rollback pro LKG → incident +
   Brain entry.
4. **Incidentes viram learnings**: `appendIncident` (`.brain/luna/incidents/
   YYYY-MM.md`, append-only assinado) — toda falha vira conhecimento.

## Lições duras da prova (viraram código)

- **Rollback hard apaga trabalho não commitado** — o `git reset --hard` do
  ciclo de heal reverteu adições pendentes duas vezes. Regra: commitar antes
  de qualquer execução do heal.
- **`pnpm`/`pm2` são .cmd no Windows** — spawn direto = ENOENT; tudo via
  `cmd.exe /c`.
- Restart pm2 é assíncrono: health check precisa de retry (90s), não sleep
  fixo.

## O que AINDA é humano (fase seguinte, por decreto)

- **Diagnóstico/patch gerado por IA**: hoje `applyFix` é função determinística
  fornecida pelo chamador. O salto proposto (LLM investiga → propõe patch →
  sandbox aplica) exige: ambiente de teste isolado, diff review, e janela de
  canary — ADR novo quando o owner decretar.
- **Gatilho automático**: hoje o heal é chamado por job/script explícito. O
  auto-gatilho (self-test falhou N rodadas → enqueue selfheal) fica com o
  diagnóstico por IA.
