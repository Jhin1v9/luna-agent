# Parecer técnico — Fleetbase como base do Rottu (Luna/CTO, 12/10/2026)

> Pedido do owner (12/10, 20:54): veredito de viabilidade salvo no brain + sugestões de
> apps/repos open-source pra reaproveitar peças (transporte, GPS, pagamento etc.).

## Veredito

**NÃO usar o Fleetbase como base do produto. Viável apenas como referência de arquitetura
ou peça pontual de infra.** "Metade do trabalho feito" é otimista: é mais "uma peça de
infra com licença complicada".

## Por quê (4 razões)

1. **Modelo de negócio divergente.** Fleetbase é um TMS (gestão de frota/despacho de
   operador logístico com entregas próprias — last-mile, POD, order board). O Rottu é um
   **marketplace de cargas** (matching oferta/demanda caminhoneiro ↔ empresa, carga de
   retorno, precificação preditiva, swipe, score, dois perfis com regras diferentes).
   O core do Rottu — o produto em si — **não existe no Fleetbase** e seria greenfield de
   qualquer forma. Não existe "Uber de cargas" maduro em open-source (verificado) —
   isso valida construir o core.
2. **Licença AGPL-3.0.** Self-host sem modificar: livre. Modificar e servir via rede
   (exatamente o caso do Rottu): obrigado a publicar as modificações. App comercial
   fechado exigiria a licença comercial FCL deles (US$ 2.500–25.000 conforme uso) — aí
   viramos dependente do fornecedor, que é o que o reels criticava.
3. **Stack fora da nossa.** Fleetbase é PHP/Laravel + Ember. Nossa casa é TypeScript/Node
   (+ painel Next.js). Manter um fork PHP/Ember em produção = contexto novo pra operar,
   debugar e evoluir — custo contínuo alto pro time atual.
4. **Core continua por conta.** Mesmo com Fleetbase debaixo do braço, marketplace,
   matching, precificação preditiva, swipe e score seriam ~70–80% do trabalho real.

## Mapa de peças: o que PEGAR PRONTO vs CONSTRUIR

| Peça do Rottu | Fonte sugerida | Licença | Nota |
|---|---|---|---|
| Matching, precificação preditiva, score, swipe | **CONSTRUIR** | — | É a ALMA do produto; nada open resolve |
| Roteirização caminhão (raio+direção, carga de retorno) | **Valhalla** ou **GraphHopper** self-hosted | Apache 2.0 | Truck routing por parâmetro (peso/altura/eixos); OSM do Brasil via Geofabrik; ~10–20 GB RAM pra BR |
| Mapas no app | **MapLibre** + tiles OSM próprios (tileserver-gl) | BSD | Zero billing do Google no MVP |
| GPS/rastreio veículo (se usar rastreador físico) | **Traccar** | Apache 2.0 | Java, 200+ protocolos, REST API, geofence |
| GPS no app do motorista | lib de background geolocation (RN/Flutter) | MIT | Tracking in-app, sem servidor extra |
| Pagamentos (Pix, carteira, repasse) | PSP brasileiro: **Mercado Pago / Stripe BR** (API) | comercial | Não existe "app de pagamento" open que resolva; Pix é API |
| Ledger/carteira interna ("Meu Trecho") | construir simples (tabelas + conciliação); Kill Bill (Apache 2.0) só se escalar | — | Ledger próprio = controle do duplo histórico LGPD |
| Chat carga ↔ empresa | Socket.IO / Supabase Realtime (open) ou Stream (free tier) | MIT/comercial | Começar simples |
| Comprovante de entrega (foto+geo+assinatura) | construir | — | Simples, mas é identidade de marca |
| Push/notificações | FCM + APNs direto | — | Padrão |
| Backoffice/admin | padrão do nosso painel Nexo | — | Reaproveita casa |

## Arquitetura recomendada (composição, não fork)

```
App Rottu (Flutter ou RN — 1 codebase p/ motorista+empresa)
  ├─ MapLibre (mapas) ──► tileserver-gl (OSM BR)
  ├─ Rotas ──► Valhalla self-hosted (docker na nossa VPS)
  ├─ Pagamentos ──► Mercado Pago (Pix) / Stripe BR
  └─ Realtime (chat, posição viva) ──► Socket.IO

Backend Rottu (Node/TS — nossa stack)
  ├─ Matching engine + precificação preditiva + score (greenfield)
  ├─ Ledger próprio
  └─ API REST + webhooks

(Traccar só entra se surgir demanda de rastreador físico em caminhão)
```

## Recomendações ao time

1. **Spike do Enoque continua válido** — mas com escopo: ler o código do Fleetbase como
   *referência* (modelagem de orders/dispatch, POD, extensões), não como candidato a fork.
2. **Não pagar FCL agora.** Decisão de licença só faria sentido se a gente fosse operar
   frota própria — não é o caso do Rottu.
3. **Próximo passo real:** spike técnico de Valhalla com OSM do Triângulo Mineiro (dá pra
   subir em docker na VPS em 1 dia) — valida rotas de caminhão + raio+direção da carga de
   retorno, que é funcionalidade central.
4. Verificar licenças no repo oficial antes de incorporar qualquer peça (planilha acima é
   ponto de partida, não parecer jurídico).

## Fontes (consultadas 12/10/2026)

- Fleetbase: github.com/fleetbase/fleetbase — AGPL-3.0/FCL, PHP+Ember, ~2.3–4.2k estrelas
- Traccar: Apache-2.0, Java, REST API — múltiplas fontes
- Routing: OSRM (BSD/MIT), Valhalla e GraphHopper (Apache 2.0) — comparações Mapsi/PiStack
