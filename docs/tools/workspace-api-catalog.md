# Workspace API Catalog — vps.nexo-digital.app

> Mapa consolidado (2026-09-25, Luna). Acesso autenticado via
> `scripts/nexo-admin.mjs` (login NextAuth por EMAIL, cookie `nexo.session-token`
> renovável em `.brain/.vps_cookie`). Fonte: exploração ao vivo + clone do repo
> em `.brain/.nexo-workspace-src` (apps/workspace-nexo, Next.js App Router).

## Auth (NextAuth, prefixo de cookie customizado `nexo.`)
- `GET /nexo/api/auth/csrf` → csrfToken
- `POST /nexo/api/auth/callback/credentials` — form: `csrfToken`, `email`, `password`, `callbackUrl`, `json=true` → 302 + `nexo.session-token`
- ⚠️ autentica por EMAIL (NEXO_API_USERNAME=abner@nexo-digital.app no .env)

## Admin (`/nexo/api/admin/*`) — sessão admin
| Endpoint | Uso |
|---|---|
| `GET /nexo/api/admin/requests` | lista solicitações (todas as orgs) c/ projeto, `_count.comments` |
| `GET /nexo/api/admin/requests/<id>` | detalhe + **comments** completos (autor, data) |
| `POST /nexo/api/admin/requests` | CRIA solicitação p/ qualquer cliente {organizationId, projectId, content, status?, urgencyHint?} → 201 (commit cf139af) |
| `POST /nexo/api/admin/requests/<id>/comments` | comenta {content, visibility:"SHARED"} → 201 |
| `GET /nexo/api/admin/comments/<id>` | 405 (só POST — leitura via request detail) |
| `GET /nexo/api/admin/clients` | clientes/orgs |
| `GET /nexo/api/admin/chat/messages` · `/chat/projects` | chat interno |
| `GET /nexo/api/admin/calendar[/<id>]` | agenda |
| `GET /nexo/api/admin/analytics` · `/analyses` | métricas |
| `GET /nexo/api/admin/client-actions/<id>` | ações do cliente |

## Luna namespace (`/nexo/api/luna/*`) — BRAIN-ONLY, não usar direto
analyze-request · approve-request · create-comment · create-request ·
get-request · list-requests · reject-request — usados pela automação SYNAPSE
(constraint: org da sessão).

## IDs das orgs
| Cliente | organizationId | projectId |
|---|---|---|
| Jess / Ona Dance | cmshyy4nq0001eix2h7a8ose8 | cmshyy4os0003eix2tlfuic2o (Ona Dance web) |
| HDM / Matheus | cmtldsn6500067ahwsohd46vr | cmtldsn7400087ahwhrmgflvd (Main WebSite) |

## Outros apps na VPS
- **Dashboard pro**: `/dashboard/api/` (JWT próprio, catálogo em `docs/tools/nexo-api-catalog.md` — 16 tools de leitura)
- **Brain/Atlas**: `/brain/api/graph` (leitura aberta), `/brain/api/search?q=`, escrita só `POST /brain/api/learning/outcomes` (Bearer BRAIN_API_TOKEN). Fichas de clientes = git no `Jhin1v9/principal-brain` (`reports/clients/<slug>/`) + `node atlas/generate.mjs` no VPS.
- **Relatórios**: `/relatorios/` — app separado (login por form, cookie de sessão, clientes em `/relatorios/clientes/<slug>/`)
- **App cliente**: `/cliente` (NextAuth separado; POST `/cliente/api/requests` valida org da sessão)

## Padrões
- Escrita sensível (server actions) pode dar 405 em API — algumas ações só via UI (registrado).
- Falhas de auth → 302 p/ login (NextAuth), não 401 — tool trata.
