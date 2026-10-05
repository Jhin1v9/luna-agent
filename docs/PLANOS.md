# PLANOS — consolidado (Kimi Code × Kimi Work × decretos do Abner)

> Última atualização: 2026-09-27 por Luna. Este arquivo é a fila única de
> verdade — sessões novas LEIAM aqui antes de propor trabalho.

## 📐 Plano pronto pra execução (decreto owner 27/09)
- **Modo Edição (mini-CMS) do site HDM + fotos reais do Matheus** — análise total feita
  (fotos IMG_0078–0084 inventariadas, site mapeado: ~1.900–2.000 textos ×4 idiomas, 12 imgs,
  ~25 tokens de tema). Arquitetura reusável `@nexo/site-cms` (content skin em runtime sobre o
  estático, /edit com senha, docker+Postgres na VPS, guardrails de claims no publish).
  **Plano completo: `docs/PLANO-MODO-EDICAO-HDM.md`** — 6–8 dias de dev, fases 0–4.
  Execução: time (Jhin/Enoque/Elias). Decisões pendentes do owner listadas na §5 do plano.

- **nexo-cms — plano COMPLETO por área** (editor visual, conteúdo, mídia, tema, backend,
  estrutura, segurança, integração, infra, UX, qualidade + roadmap A/B/C):
  `docs/PLANO-NEXO-CMS-COMPLETO.md`

## ✅ Entregue (2026-09-23/24)
- Chat Registry (migração 012): identidade por número/jid, deny-first, blocklist (namorada BLOCKED com nota do incidente), enforce em voice.call (tool FAST + executor). voice.call trancado atrás de VOICE_CALL_ENABLED (OFF até decidirmos religar).
- Auditoria do incidente da ligação (causa raiz em 3 camadas, evidência, sinapse).
- Painel workspace DESBLOQUEADO: login por email (cookie nexo.session-token). Tool `scripts/nexo-admin.mjs` (GET/POST autenticado, comentários, cookie renovável).
- HDM (Matheus): carrossel Ken Burns no hero + profissões eletromecânico/mecânico industrial (textos oficiais, 4 idiomas, pictogramas novos). Branch `luna/hdm-pedidos-matheus` (2a5fd84), `npm run verify` completo. Cliente avisado por comentário no painel.
- Jess como cliente no Brain (ficha) + sync pro principal-brain (Atlas mostra as fichas; cluster Relatórios).
- Cadeia LLM 3 elos: kimi → KIMI_API_KEY_2 → gemini (FallbackAdapter, testes).
- kimiwork poll 2500→1500ms.
- Brain remoto: escrita documentada (só /brain/api/learning/outcomes; fichas = git no principal-brain).

## 🔥 Próximos (ordem)
1. **P1 — outbound char-interleaving**: serializar envios por chat (fila/trava por conversation em `apps/whatsplay/src/outbound.ts`). Mensagens embaralhadas quando 2 envios concorrem.
2. **P2 — seletor de caller do popup** (incoming-fastpath pega o rótulo do botão) + **send_safety bypassado em envio manual do admin** (sem reply_to_event → skipped; checar blocklist do registry nesse caminho).
3. **P3 — robustez do cérebro**: classify com cadeia completa (kimi→kimi2→gemini→kimiwork), kimi-cli resposta vazia = falha com retry, script `scripts/dlq-analyze.ts` (classificar e reenfileirar os 20 da DLQ), investigate com budget explora mas não entrega objeto.
4. ~~Notificações por pessoa~~ PARCIAL NO AR 2026-09-25: sync-clients-registry.ts (telefone do perfil → registry.notify_channel) + exceção notify_send no outbound (deny-first). Falta o app cliente: docs/PAINEL-NOTIFICACOES-SPEC.md (email field, PWA, push — implementar no VPS). Evento de solicitação/pedido → msg direta no canal do cliente via `chat_registry.notify_channel`. Precisa: registrar clientes no registry (nome+número/canal — Abner fornece). Mecânica de envio já existe (skill de mensagem por passos).
5. **Skills compostas** (visão Abner): biblioteca de skills com passos parametrizáveis — `LIGAR(dest)`, `MENSAGEM(dest, texto)`, `SOLICITACAO_CRIAR(cliente, ...)` — passos atômicos reutilizáveis, sujeito é variável. Base: Chat Registry para resolução de destino.
6. **Cron do Kimi Work**: prompt dele pode estar com o fluxo de login antigo (username em vez de email). Se a varredura falhar de novo: atualizar o prompt da automation_27b0babd com os gotchas (email=, nexo.session-token) apontando pro `scripts/nexo-admin.mjs`. prompt-nova-kimi.md já atualizado.
7. **Relay de voz**: transcrições do ChatGPT (voice mode) → Kimi Live em tempo real (a conductora lê e intervém; o dono pergunta "quem é a cliente?" e ela responde na hora). Probe do DOM das captions pendentes (1 conversa com o ChatGPT Voz, sem gastar ligação).
8. **Religar voice.call**: só quando o registry estiver completo e com o dedo do Abner (VOICE_CALL_ENABLED=true). Antes: dial estrito por dígitos (browser ainda disca por nome canônico).

## 📋 Planos médios (decretos registrados)
- **Interface Luna Agent no workspace admin**: página de config real (API base, provider, modelo) com validação de token na hora + comandos ("ligar pro admin") com retorno de erro tratado.
- **Siri → Luna**: Atalho iOS POSTando texto em /v1/events (comando admin). **Luna → iPhone**: Pushcut/Atalhos (alarme, WhatsApp) — o que a Apple permite.
- **Relatórios /relatorios/**: card da Jess (cadastro humano), relatório HDM (bloco pronto em relatorios-clientes.md), regra "cliente ativo = relatório atualizado" checada toda varredura.
- **Publicação do site HDM novo** (ação Abner): merge da branch luna/hdm-pedidos-matheus + deploy hook. Logo final: aguardando PDF do Matheus.
- **kimiwork mais rápido (profundo)**: pipeline de inbox + batch de turns; hoje ~2-9s/turno aceitável mas melhorável.
- **Chip dedicado WhatsApp** (compra Abner): tira o número pessoal do sistema.
- **Instagram**: depois (fora de escopo por decreto).

## 🧍 Ações humanas pendentes (Abner)
1. Deploy do site HDM novo (branch pronta, verificada).
2. PDF da logo final do HDM (quando Matheus reenviar) → aplicar no site.
3. Números/canais de Jess, HDM, Noke, Elias → registrar no chat_registry (habilita notificações por pessoa).
4. Decidir sobre os 9 commits locais do Atlas no VPS (DeepSeek ofereceu push).
5. `pm2 startup` (se ainda não feito) + Docker Desktop no autostart (já está no Run; confirmar).
