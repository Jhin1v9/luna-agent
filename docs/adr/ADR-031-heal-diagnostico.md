# ADR-031 — Self-heal com diagnóstico por IA (flag OFF por default)

- **Status:** aceito (2026-09-22, BLOCO 4 do fechamento)
- **Contexto:** heal sem plano registrado ficava "pendente de diagnóstico
  assistido" (ADR-030). O próximo degrau: o próprio FAST diagnostica e propõe
  o patch.

## Decisão

1. `AUTOHEAL_LLM_PATCH=true` no .env liga o caminho (default OFF — ato
   deliberado do owner).
2. Serviço próprio DOWN 3 ciclos sem plano → FAST recebe logs (stderr tail) +
   heartbeats e responde JSON estruturado: `{analysis, root_cause, learning,
   patches:[{path, search, replace}]}` — search/replace exato por arquivo,
   nunca diff de LLM solto.
3. O patch executa DENTRO do runHeal: whitelist de paths (só apps/<serviço
   próprio>/** e packages/**; migrations e .env proibidos sempre), aplicação
   falha se `search` não casa, e o GATE DUPLO (typecheck + testes) + LKG +
   rollback + máx 3 tentativas continuam valendo por cima.
4. FAST sem certeza → `patches: []` → sem heal (honestidade > palpite). Patch
   fora da whitelist → recusado. Flag OFF → recusa explícita.
5. Testado: flag off recusa; patches:[] não executa; path de cliente/migration
   recusado; patch válido aplica e o heal completa.

## Por que OFF por default

Patch gerado por IA é o nível de autonomia mais alto do sistema (§16). O
owner liga quando quiser — até lá, diagnóstico assistido por humano.
