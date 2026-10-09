# Dados Nexo Digital (negócio do owner)

## WhatsApp comercial — GRAVADO 2026-09-25 (ordem do Abner: "grava na sua mente")

- **Número do ABNER (owner) = número COMERCIAL da Nexo: +34 685 093 192** → wa.me/34685093192
  (CONFIRMADO 2026-09-26 pelo próprio Abner no grupo: "eu sou abner grava meu numero 685093192".
  O comercial da Nexo É o número pessoal dele — por isso a confusão histórica com o Nonoke.)
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

## HDM — referência canônica (ATUALIZADO 2026-10-02, decreto owner 02/10 00:26)

- **Site REAL (novo, do Matheus): `hdm-six.vercel.app`** — Next.js, configurator de
  perfis, 4 slides de fundo no hero, ES/CA/EN/PT. É o ÚNICO alvo de análises/revisões do time.
- **DECRETO OWNER:** domínio próprio (`hdmindustrial.es` / `hdm-industrial.es`) é decisão FUTURA do
  owner — NÃO listar como pendência, NÃO monitorar DNS/SSL. Time trabalha no preview até novo decreto.

- `www.hdmindustrial.es` = site ANTIGO (Bootstrap, "Amplíe su equipo") — se aparecer em análise por
  engano, descartar (aconteceu 26/09, relatório inútil). Nenhuma ação sobre ele.
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

## Decretos owner — cron adaptativo + Tailscale — GRAVADO 2026-09-27 (ordem direta do Abner nesta conversa)
1. **Cron adaptativo (sem rodadas à toa)**: tarefa cron só roda quando há mensagem/pendência real.
   - Menção/msg com @luna no grupo → dispara na hora (a automação Geral já faz isso via condition).
   - Caso contrário, cadência em escada: base 15 min → 2 runs seguidos sem nada = 30 min → mais 2 = 1h (teto);
     ao aparecer pendência, reseta pra quente: 2 min → 10 → 15 (rampa de volta à base).
   - IMPLEMENTADO 27/09 no "Luna — Cron de varredura (negócio + projetos)" (automation_27b0babd):
     gatilho condition poll 1 min (Python, sem créditos) + conditions/sweep_ladder.py lê
     .brain/.sweep_cadence.json {sweptAt, quietStreak, nextDelayMin}; o AGENTE escreve o estado ao final de cada run.
2. **Acesso à VPS = Tailscale, sempre**: ssh alias `vps` (config ~/.ssh/config) → usuário nexo@100.106.140.11
   (desktop-eteleus ↔ nexudo-mp100). Porta 22 pública bloqueada da rede local — NÃO usar root@IP público.
   Kimi entra sempre pelo Tailscale. Relatórios estáticos: /home/nexo/Documentos/VPS/VPS/relatorios/public/
   (bind mount no container nexo_relatorios — atualização live, sem rebuild; auth própria: clientes por e-mail
   em data/users.json, equipe por e-mail+senha).

## Sistema de notificações do workspace (GRAVADO 2026-10-02)

- Enoque montou o sistema de envio de notificação sobre a base existente, com templates
  prontos e detecção de idioma da pessoa (e-mail vai no idioma certo).
- Decisão de produto (Abner): campos de notificação (e-mail + telefone) ficam SEPARADOS do
  e-mail de login, configuráveis por perfil no cadastro do cliente.
- PENDENTE pra fechar: preencher os e-mails/telefones REAIS dos clientes (Jess notificada a
  partir de 02/10). Pop-up pra obrigar preenchimento foi adiado por decisão do Enoque.
- Futuro (decidido em conversa): integração WhatsApp — solicitação do cliente chega pra equipe;
  resposta da equipe vai pro grupo/privado da pessoa. Alternativa barata citada: APIs ou SMTP+WhatsApp.
- Futuro (ideia do Abner): sistema de medição do consumo de tokens/recursos da Luna,
  integrado ao relatório quando a operação crescer.

---

## 2026-10-02 20:30 UTC — Infra: apps atualizadas na VPS + plano de novos apps (Enoque)

- Várias apps atualizadas hoje na VPS, "tudo em dia, não deveria estar falhando nada" — update de
  infra/brain será subido em breve.
- **Plano:** preparar 20-22 apps novas/bases. Fluxo: base no Google Drive → GitHub → avaliar VPS.
  Meta: 25-30 apps novas até novembro (se sair algum nicho, aproveitar).
- autor: Luna (registro do comunicado do Enoque no Production)

## 2026-10-07 — Portfólio de apps: CeroDudas
- Mencionada no Production: "CeroDudas — Calculadoras Laborales para España" — provável app nova do pipeline do Enoque (20-22 apps em preparo). Registrada como candidata; confirmar com Enoque.
