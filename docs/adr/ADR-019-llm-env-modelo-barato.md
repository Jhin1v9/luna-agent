# ADR-019 — LLM via `.env` (contrato §9) e modelo sempre o mais barato

- **Status:** aceito (2026-09-21, decreto do owner)
- **Contexto:** o contrato `LUNA-MODEL-ROUTER-contrato-v1.1.md` §9 define
  providers via `LLM_*` no `.env` (troca de provider = só trocar o `.env`) e
  ADR-020 sugere Gemini como provider de dev. O owner decretou: **usar a key
  da Kimi AGORA** e **sempre o modelo mais barato — NUNCA 2.7, NUNCA K3**.

## Decisão

1. `LLM_PROVIDER` / `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` entram no
   schema zod de config; `OpenAiCompatAdapter` lê `LLM_*` como fonte primária
   (overrides por modo e defaults em último). Troca de provider = só `.env`.
2. **Divergência registrada (owner > contrato):** o contrato diz "dev usa
   Gemini Free Tier (ADR-020)"; o owner decretou Kimi para dev E teste agora.
   Segue o owner. Gemini (`GeminiAdapter`) permanece implementado como opção
   configurável, e a `GEMINI_API_KEY` anterior segue inválida (ADR-018).
3. **Modelo de produção = `kimi-k2.6`, o mais barato.** Nunca 2.7, nunca K3 —
   upgrade de modelo só por decreto explícito do owner, nunca por drift de
   código.

## Fatos descobertos na validação real (2026-09-21)

- A key do owner (`sk-kimi-…`) é do **Kimi Coding Plan**: funciona em
  `https://api.kimi.com/coding/v1` e **NÃO** em `api.moonshot.ai` (401) nem
  `api.moonshot.cn`. O `.env` do owner veio com a base URL errada
  (`api.moonshot.ai/v1`) — corrigido para `api.kimi.com/coding/v1`.
- **`kimi-k2.6` rejeita `temperature ≠ 1`** ("only 1 is allowed for this
  model"). O adapter **não envia temperature** por padrão (só se
  `apiTemperature` for configurada explicitamente). Modelo exato validado com
  chamada real: 200, usage `prompt_tokens`/`completion_tokens` presentes.
- `LLM_MODEL=kimi-k2.6` é o nome exato que funciona nesse endpoint.

## Ciclo real validado (mesma data)

Mensagem real de grupo no WhatsApp do owner → watcher (baseline não-invasivo)
→ evento → Context Builder → **kimi-k2.6 real** (399 in / 447 out tokens,
15.4s) → resposta na persona → **envio real autorizado** após espera humana
(~87s detecção→entrega, delays de digitação) → `messages.sent` + activity +
audit com UM correlation_id só → conversa RESOLVED. Decreto anti-mock
(ADR-016) mantido: nenhum fallback silencioso em nenhum ponto.

## Achado do teste vivo (corrigido)

Detecção de grupo por "nome contém ':'" falhou: o grupo "🏆Production - 2026"
foi tratado como privado e respondeu sem menção @luna (violação §5). Fix:
`is_group = chat_id.endsWith/contains '@g.us'` (jid estrutural; privado é
`@s.whatsapp.net`). Daemon reiniciado com o fix.
