# HDM Industrial — PEDIDOS (via API do workspace, dados puros)

> Fonte: painel Nexo Workspace (org `cmtldsn6500067ahwsohd46vr`, projeto "Main WebSite"),
> lido ao vivo em 2026-09-24 via `scripts/nexo-admin.mjs` (acesso API confirmado).

## Solicitação c6kjmmkugoa1h4gnviecd06lh — "Carrossel + profissões + logo" (ANALYZING)

Pedido original (2026-09-21): (1) carrossel/slider de imagens em movimento;
(2) profissões novas: eletromecânico e mecânico industrial; (3) aplicação da
logo própria (PDF recebido 21/09/2026, guardado em documentos/brand/).

### Resposta do Matheus (2026-09-24 10:45, comentário no painel) — CONTEÚDO OFICIAL

- **Carrossel**: imagens passam **automaticamente**, **só na primeira parte** (hero da home).
- **Imagens próprias**: enviam quando tiverem; até lá usar imagens industriais licenciadas (placeholder).
- **Eletromecânico**: "instala, faz a manutenção e repara máquinas com
  componentes elétricos e mecânicos. Identifica avarias, troca peças, faz
  ligações elétricas e ajusta motores."
- **Mecânico industrial**: "instala, faz a manutenção e repara máquinas de
  fábricas. Identifica avarias, troca peças desgastadas e ajusta componentes
  para evitar paragens na produção."
- **Logo**: versão **FINAL** confirmada (aplicar no site).

### Perguntas em aberto para a equipe (NEXO)
1. Slider automático: implementar com autoplay no hero; decidir velocidade/transição.
2. Publicar as duas profissões novas com as descrições OFICIAIS acima (texto puro do cliente — usar como está).
3. Aplicar logo final (ficheiro em documentos/brand/).
4. Aguardar fotos próprias do cliente futuramente (trocar placeholders).

## Solicitação cmub9zxnq0011k011dz4f8qso — "Aba de currículos" (CLIENT_REVIEWING)

Seção/aba onde funcionários enviam currículos, direcionado ao e-mail
rrhh@hdmindustrial.es. Aguardando revisão do cliente.

## Solicitação cmu11j7av002oju6hmb4zkur1 — "Scroll reveal" (COMPLETED 2026-09)

Animação de scroll reveal implementada. Fotos da equipe: cliente ainda não tem
(usar imagens gratuitas placeholder até lá — sem data definida).

---
data + autor: Luna · 2026-09-24 · fonte: GET /nexo/api/admin/requests/<id> (HTTP 200)

## STATUS 2026-09-24 22:13 — IMPLEMENTADO (branch luna/hdm-pedidos-matheus, commit 2a5fd84)

- [x] Carrossel automático só na primeira parte — HeroRotator (Ken Burns,
      crossfade 1.4s, 4 fotos licenciadas registradas, reduced-motion OK)
- [x] Profissões eletromecânico + mecânico industrial — perfis, pictogramas
      proprietários novos, descrições OFICIAIS do Matheus em 4 idiomas, schema,
      blurbs. npm run verify COMPLETO (156 páginas, SEO OK)
- [ ] Logo final — PDF não está no repo (aguardando arquivo; Matheus avisado
      no painel, comment cmug39bs4000o114rin6kb2hn)
- [ ] Fotos próprias do cliente — placeholders licenciados até envio (combinado)
- DECISÃO ARQUITETURA: implementado na PLATAFORMA NOVA (Next.js, ainda não
  publicada); publicação = ação manual do owner (deploy hook). Site antigo em
  www.hdmindustrial.es continua no ar até lá.
