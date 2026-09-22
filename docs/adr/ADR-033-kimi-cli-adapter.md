# ADR-033 — Cérebro Vivo via `kimi` CLI headless (KimiCliAdapter)

- **Status:** aceito (2026-09-22, plano P1 — ponte FAST↔LIVE)
- **Contexto:** o HANDOFF_LIVE (§6) precisava de um "live brain" real e o
  canal admin (Telegram) de um executor com ferramentas nativas. O kimi web
  REST só tinha leitura estável (ADR-015 — sendTurn via WS experimental).
  O binário local `kimi` 0.42.0 oferece modo headless completo.

## Decisão

1. **`kimi -p "<prompt>" --output-format stream-json`** é a primitiva do
   Cérebro Vivo: NDJSON estável na stdout (`role:assistant` com o texto,
   `meta/session.resume_hint` com o session_id). `--output-format` aceita
   só `text|stream-json` (sondado ao vivo `--help`).
2. **Sessão persistente por diretório de trabalho**: cada `session_key` do
   adapter mapeia para um dir fixo (`~/.luna/kimi-cli-sessions/<key>/`);
   o 1º turno roda sem flag, os seguintes com `-c/--continue` ("continue a
   sessão anterior DESTE diretório"). Validado por smoke real: o 2º turno
   lembra o conteúdo do 1º.
3. **Interface estável preservada** (`KimiLiveAdapter`): `sendTurn`,
   `ensureSession`, `readMessages`. Mode novo: `'kimi-cli'`.
4. **Timeout de parede** por turno (default 10 min): em timeout o processo
   é morto (árvore, via `taskkill /T` no Windows) e o erro é explícito.
   Turnos da MESMA session_key são serializados (fila em memória).
5. **Limites explícitos** (nunca silêncio): `image_base64` → erro (modo -p
   não aceita imagem; visão continua no kimi-api); `readMessages` → `[]`
   (histórico só existe dentro da sessão do CLI); exit != 0 → erro com
   stderr; resposta vazia com exit 0 → erro.
6. **Autonomia configurável**: `-y` (yolo) ou `--auto` para ordens do
   canal admin; default sem flag (o CLI pergunta — seguro para testes).
7. **Testes com spawn injetado** (processo fake, nada de rede/CLI real);
   um smoke real com o binário local validou auth, parse e persistência.

## Consequências

- O HANDOFF_LIVE (P2) e o canal admin (P3) rodam o mesmo binário que o
  time usa — skills, MCP e ferramentas nativas do Kimi Code disponíveis.
- Custo: cada turno spawna um processo (~2-9s medido no smoke). Aceito
  para investigações e ordens admin (baixa frequência).
- O cwd do processo é o dir da sessão, NÃO a raiz do projeto — ordens que
  precisam operar no repo devem informar caminho absoluto no prompt (P3).
