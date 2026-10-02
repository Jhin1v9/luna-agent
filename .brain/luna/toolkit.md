# Toolkit da Luna (scripts/ — genéricos, variável aberta, NUNCA node -e ad-hoc)

- `wa-send.mjs --chat X --text Y [--quote Z]` — envia como Luna (resolve por ILIKE, aborta se ambíguo)
- `wa-read.mjs --chat X [--limit N]` — lê mensagens ✅ testado
- `wa-ingest.mjs --chat X` — sweep one-shot isolado de um chat
- `wa-call.mjs --to X [--motivo M]` — ligação (precisa Chat Registry + VOICE_CALL_ENABLED)
- `wa-peek.mjs shot|search|open|unarchive` — olhos no WA Web via CDP:9333 (dump DOM sempre; print best-effort — compositor trava quando Chrome oculto)
- `screen-shot.mjs [--nome X]` — **captura GDI real da TELA inteira via PowerShell (SetProcessDPIAware + VirtualScreen)** — o que o owner vê eu vejo; infalível p/ duvidar de qualquer UI. commit b786225
- `painel-api.mjs <VERBO> <rota> [--body] | relogin` — painel VPS ✅ testado. ⚠️ **Git Bash converte args que começam com `/` em path Windows** → usar `MSYS_NO_PATHCONV=1 node scripts/painel-api.mjs GET /nexo/...` (senão o host vira `vps.nexo-digital.appC:/...` e dá ENOTFOUND). Resposta admin vem envelopada: `{data: [...]}`.
- `brain-api.mjs <GET|POST> <rota> [--body|--file|--type|--title]` — brain remoto ✅ testado
- `vps-deploy-static.sh <pasta-local> <subpasta-no-html>` — **publica página estática na VPS**: scp p/ `vps:/home/nexo/Documentos/VPS/VPS/static-htmls/html/<subpasta>/` + curl de verificação. Fonte em `analises/ia-concorrentes/`.
- **Publicar na VPS (roteiro, 01/10/26):** ssh alias `vps` (Tailscale, nexo@100.106.140.11) → pasta servida pelo container `nexo_static_htmls` (nginx 127.0.0.1:14070, bind `./static-htmls/html:/usr/share/nginx/html:ro`). **O Caddy ativo (`/etc/caddy/Caddyfile`, systemd, root-only — sem sudo p/ nexo) só expõe handles explícitos**; pasta nova NÃO fica pública sem handle novo (403 no catch-all). Rotas públicas hoje: `/agente-ia/*`, `/anuncios/*`, `/saas/`, `/tpv/`, `/crm*` etc. ⚠️ Tailwind CDN é BLOQUEADO pelo CSP (`script-src 'self'`) → compilar local (`npx tailwindcss@3 -i input.css -o styles.css --minify` COM `tailwind.config.js` content apontando p/ o html) e subir o styles.css. Página publicada: `/agente-ia/analises/concorrentes/` (workaround dentro de rota já exposta; handle limpo `/analises/*` pendente p/ Abner aplicar com sudo).
