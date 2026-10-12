# Mobile audit + /refresh self-heal — 2026-07-13

> Pedido do dono: (1) modo mobile "lindo igual o desktop" — ele acessa a Luna de
> longe via `https://luna-app.duckdns.org:5173/` e precisa conseguir operar tudo
> do celular; (2) `/refresh` que de fato diagnostique e conserte (bridge caiu,
> soul parou) e avise corretamente, com reload como último recurso.
> Restrição: não tocar em mais nada — a Wave 8 ainda não tinha sido testada ao vivo.

## Auditoria mobile (Playwright headless, viewport 390×844, iPhone UA, login real via API)

| Tela | Antes | Depois |
|---|---|---|
| Login | ✅ boa | sem mudança |
| Welcome / input | ✅ boa | sem mudança |
| Sidebar (drawer) | ✅ boa | sem mudança |
| Cards do dashboard | ✅ boa | sem mudança |
| Tool cards | ✅ bons (inclui erro inline da Wave 8 T3) | sem mudança |
| **Header** | ❌ provider + persona + 5 botões transbordavam pra fora da tela (`overflow: visible`, nada escondido ≤640px) | ✅ tudo cabe em 390px |

### Header — antes vs depois

**Antes:** `header-right` completa em qualquer largura: pill de provider (140px) +
pill de persona (120px) + Compactar + Limpar + Exportar + Novo + Config. Em 390px
o persona aparecia cortado na borda e os últimos 4 botões ficavam fora da tela.

**Depois** (CSS-only em `ChatHeader.svelte`):
- ≤768px: Compactar/Limpar/Exportar saem do header (seguem acessíveis via
  `/limpar` e pelo drawer de configurações).
- ≤640px: pill de persona vira só emoji (🎭).
- ≤480px: pill de provider vira só emoji (🌐); moon-dots somem (avatar fica;
  home continua acessível pela sidebar); icon-btns 34→32px.
- Verificado com screenshot real: avatar + título + status + 🌐 + 🎭 + ➕ + ⚙️
  todos visíveis, nada cortado.

## /refresh — antes vs depois

**Antes:** limpava estado do frontend e chamava `connectSSE()` — que
*early-return* quando já conectado na mesma sessão, ou seja **nunca reconectava
nada**. Mensagem fixa "SSE reconectado" era mentira. Nenhuma verificação de
servidor. E se o problema fosse bridge/soul/serviço morto, nada era feito.

**Depois** (`runAgentRefresh({resume})` em `ChatArea.svelte`):
1. Limpa estado do frontend (igual antes).
2. **Diagnostica** via `/api/system/health`: soul pronta? bridge conectado?
   dashboard/vite/telegram no ar?
3. **API não responde** → avisa e faz reload da página em 10s (única ação
   possível quando o backend morreu; o watchdog costuma trazê-lo de volta em
   ~30s).
4. **Algo quebrado** → lista os problemas no chat, chama o novo endpoint
   `POST /api/system/selfheal` com os serviços afetados, faz poll de saúde a
   cada 3s (até 60s — o luna-server morre durante o próprio restart), força
   reconexão do SSE (disconnect antes, senão o early-return continua lá),
   reporta recuperado ou faz reload em 10s.
5. **Tudo saudável** → força reconexão real do SSE e confirma.
6. `/fullrefresh` = mesmo fluxo + mensagem de continuação do histórico.

Verificado ao vivo: `/refresh` com sistema saudável mostrou
"✅ Tudo saudável — Soul pronta, Bridge conectado. Estado limpo e SSE
reconectado à força."

## Self-heal endpoint — antes vs depois

**Antes:** `/api/system/restart` (e `/stop`, `/start`) dependiam de
`luna-nexo.sh` no caminho configurado `~/.luna/dashboard/` — **o arquivo não
existe lá** (a cópia real está em `~/NEXO_DASHBOARD_PRO/` e está desatualizada:
caminhos antigos, nome pm2 `telegram-bot` que não existe mais → abriria um bot
duplicado). Resultado: botões mortos que respondiam "Reiniciando..." e não
faziam nada.

**Depois:**
- Novo `apps/dashboard/lib/selfheal.cjs`: mapa allowlist de serviços → nomes
  pm2 canônicos do monorepo (`luna-server`, `nexo-dashboard`, `luna-vite`,
  `luna-telegram-adapter`), restart/stop via pm2 com delay de 600ms (resposta
  HTTP flusha antes do luna-server morrer), **nunca `--update-env`** (incidente
  da Wave 6), resolução do binário pm2 sem assumir home fixo.
- Novo `POST /api/system/selfheal` — reinicia só os serviços diagnosticados
  como quebrados (400 com lista de válidos para input inválido; testado ao vivo).
- `/restart` `/stop` `/start`: mantêm o script legado SE existir; senão caem
  no pm2. `/stop` deixa o luna-server vivo propositalmente (senão nada pode
  religar os demais via API).

## Testes

- `apps/dashboard/tests/selfheal.test.cjs` — 9 testes novos (mapa de serviços,
  dedup, allowlist, resolução do pm2, contrato das rotas, proibição de
  `--update-env`).
- Regressão completa: **249/249** (240 anteriores + 9 novos).
- `vite build` verde; screenshots mobile antes/depois em
  `/tmp/luna-mobile-*.png` (não versionados).

## Fora de escopo (registrado, não esquecido)

- O script `~/NEXO_DASHBOARD_PRO/luna-nexo.sh` continua desatualizado (paths
  antigos, nome `telegram-bot`, `--update-env` nos starts). Não é usado mais
  pelo servidor, mas se rodado manualmente pode criar um bot Telegram
  duplicado. Decisão do dono: corrigir ou apagar.
- Enter no input em modo touch não envia (esperado — mobile usa o botão de
  enviar). O sintoma reportado de "texto fica no input sem enviar" na Kimi web
  é do bridge, não deste frontend.
