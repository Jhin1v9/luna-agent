# ADR-024 — Usage ledger: preços versionados, custo interno ≠ cobrança

- **Status:** aceito (2026-09-21, F2 — Bloco 4)
- **Contexto:** §23/§28 mandam usage ledger real — cada chamada debita com
  provider/modelo REAIS e estimated_cost; custo interno e cobrança são
  contas SEPARADAS (mudar preço não reescreve histórico).

## Decisão

1. **Preços em `config/prices.json` (versionado no repo)**: USD por 1M
   tokens, por modelo. kimi-k2.6 = $0,95 in / $4,00 out (§23 do documento
   v3.1). Mudar preço = commit no JSON, sem tocar código.
2. `usage_entries` grava `provider` e `model` REAIS por chamada (o adapter
   agora devolve `model` no TurnResult — §9 do contrato do router).
3. `estimated_cost` calculado no handler a partir dos preços; modelo sem
   preço cadastrado → custo 0 com o modelo ainda assim registrado (nunca
   perder o registro por falta de tabela de preço).
4. **billable_units = ceil(estimated_cost × 100)** (centavos de USD) — conta
   de cobrança separada do custo interno; o multiplier fica no mesmo
   prices.json. Trocar markup não afeta o histórico real.
5. Cache de contexto (§23: −80-85%) não entra em F2 — quando o provider
   reportar `cached_tokens` de forma confiável, entra como coluna nova
   (migração), nunca editando as anteriores.

## Consequências

- Painel de custos (F4) lê `usage_entries` direto: custo real vs. billable
  lado a lado, por cliente/modelo/dia.
