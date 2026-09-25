# SPEC — Notificações por cliente no workspace (colar na sessão do VPS)

> Decreto owner 2026-09-25. Implementar no app CLIENTE (deploy em
> `/cliente`) — o clone do GitHub está atrás do deploy (o código do perfil
> com Telefone/notificações só existe no VPS). Depois: commit+push de volta.

## 1. Perfil (Dados Pessoais) — `/cliente/<locale>/perfil`
- **Telefone** (já existe): garantir que salva (`WorkspaceUser.phone`) e que
  `GET /nexo/api/admin/clients` expõe (já expõe ✅ — a Luna já sincroniza).
- **Email de notificação**: NOVO campo editável "Email" na seção Dados
  Pessoais. NÃO sobrescrever `WorkspaceUser.email` (é a identidade de login) —
  criar `WorkspaceUser.notificationEmail String?` (migration prisma) e salvar aí.
  Expor em `/api/admin/clients` (campo `notificationEmail`).
- Validação: formato email simples; telefone: só dígitos/+ com mínimo 8.

## 2. Preferências de notificação (os toggles Email/Navegador que já existem na tela)
- Persistir por usuário (tabela `NotificationPreference` ou colunas em
  WorkspaceUser: `notifEmail Boolean @default(true)`, `notifPush Boolean
  @default(false)`).
- **Navegador = push web** (ver §3).

## 3. PWA instalável + push
- `manifest.webmanifest` (name "Nexo Workspace", icons 192/512, `display:
  standalone`, `start_url: /cliente`, theme_color) + `<link rel="manifest">` no
  layout. Isso já torna instalável.
- Service worker (`sw.js`) com handler `push` (mostra notificação com title/body
  do payload JSON) + `notificationclick` (foca/abre `/cliente`).
- Tabela `PushSubscription` (userId, endpoint, keys p256dh/auth, unique por
  endpoint). UI: botão "Ativar notificações" no perfil → `pushManager.subscribe`
  → POST pra `/cliente/api/push/subscribe` (salva).
- VAPID: gerar par (`npx web-push generate-vapid-keys`), colocar no `.env` do
  app (`NEXT_PUBLIC_VAPID_PUBLIC_KEY` + `VAPID_PRIVATE_KEY` + `VAPID_SUBJECT=
  mailto:abner@nexo-digital.app`).
- Endpoint de envio (uso pela automação/Luna): `POST /api/admin/push/send
  {userId ou organizationId, title, body}` — varre subscriptions do(s) usuário(s)
  e dispara web-push; limpa subscriptions 404/410 (expiradas).

## 4. Como a Luna usa (já pronto do lado dela)
1. Cliente salva o telefone no perfil → `scripts/sync-clients-registry.ts`
   (luna-agent) registra no `chat_registry` com `notify_channel=whatsapp:+N`.
2. Evento de solicitação/pedido → notifications engine enfileira mensagem com
   `metadata.notify_send=1` → whatsplay entrega (exceção de allowlist validada
   pelo registry — deny-first intacto).
3. Email/push: quando o spec acima existir, a engine ganha os canais email
   (SMTP) e push (endpoint §3) nas `channel_preferences`.

## Critérios de aceite
- [ ] Perfil salva telefone + email de notificação e ambos aparecem em `/api/admin/clients`
- [ ] App instalável (Lighthouse PWA: manifest + SW registrado)
- [ ] Push de teste chega com app fechado (web-push direto no endpoint)
- [ ] Código commitado e pushado pro GitHub (nexo-workspace)
