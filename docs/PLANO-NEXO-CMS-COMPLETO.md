# PLANO COMPLETO — nexo-cms (modo edição fluido e completo)

> Autor: Luna · 2026-09-27 · decreto owner Abner ("plano completo de tudo que vai precisar, por área")
> Base: núcleo v0 já rodando na VPS (`/home/nexo/nexo-cms`, portas 13720/13721) + site HDM
> hospedado em `/previas/hdm-matheus`. Decisões de pesquisa: Moveable (MIT) p/ alças,
> contenteditable p/ texto inline, content-skin sobre sites estáticos.
> Legenda: ✅ pronto · 🟡 parcial · ⬜ a fazer

---

## 1. Editor visual (o coração — "edição fluida")
| # | Item | Status | Detalhe |
|---|---|---|---|
| 1.1 | Seleção de elemento por clique (hover com outline) | ✅ | v0 |
| 1.2 | Alças drag/resize/rotate (Moveable) + snapping/guias de alinhamento | ✅/⬜ | Moveable no ar; snapping/guias (elementEdgesDist, gap) pendentes |
| 1.3 | Edição de texto inline (contenteditable) com toolbar (negrito/itálico/link/lista) | 🟡 | v0 edita texto puro; toolbar richtext + sanitização DOMPurify falta |
| 1.4 | Redimensionar de lado/altura livre + manter proporção (img/vídeo) + reset | 🟡 | resize livre ok; trava de proporção e reset pendentes |
| 1.5 | **Arrastar elemento para outro container** (mover título p/ baixo, foto p/ onde não tava) | ⬜ | exige drop-zones + persistência de posição no modelo (parent+order) |
| 1.6 | Duplicar / remover / ocultar elemento ou seção | ⬜ | ações da toolbar do selecionado |
| 1.7 | Desfazer/refazer (undo/redo) global | ⬜ | pilha de operações (conceito colhido do repo legado) |
| 1.8 | Autosave (debounce) + indicador "salvando…/salvo" | ⬜ | hoje só salva no clique |
| 1.9 | Edição por idioma (abas ES/CA/EN/PT) e por breakpoint (desktop/mobile) | ⬜ | seletor no topo do editor; valores por dimensão |
| 1.10 | Painel de propriedades lateral (estilo rápido: cor do texto, alinhamento, margem) | ⬜ | complementa as alças |
| 1.11 | Preview "como visitante" (sair do modo edição sem logout) | ⬜ | toggle edição↔preview com o mesmo conteúdo draft |

## 2. Conteúdo (content model)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 2.1 | Atributo `data-cms="<locale>:<key>"` + runtime de aplicação | ✅ | runtime v0 (texto, alt, tema) |
| 2.2 | **Codemod**: mapear o site HDM inteiro (~500 keys × 4 idiomas) | ⬜ | varrer dictionaries/conteúdo → injetar atributos nos componentes; feito UMA vez por site |
| 2.3 | Tipos de campo: texto, richtext, imagem, vídeo, cor, número, URL, ícone | ⬜ | o tipo define o editor do popover |
| 2.4 | Schema por seção (campos permitidos, obrigatórios) via `cms.config.json` | ⬜ | evita editar o que não deve |
| 2.5 | Validação no client + no server (limite de tamanho, campos proibidos) | 🟡 | server valida key/value v0 |
| 2.6 | Espelhamento de idiomas: editar ES → sugerir tradução (IA) p/ CA/EN/PT | ⬜ | fase avançada; começa com abas independentes |
| 2.7 | SEO por página: title, description, OG (editável) | ⬜ | keys `meta.*` |

## 3. Mídia (fotos e vídeos)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 3.1 | Upload com validação (MIME allowlist, tamanho máx, nome aleatório) | ⬜ | mesma regra do Doc 09 do HDM |
| 3.2 | Biblioteca de mídia (grid, busca, pastas por site) | ⬜ | |
| 3.3 | Trocar/adicionar/remover imagem de qualquer slot; crop básico | ⬜ | crop client + reprocessar no server |
| 3.4 | **Galeria** (add várias fotos, ordem arrastável, legenda) | ⬜ | componente de galeria parametrizável |
| 3.5 | Otimização automática (sharp: webp/resize) + srcset | ⬜ | |
| 3.6 | Vídeo: upload → transcode (ffmpeg → H.264/HEVC 1080p ≤10–15MB) + poster | ⬜ | processa os MOV do Matheus |
| 3.7 | Alt text × 4 idiomas + registro de proveniência/licença | ⬜ | padrão mediaManifest do HDM |
| 3.8 | Slots "foto do time/projeto" reservados com placeholder estruturado | ⬜ | já existe no HDM — só plugar |

## 4. Tema / design
| # | Item | Status | Detalhe |
|---|---|---|---|
| 4.1 | Tokens editáveis: cores (base/superfície/accent), radii, sombras, fontes | ⬜ | grava em `theme` → runtime aplica via CSS vars |
| 4.2 | Picker de cor com contraste (avisa se texto some no fundo) | ⬜ | |
| 4.3 | Presets (claro/escuro/accent alternativo) com 1 clique | ⬜ | |
| 4.4 | Ajuste fino por elemento (cor local) sem quebrar o token global | ⬜ | |

## 5. Backend / API
| # | Item | Status | Detalhe |
|---|---|---|---|
| 5.1 | Auth admin (bcrypt + sessão HMAC + rate-limit) | ✅ | v0 |
| 5.2 | Draft/publish + GET público cacheado | ✅ | v0 |
| 5.3 | **Revisions**: toda publicação guarda versão; rollback em 1 clique | ⬜ | tabela `revisions` |
| 5.4 | Optimistic locking (409 em conflito de edição simultânea) | ⬜ | pesquisa recomendou |
| 5.5 | Multi-usuário (login do time: Abner/Eliás/Enoque) com papéis (admin/editor) | ⬜ | v0 é senha única |
| 5.6 | API de mídia (upload/download, signed URLs) | ⬜ | |
| 5.7 | Health/readiness + métricas simples | ⬜ | |
| 5.8 | Sanitização server-side de richtext (DOMPurify-equivalent) antes de publicar | ⬜ | |

## 6. Estrutura de páginas (fase avançada — alinhada ao dono)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 6.1 | Reordenar seções dentro da página (drag) | ⬜ | persistir `order` por seção |
| 6.2 | Ocultar/excluir seção com confirmação | ⬜ | |
| 6.3 | Duplicar seção | ⬜ | |
| 6.4 | Adicionar seção nova de um catálogo (hero, galeria, FAQ, CTA...) | ⬜ | requer rebuild parcial — definir limite com o owner |
| 6.5 | **Seção "Síguenos en Instagram"** (embed estilizado) + **seção perguntas→artigos** (estilo jr-reformas.com) | ⬜ | pedidos do owner: viram blocos do catálogo de seções |

## 7. Segurança
| # | Item | Status | Detalhe |
|---|---|---|---|
| 7.1 | Login sem brechas: bcrypt(12+), cookie HttpOnly/SameSite, rate-limit, lockout | ✅/⬜ | v0 ok; subir custo e add lockout progressivo |
| 7.2 | Rotacionar senha admin + segredo antes de expor público | ⬜ | |
| 7.3 | CSRF: token por sessão em toda escrita | ⬜ | |
| 7.4 | CSP restrita no editor + headers de segurança | ⬜ | |
| 7.5 | Uploads fora do webroot servido, com allowlist e limite | ⬜ | |
| 7.6 | Audit log completo (quem/o quê/quando) + visualização | 🟡 | tabela existe; falta UI |
| 7.7 | HTTPS via Caddy (já coberto pelo vps.nexo-digital.app) | ✅ | |

## 8. Integração com sites (reuso entre clientes)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 8.1 | `cms.config.json` por site (site_id, idiomas, schema, guardrails) | ⬜ | |
| 8.2 | Guia de integração: Next estático (HDM) → HTML puro → próximos | ⬜ | |
| 8.3 | Injeção do runtime no build/CI (script automático no publicar) | ⬜ | |
| 8.4 | **Guardrails de claims no publish** (regras do AGENTS.md do cliente: números proibidos, palavras proibidas, CTA correto) | ⬜ | bloqueia publicação com mensagem clara |
| 8.5 | Multi-site na mesma API (site_id isolado) | 🟡 | coluna existe; falta UI de seleção |

## 9. Infra / DevOps (VPS)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 9.1 | Docker compose (api+db) | ✅ | v0 |
| 9.2 | Caddy route público do `/edit` por prévia (ex.: `/previas/hdm-matheus/edit`) com auth | ⬜ | |
| 9.3 | Volume persistente p/ uploads + backups automáticos do Postgres (diário, retenção 7d) | ⬜ | |
| 9.4 | CI: rebuild da API no git push + migrate automático | ⬜ | |
| 9.5 | Repo git próprio do nexo-cms (GitHub privado) | ⬜ | hoje só na VPS |
| 9.6 | Monitoramento (uptime do api/db + alerta Telegram) | ⬜ | |

## 10. Experiência do editor (UX)
| # | Item | Status | Detalhe |
|---|---|---|---|
| 10.1 | UI em PT/ES | ⬜ | |
| 10.2 | Onboarding de 3 passos (primeiro login) + tour guiado | ⬜ | |
| 10.3 | Atalhos de teclado (Ctrl+S salvar, Ctrl+Z/Y, Delete remove) | ⬜ | |
| 10.4 | Estados claros: salvando/erro offline/fila de publicação | ⬜ | |
| 10.5 | Lista de rascunhos pendentes com diff resumido antes de publicar | ⬜ | |

## 11. Qualidade
| # | Item | Status | Detalhe |
|---|---|---|---|
| 11.1 | Testes unitários da API (auth, content, publish, guardrails) | ⬜ | |
| 11.2 | E2E Playwright: login → editar → publicar → visitante vê | ⬜ | |
| 11.3 | Checklist pré-cliente: acessibilidade dos overlays, mobile do editor | ⬜ | |

---

## Roadmap sugerido
- **Fase A — "Edição essencial fluida" (4–6 dias):** 2.2 codemod HDM · 1.3 toolbar+richtext · 1.8 autosave · 1.11 preview · 3.1–3.4 mídia+troca de imagem · 4.1–4.2 tema cores/radios · 5.3 revisions · 7.2–7.3 · 9.2 rota /edit · 8.4 guardrails · 10.4 estados. → **HDM editável de verdade.**
- **Fase B — "Completo" (5–7 dias):** 1.5 drag entre containers · 1.6 ações · 1.7 undo/redo · 1.9 idiomas/breakpoints · 3.5–3.7 otimização/vídeo/alt · 4.3 presets · 5.5 multi-usuário · 6.1–6.3 seções · 10.1–10.3.
- **Fase C — "Avançado" (5–8 dias):** 6.4 catálogo de seções · 6.5 Instagram + perguntas-artigos · 2.6 tradução IA · 5.8 richtext sanitizado · 9.3–9.6 robustez · 11 testes.

## Decisões do owner (fechadas 27/09)
1. ~~Senha admin~~ → **7741** (provisória; rate-limit ativo; trocar antes de expor público).
2. URL do editor →  (mesmo domínio).
3. Limite estrutura → seção nova = Fase C (catálogo + rebuild assistido).
4. UI do editor → PT primeiro, ES depois.
5. Estreia → **só o time Nexo**; cliente entra quando o owner avisar (estado pronto).
6. Teto de sessão e tabela de custos → configuráveis pelo admin (padrão 100).
