# HANDOFF — Kimi Code (sessão da Luna)

> Atualizado pela Luna (Kimi Work) em 2026-10-13 ~22:45. Continuar a partir daqui.

## Contexto em 1 parágrafo

A Luna agora tem cérebro de roda de providers grátis no VPS (kimi-coding → pollinations → gemini → github; NVIDIA OFF porque a key lista modelos mas todo completion trava; FCC instalado no VPS :8082 mas 503 pela NVIDIA). Fix crítico de hoje: `api-bridge.cjs` mandava `temperature: 0` e o kimi-for-coding rejeitava com 400 — agora só envia se `LUNA_API_TEMPERATURE` estiver setada. System prompt reescrito (`luna-kernel/packages/kernel/config/luna-prompt-config.json`) com identidade, regra "responder ou usar tool (nunca chutar)", seções BRAIN e WHATSAPP. Tools novas no kernel: `brainSearch`/`brainRead`/`brainSaveOutcome` (HTTP pro container nexo-brain :4321, envs `BRAIN_INTERNAL_URL` + `BRAIN_API_TOKEN` no `.env` de `apps/dashboard`, PC e VPS). E2E validado: a Luna chamou `brainSearch` sozinha e respondeu quem é o Abner.

## Tarefas pra VOCÊ (Kimi Code), nesta ordem

1. **Teste ponta-a-ponta do WhatsApp pela Luna Web** — pedir na Luna Web do VPS
   (`https://vps.nexo-digital.app/luna/`): "manda um 'oi teste' pro 34685093192".
   A cadeia é: modelo → `dashboardSendWhatsApp` → painel :3101 `/api/mensagem` →
   pg_notify `luna_outbound` → whatsplay (VPS) → WA Web. O fix de grupo (busca por
   NOME pra @g.us, por número pra privado) foi deployado hoje no `outbound.ts` do
   whatsplay, mas o envio privado de ponta a ponta ainda não foi validado.
   Depois testar envio pra GRUPO por nome ("Nexo Digital" ou o nome que estiver na
   allowlist do `.env` do VPS).
2. **Suporte a transport `anthropic` no bridge-factory** — pra plugar o FCC
   (`http://127.0.0.1:8082`, só fala `POST /v1/messages`) como provider da roda.
   Contrato: providers.json ganha `"transport": "anthropic"`; o bridge converte
   o prompt do soul pra messages[] anthropic e o streaming de `event: content_block_delta`
   de volta pra `response_delta`/`done`. Só faz sentido quando a NVIDIA voltar
   (build.nvidia.com — a key do Abner lista 80 modelos mas todo chat trava).
3. **Painel mostrar provider/modelo ativo** — o luna-web já recebe
   `/api/luna-web/providers` com `currentProvider` (ex.: "roda:kimi-coding").
   Falta exibir no ChatHeader (informativo, estilo discreto). PC e VPS.
4. **Inbound WhatsApp (fase 1)** — o banco tem 0 mensagens ingeridas. O reconcile
   só processa chat com badge de não-lido; as mensagens antigas foram consumidas
   sem ingestão. Próximo passo: mandar msg NOVA do WhatsApp do Abner pro +34 614 05 35 88
   e ver no log `~/.pm2/logs/luna-whatsplay-out.log` se `extractAndIngest` pega
   o texto (se falhar, inspecionar `readConversation` em `browser.ts` ~408/435 —
   página recarrega no deeplink e o messagePanel pode demorar).

## Convenções (não quebrar)

- Fonte da verdade = PC (`C:\Users\Abner\Documents\Luna cto\luna-agent` e
  `C:\Users\Abner\Documents\luna-kernel`); editar no PC e `scp` pro VPS
  (`ssh vps` = nexo@100.106.140.11 via Tailscale, usar `/usr/bin/ssh`).
- VPS: node24 em `~/node24/bin/node` (o `/usr/bin/node` é v18 — NÃO usar);
  pm2 congela envs do daemon — restart com env inline + `--update-env`
  (ex.: `LUNA_AGENT_ROOT=/home/nexo/luna-agent pm2 restart luna-watchdog --update-env`);
  `loadDotEnv` NÃO sobrescreve env já existente no processo.
- Envs do luna-agent: `.env` (PC) vs `.env.vps` (fonte de verdade do VPS,
  deploy via `bash scripts/deploy-env-vps.sh`). Envs do kernel:
  `luna-kernel/apps/dashboard/.env` existe em cada máquina com valores próprios.
- Typecheck whatsplay: `npx tsc --noEmit -p apps/whatsplay`.
- FCC no VPS: pm2 `luna-fcc`, PRECISA `--interpreter
  ~/.local/share/uv/tools/free-claude-code/bin/python` e a env é
  `NVIDIA_NIM_API_KEY` (não `NVIDIA_API_KEY`).

## Estado dos providers (medido hoje do VPS)

| Provider | Latência | Nota |
|---|---|---|
| kimi-coding | 1,9 s | head da roda, streams SSE ok, exige sem temperature |
| pollinations | 1,1 s | sem key, streams ok |
| gemini | 429 | cota free esgota rápido, gira sozinho |
| github-models | 0,5 s | NÃO stream (devolve body "OK") — deixado por último |
| nvidia-nim | — | OFF: key cega (lista modelos, completions travam) |
| FCC :8082 | 503 | placeholder até NVIDIA voltar |

Extras grátis pra adicionar quando o Abner criar contas: groq.com, openrouter.ai
(modelos `:free`), mistral.ai, cerebras.ai — todos com tier gratuito. Ele quer
"a webui LOTADA de provider grátis" igual ao webui que ele viu.
