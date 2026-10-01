# Toolkit da Luna (scripts/ — genéricos, variável aberta, NUNCA node -e ad-hoc)

- `wa-send.mjs --chat X --text Y [--quote Z]` — envia como Luna (resolve por ILIKE, aborta se ambíguo)
- `wa-read.mjs --chat X [--limit N]` — lê mensagens ✅ testado
- `wa-ingest.mjs --chat X` — sweep one-shot isolado de um chat
- `wa-call.mjs --to X [--motivo M]` — ligação (precisa Chat Registry + VOICE_CALL_ENABLED)
- `wa-peek.mjs shot|search|open|unarchive` — olhos no WA Web via CDP:9333 (dump DOM sempre; print best-effort — compositor trava quando Chrome oculto)
- `screen-shot.mjs [--nome X]` — **captura GDI real da TELA inteira via PowerShell (SetProcessDPIAware + VirtualScreen)** — o que o owner vê eu vejo; infalível p/ duvidar de qualquer UI. commit b786225
- `painel-api.mjs <VERBO> <rota> [--body] | relogin` — painel VPS ✅ testado
- `brain-api.mjs <GET|POST> <rota> [--body|--file|--type|--title]` — brain remoto ✅ testado
