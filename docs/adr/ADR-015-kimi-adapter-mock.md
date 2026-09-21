# ADR-015 — KimiAdapter com modo mock: interface estável sobre API experimental

- **Status:** aceito (2026-09-21, F1.3)
- **Contexto:** §7.3/ADR-010 — o Cérebro Vivo roda numa sessão persistente do
  Kimi Code, acessível via `kimi web` local (REST/WebSocket em 127.0.0.1,
  nunca exposto à internet).

## O que foi sondado (kimi 0.42.0, 2026-09-21, instância real local)

- `kimi web` sobe servidor em `127.0.0.1:58627` com bearer token (401 sem
  token). Confirmado ao vivo.
- REST **estável e verificada**: `GET /api/v1/meta`, `GET/POST /api/v1/sessions`
  (criação exige `metadata.cwd`), `GET /api/v1/sessions/:id/messages` (leitura).
- **Envio de turno não existe na REST.** A UI bundled envia tudo via WebSocket
  `ws://…/api/v1/ws` com protocolo próprio (`client_hello`, frames de turno),
  **não documentado** — o bundle minificado é a única especificação. Sondagem
  WS com cliente nativo do Node não estabeleceu o handshake de turno.

## Decisão

1. `@luna/agent` expõe `KimiLiveAdapter` — interface estável
   (`ensureSession`, `sendTurn`, `readMessages`). O resto do sistema programa
   contra ela, nunca contra endpoints.
2. Modo **`mock` (default dev/testes)**: determinístico, sem rede, sem tokens.
   Resposta deixa explícito que é stub (`[mock-luna] …`) — não é mensagem de
   cliente e não pode ser confundida com produção.
3. Modo **`kimi-web`**: gerencia sessões via REST (funciona hoje), mas
   `sendTurn` lança `KimiWebTurnError` com instrução clara. Quando o protocolo
   WS for mapeado, só essa implementação muda — a interface não.
4. Segurança (§7.3): o adapter **recusa URLs não-loopback**; token só via env
   (`KIMI_WEB_TOKEN`), pino redige se logado.

## Por quê não esperar o WS mapeado

O marco da F1.3 é o ciclo evento → contexto → cérebro → resposta → evidência.
Bloquear a fase inteira num protocolo experimental e não documentado viola
"Simple Until Complexity Is Earned". O mock dá determinismo para testes; o
REST real já prova a conectividade; o WS entra como troca pontual de backend.

## Consequências

- `KIMI_ADAPTER_MODE=mock` é o default; produção migra para `kimi-web` quando
  `sendTurn` for implementado (mapeamento do WS, provável F1.3.x).
- `readMessages` no modo kimi-web já lê o histórico da sessão (base do
  §20 run buffer com cursor no futuro).
