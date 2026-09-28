# Memória — JR Reformas (Juninho) (cliente)

> Decreto owner 2026-09-24: Luna entrou no grupo do cliente no WhatsApp.
> Este arquivo é a ficha canônica do cliente — grupo, jid, pessoas, rotas.

## Identidade

- **Cliente:** Reformas integrales / JR Reformas (Juninho)
- **Contato principal:** Juninho
- **Contexto:** projeto "Juninho web JR" existe no Nexo Workspace (org "JR Reformas"), com chat na sala do projeto

## Grupo WhatsApp do cliente (decreto owner 2026-09-24)

- **Nome:** `Reformas integrales - Projeto web(Juninho)`
- **JID:** `120363411799534605@g.us`
- **Membros:** Juninho + time Nexo (Luna via sessão do Abner)
- **Números pessoais:** o owner vai salvar como contato e complementar aqui
- **Regra de roteamento (decreto owner):** mensagem nova NO grupo → ingere e trata (responder no próprio grupo); resposta nossa → enviar NO grupo dele (chat_id = nome do grupo ou jid acima)

## Notas

- Ficha nova (24/09) — histórico de pedidos ainda não consolidado aqui; ver painel Nexo Workspace (projeto Juninho web JR) e `.brain/luna/pedidos-clientes.md`.

## Lead 2026-09-24
- **IA no Instagram:** no grupo do WhatsApp, Júnior perguntou se dá pra fazer "isso" (a Luna) no Instagram dele — interesse declarado em automação/IA pras redes do negócio de reformas. Lead repassado ao Abner no Production; aguardando retorno comercial.
- **24/09 16:15 UTC:** Júnior pediu o VALOR da IA pras redes ("So pra saber valor disso, depois voces me passam porfa"). Luna nao inventou preco; respondeu que o Abner passa os valores. Aguardando retorno comercial do Abner.

- 28/09 — Juninho vai abrir **WhatsApp Empresa** (começa hoje e segunda). Quando estiver no ar:
  oferecer ajuda com perfil (descrição, catálogo, link pro site). Contexto: Google Maps do JR
  Reformas já ativo; Enoque orientando anúncios Instagram (packs + formulário pendente).
- 28/09 (tarde) — Júnior confirmou: **app do WhatsApp Empresa JÁ INSTALADO**; vai configurar
  hoje e segunda. Luna mandou checklist rápido (foto/logo, descrição, categoria, link do site)
  e ofereceu ajuda na config segunda. Segunda-feira: cobrar se o perfil ficou pronto.
- 28/09 (noite) — Time abriu novo tópico no grupo: **resenhas do Google do Juninho** (ranquear
  no Maps). Luna ofereceu: link direto de avaliação do Google Business, mensagem padrão pro
  cliente e QR code. Aguardando confirmação + e-mail/conta do perfil pra puxar o link certo.
- 28/09 (noite) — **Material entregue** (task executada, msg `908f26f0`, grupo do Juninho):
  perfil confirmado = **JR REFORMAS INTEGRALES** (site reformasjr.es, Barcelona, coord
  41.4112,2.1816 — placeid `ChIJlSZu64GjpBIRHLNDRidlrF4`). Link direto de avaliação:
  `https://search.google.com/local/writereview?placeid=ChIJlSZu64GjpBIRHLNDRidlrF4`
  (abre formulário de estrelas; exige login Google de quem avalia). Mensagens padrão ES/PT
  enviadas no grupo; QR code enviado no Telegram do time (msg 5610, arquivo
  `tmp/qr-resena-jr-reformas.png`, gerador em `scripts/resolve-jr-placeid.cjs`).
- 28/09 (noite) — **⚠️ PERFÍL AINDA NÃO 100% CONFIRMADO.** Enoque informou: site do Juninho é
  **jr-reformas.com** ("Junior Reformas — Reformas integrales en Sabadell y Barcelona", tel
  +34 658 187 071). No Maps há DOIS candidatos: (1) JR REFORMAS INTEGRALES, Barcelona, tel
  640 78 62 77, site reformasjr.es — domínio MORTO ("Site en construction" OVH); (2) Reformas
  Y Servicios J Junior, Badalona, tel 931 76 33 21, sem site (placeid
  `ChIJVxIC4aa8pBIR6HgwwAeR4N4`). O material entregue foi pro perfil (1) — se o Júnior
  confirmar o (2), refazer link writereview + QR (`https://search.google.com/local/writereview?placeid=ChIJVxIC4aa8pBIR6HgwwAeR4N4`).
  Toda a área de atuação é Sabadell/Barcelona/Terrassa/Mataró. Pedido de confirmação enviado
  no grupo (msg `1083e945`).
- 28/09 (noite) — **CONFIRMADO pelo Enoque** ("isso esse mesmo"): perfil = **JR REFORMAS
  INTEGRALES** (opção 1). Material validado — link curto
  `https://search.google.com/local/writereview?placeid=ChIJlSZu64GjpBIRHLNDRidlrF4`, QR no
  Telegram (msg 5610), mensagens ES/PT no grupo. Recomendado: Júnior testar com a conta dele
  (msg `aa0c648d`). Observação: o tel do site (658 187 071) NÃO bate com o do perfil Maps
  (640 78 62 77) — se surgir divergência, investigar de novo.
- 28/09 (noite) — **❌ ERRO CONFIRMADO: o "CONFIRMADO" acima estava ERRADO.** Enoque testou o
  link e ele abre **outra empresa** ("JR iReformas Integrales" — nome quase idêntico, empresa
  diferente). O perfil REAL do Juninho é **"JR Reformas - Junior"** (Sabadell/Barcelona, tel
  +34 658 187 071 — bate com o site). Essa listagem **não aparece na busca pública do Maps**
  (busca por telefone 658187071 e por nome não retornam nada — lista nova/recém-renomeada, não
  indexada). **O link writereview e o QR (Telegram msg 5610) estão APONTANDO PRA EMPRESA
  ERRADA — nunca usar.** Correção pedida: Enoque/Júnior mandarem o link oficial do app Google
  Business (Perfil → "Peça uma avaliação"); com ele, refazer QR + validar + atualizar mensagens
  (pedido no grupo, msg `fab23b7d`; alerta no Telegram msg 5611). **Lição: nome parecido no
  Maps ≠ perfil certo — sempre validar tel/site com o time antes de entregar material de
  resenha. O placeid `ChIJlSZu64GjpBIRHLNDRidlrF4` é da empresa errada; o certo ainda é
  desconhecido.**
- 28/09 (noite) — **Dica do Enoque registrada:** nos posts/legendas do Instagram do Juninho,
  sempre referenciar **jr-reformas.com** (ajuda o ranqueamento local e facilita o cliente).
  Reforços que a Luna passou: link clicável só na BIO do feed; nos stories usar o adesivo de
  LINK (msg `4fa3138e`). Seguir cobrando isso quando o tema Instagram aparecer.
