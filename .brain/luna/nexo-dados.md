# Dados Nexo Digital (negócio do owner)

## WhatsApp comercial — GRAVADO 2026-09-25 (ordem do Abner: "grava na sua mente")

- **Número COMERCIAL da Nexo (negócio do Abner): +34 685 093 192** → wa.me/34685093192
- País: Espanha (Sabadell/Barcelona) — móvel espanhol de 9 dígitos.
- Uso: CTAs da landing Sabadell (`landing-sabadell/app/src/config.js` → WA_NUMBER)
  e qualquer botão "falar com a Nexo".
- ATENÇÃO: número COMERCIAL da Nexo. O grupo interno Production usa outro
  identificador (conversation_id `23ad6088-66a9-4ae3-93c1-35f5e59821dc`) — não confundir.
- VERIFICADO 2026-09-25: bundle ao vivo servindo o número (grep no JS do GitHub Pages).

## Time Nexo — contatos pessoais

- **Nonoke (Enoque Santos, dev do time): +34 689 13 51 59** → wa.me/34689135159
  (CORRIGIDO 2026-09-26 por decreto do Abner — o valor anterior estava salvo ERRADO:
  o brain misturava o número comercial da Nexo (+34 685 093 192) com o do Nonoke.
  O comercial continua sendo o 685 093 192; o pessoal do Nonoke é 689 13 51 59, Espanha +34.)

## Decretos relacionados

- Landing Sabadell v2 (React+Vite+Tailwind+Framer Motion+Lucide, mocks WhatsApp/Instagram):
  repo `Jhin1v9/luna-sabadell-landing`, clone local em `landing-sabadell/` (repo embedado,
  tem .git próprio — cuidado na sweep de commits do luna-agent).
- Preços: 490/89, 990/189, 1900/349 (setup/mensal), IVA não incluído.
- Modelo de venda: setup único + mensualidade sem permanência.
- Pendente de marketing (REVISION.md do repo): depoimentos reais de clientes, garantia de
  risco invertido, analytics.

## Repo legado — GRAVADO 2026-09-25

- `github.com/Jhin1v9/principal-brain` = base .brain ANTIGA (Luna v1.0, abr/2026):
  SYNAPSE (automação pós-commit), regras .brain, estrutura de pastas por cliente
  (`C:\Users\Administrator\Documents\NEXO DIGITAL\CLIENTES\...`).
- Pode conter memória histórica útil; o Abner mencionou no dia 2026-09-25
  (contexto: acesso/settings). Se precisar de conteúdo de lá, pedir acesso
  (repo privado — settings/access só abre logado com a conta dele).

## HDM — qual site é o de verdade (GRAVADO 2026-09-26, correção do owner)

- **Site REAL (novo, do Matheus): `hdm-six.vercel.app`** — Next.js, configurator de
  perfis, 4 slides de fundo no hero, ES/CA/EN/PT. É esse que deve ser analisado/revisado.
- `www.hdmindustrial.es` = site ANTIGO (Bootstrap, "Amplíe su equipo") — NÃO é o alvo
  de análises do time. Analisá-lo por engano gera relatório inútil (aconteceu 26/09).
- Apex `hdmindustrial.es` (sem www) tem SSL quebrado (ERR_SSL_PROTOCOL_ERROR).
- Achados 26/09 no site real: prefetch RSC 404 em todas as rotas (redeploy Vercel),
  faixa vazia gigante no mobile mid-page, botão "SOLICITAR PERSONAL" do footer gigante
  no mobile (report do Enoque confirmado), banner de cookies por cima do footer.
  Prints: .brain/luna/analises/2026-09-26-hdm-real-preview/

## Portal de relatórios (GRAVADO 2026-09-26)

- Container `nexo_relatorios` na VPS (127.0.0.1:13474), fonte em
  `/home/nexo/Documentos/VPS/VPS/relatorios/` (server.js node puro, sem deps).
- Páginas: `public/clientes/<slug>/index.html` (hdm, jr-reformas). Aba nova = seção
  `<section id="...">` + link no nav. Portal público: vps.nexo-digital.app/relatorios.
- Auth: equipe (email+senha sha256) vê tudo; cliente entra SÓ com email via
  POST /relatorios/entrar (urlencoded) — sem senha, role client isolado ao próprio slug.
  Clientes em data/users.json (relido por login, sem rebuild).
- Deploy de edição: editar o index.html no host (mount direto, sem rebuild nem restart).
