# Pedidos de Clientes — painel Nexo (VPS)

Baseline da primeira varredura autônoma (2026-09-24). Fonte: `/nexo/api/admin/requests` (login NextAuth como ADMIN).
Colunas: data do pedido · cliente (org) · projeto · status · resumo.

> **Nota operacional (brain remoto):** o brain remoto rejeita escrita sem API key de
> servidor (HTTP 401). Escrita local em `.brain/` continua funcional; não tentar burlar.

## Abertos / em andamento (clientes)

| Data | Cliente | Projeto | Status | Pedido |
|---|---|---|---|---|
| 2026-09-21 | HDM - Industrial | Main WebSite | ANALYZING | Carrossel/slider de imagens em movimento; novas profissões (eletromecânico, mecânico industrial); aplicar logo própria (PDF recebido 21/09, em documentos/brand/). 1 comentário. |
| 2026-09-21 | HDM - Industrial | Main WebSite | CLIENT_REVIEWING | Seção/aba de envio de currículos dos funcionários, com envio direcionado a rrhh@hdmindustrial.es. 3 comentários. |
| 2026-09-10 | Ona Dance | Ona Dance web | CLIENT_REVIEWING | Trustpilot — revisar aviso/configuração no wp-admin (brtpmj-...). 1 comentário. |
| 2026-09-10 | Ona Dance | Ona Dance web | CLIENT_REVIEWING | Produtos esgotados — adicionar "Avísame cuando vuelva" com captura de e-mail. 1 comentário. |
| 2026-09-10 | Ona Dance | Ona Dance web | CLIENT_REVIEWING | Home — mostrar só produtos disponíveis em "Relacionados/Destacados". 0 comentários. |

## Concluídos recentes (referência)

| Data | Cliente | Projeto | Status | Pedido |
|---|---|---|---|---|
| 2026-09-16 | Ona Dance | Ona Dance web | COMPLETED | Crear nuevo cupón |
| 2026-09-14 | HDM - Industrial | Main WebSite | COMPLETED | Animação de scroll reveal no site (6 comentários) |

## Itens internos Nexo (não são pedidos de cliente)

Projeto "Projetos Dashboard" (org Nexo, workspace owner): 9 itens de ago/2026 — revisar/migrar VPS,
backup, anúncios Instagram/TikTok (IN_DEVELOPMENT), modificar formulário de clientes (PREPARING_SOLUTION),
modificar web Nexo (RECEIVED). Acompanhados internamente, fora do escopo deste arquivo.

---
*2026-09-24 · autor: Luna (varredura autônoma)*
