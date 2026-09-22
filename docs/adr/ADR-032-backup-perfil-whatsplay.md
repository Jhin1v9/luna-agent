# ADR-032 — "Auto save do login": backup do perfil Chrome (não cookies do Brave)

- **Status:** aceito (2026-09-22, decreto do owner por voz)
- **Contexto:** a sessão do WhatsApp Web mora no perfil dedicado
  `~/.luna/chrome-whatsapp` (localStorage/IndexedDB + credenciais em
  `Default/`). Quando o login cai (QR de novo), não havia NENHUMA cópia do
  perfil para restaurar — o owner propôs o "auto save do login" e sugeriu
  copiar cookies do Brave como alternativa.

## Decisão

1. **Backup do PRÓPRIO perfil, nunca cookies de outro navegador.** A sessão
   do WA Web não vive em cookies de HTTP — vive no storage interno do perfil.
   O storage criptografado do Brave ainda é frágil de exportar (DPAPI + keyring
   do próprio browser). Copiar o perfil do Chrome dedicado é o caminho certo
   e completo.
2. `scripts/backup-profile.sh` — cópia versionada com robocopy (cópia quente:
   lê arquivos abertos pelo Chrome sem derrubá-lo), excluindo caches grandes
   e regeneráveis (`Cache/`, `Code Cache/`, `GPUCache/`, `Crashpad/`, etc.)
   e os arquivos que o Chrome trava de verdade (`Cookies*` — irrelevante pro
   WA; `Sessions/` — restauração de abas). Destino:
   `~/.luna/backups/chrome-whatsapp-YYYYMMDD-HHmm/`, mantendo os **últimos 5**.
   Falha = exit != 0 com mensagem explícita (nunca silêncio).
3. **Quem roda:** o watchdog — 1x/dia (no boot + timer 24h, mesmo padrão do
   backup do Postgres §30) **e após cada heal bem-sucedido** (transição
   DOWN→HEALTHY/DEGRADED detectada no ciclo). Falha dispara alerta Telegram.
4. **Restore (protocolo):**
   1. `pm2 stop luna-whatsplay` e matar Chrome do perfil (ele trava a pasta);
   2. mover o perfil atual pra `chrome-whatsapp.broken-<data>` (nunca apagar
      direto);
   3. copiar o backup escolhido de volta pra `~/.luna/chrome-whatsapp/`;
   4. `pm2 start luna-whatsplay` e validar `LOGGED_IN` (chat list visível,
      sem QR);
   5. se falhar, repetir com um backup mais antigo.
5. **Testado ao vivo (2026-09-22):** backup quente do perfil logado (490 MB,
   `Default/` íntegro) + restore numa cópia scratch (`~/.luna/tmp-restore-test`)
   + Chrome headless sobre a cópia → WhatsApp abriu **LOGGED_IN** (lista de
   chats, zero QR). Sessão viva nunca foi tocada no teste.

## Consequências

- Primeiro backup já existe (`chrome-whatsapp-20260922-1013`).
- O backup quente pode capturar o IndexedDB um pouco à frente/atras do ponto
  ideal — o WA Web reconcilia state na reconexão; risco aceito vs. parar o
  serviço para cópia fria todo dia.
- 5 × ~500 MB em disco. Se o IndexedDB crescer muito, revisitar KEEP/exclusões.
- Cookies do Chrome dedicado ficam de fora do backup de propósito: não são
  necessários para a sessão do WA e são os arquivos mais travados/instáveis
  para cópia quente.
