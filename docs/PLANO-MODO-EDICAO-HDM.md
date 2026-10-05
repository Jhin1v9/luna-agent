# PLANO — Modo Edição (mini-CMS) do site HDM Industrial + integração das fotos reais

> Autor: Luna · 2026-09-27 · decreto owner Abner ("primeiro vem o plano, bora lá")
> Status: PLANEJAMENTO APROVADO PELA ANÁLISE — execução pelo time (Jhin/Enoque/Elias).
> Regra de ouro: este documento NÃO autoriza a Luna a modificar o repo do cliente; é o
> blueprint pra execução humana/assitida pelo time.

---

## 1. Análise total — o que existe hoje

### 1.1 As fotos/vídeos REAIS do Matheus (batch IMG_0078–0084)
Local: `C:\Users\Abner\Documents\HDM - Industrial\HDM INDUSTRIAL\docs\`

| Arquivo | Dimensões | Conteúdo (visto) | Uso recomendado |
|---|---|---|---|
| `IMG_0078.JPEG` | 2040×918 | Operário **com macacão HDM INDUSTRIAL** em escada montando estrutura inox, empilhadeira Crown | **Melhor ativo** — prova de pessoa+marca; candidata a hero (person-first) |
| `IMG_0080.JPEG` | 1536×2048 | Soldador TIG dentro de tanque inox, arco aceso | Perfil **soldador TIG** (substitui stock) |
| `IMG_0081.JPEG` | 1536×2048 | Máquina industrial (estrutura creme, hidráulica, ponte rolante) | Ambiente/ambience |
| `IMG_0082.JPEG` | 2000×1500 | Detalhe tanque inox com mangueiras e motobomba | Ambiente/ambience |
| `IMG_0079.MP4` | 4,3 MB | vídeo (não inspecionado) | candidato a clipe curto |
| `IMG_0083.MOV` | **116,7 MB** | vídeo grande (não inspecionado) | **precisa transcodar** (ffmpeg → H.264 1080p ≤ 10–15 MB) antes de qualquer uso web |
| `IMG_0084.MOV` | 16,9 MB | vídeo (não inspecionado) | transcodar |

⚠️ Regras de uso (docs do próprio projeto, AGENTS.md/Doc 02 §29): narrativa centrada na
**pessoa/profissional**; NUNCA insinuar que a HDM fabrica (várias fotos parecem fábrica);
**autorização de uso (DR-10) ainda pendente** — confirmar com o Matheus antes de publicar;
conteúdo dos vídeos precisa ser conferido com ele antes de assumir o slot de hero.

### 1.2 Logo
PDF oficial recebido 21/09 (`hdm-industrial\documentos\brand\hdm-logo-recebido-20260921.pdf`,
cópia idêntica na raiz). Pendente: extrair PNG transparente + favicon vetorial (ghostscript/
inkscape), confirmar versão final com o cliente (PENDING.md).

### 1.3 Mapa do site (repo `hdm-industrial`, branch real `luna/hdm-pedidos-matheus`)
- Next.js 16 **static export** (`output: "export"`, sem servidor), React 19, Tailwind v4,
  4 idiomas (ES raiz + /ca /en /pt), ~156 rotas, deploy manual via `scripts/publicar.sh`
  (verify → `vercel deploy --prod`).
- **Modelo de conteúdo em 3 camadas, tudo compilado em TS no build** (não há runtime CMS):
  1. `src/i18n/dictionaries/{es,ca,en,pt}.ts` — ~90% dos textos (~319 folhas × 4 idiomas);
  2. `src/content/*.ts` — registros (8 perfis, 5 soluções, 6 setores, 6 áreas de cobertura,
     companyFacts, claims/placeholders como guardrails);
  3. `src/content/mediaManifest.json` — 12 mídias com **alt por idioma** (48 alts).
- Tema: tokens no `@theme` de `src/styles/globals.css` (~15 cores, fontes Archivo/Plex Mono,
  rádios 2/4/6px) — trocar cores/radios = mexer só nesse bloco.
- **Superfície editável estimada:** ~450–500 textos por idioma (~1.900–2.000 no total ×4),
  12 imagens (+48 alts), ~30 entradas estruturais, ~25 tokens de tema.

---

## 2. Pesquisa — como deve ser um mini-CMS embutido (boas práticas)

Síntese do estado da arte (headless CMS + visual editing):
1. **Separar conteúdo de layout** — conteúdo como DADOS (JSON), não código; o site lê pelos
   mesmos acessores ([estrutura de conteúdo headless](https://www.afteractive.com/blog/best-practices-for-structuring-content-in-a-headless-cms)).
2. **Blocos reusáveis, tipos de conteúdo — não páginas** — o editor edita "hero.título",
   "perfil.soldador.faq[0].q", nunca "a página tal" ([abordagens de edição visual](https://unlayer.com/blog/visual-editing-approaches-headless-cms)).
3. **Edição visual por overlay** — clicar no elemento do próprio site e editar in-place
   (padrão [Sanity Visual Editing/Presentation](https://www.sanity.io/docs/visual-editing/visual-editing-with-next-js-app-router)):
   o melhor dos dois mundos = site real como preview, sem construtor de arrastar-e-soltar.
4. **Rascunho → publicar** — edições ficam em draft até publicar; o público só vê o publicado.
5. **Guardrails no caminho do publish** — o site HDM JÁ TEM isso (`check-claims.ts`, regras
   anti-números-inventados no AGENTS.md): o editor DEVE passar por essas checagens antes de
   publicar qualquer texto de marketing.
6. **Self-hosted enxuto** — [CMS self-hosted com builder visual](https://www.reddit.com/r/nextjs/comments/1my4jec/self_hosted_cms_with_visual_builder/):
   docker + Postgres + API própria basta; não precisa de SaaS externo.

Decisão de arquitetura que isso implica: **não migrar o site para SSR só pelo editor.**
O site é estático e deve continuar (performance, custo, robustez). O editor atua como uma
**"camada de conteúdo em runtime" (content skin)** por cima do estático — detalhe na §3.

---

## 3. Arquitetura proposta — Núcleo `@nexo/site-cms` (reutilizável, sem hardcode)

Pacote único reusado em TODOS os sites da Nexo. O site específico entra só via `cms.config.json`.

```
┌─ Browser (site estático como hoje) ─────────────────────────────┐
│  [data-cms="home.heroTitle"]  [data-cms="media:profile-tig"]    │
│  cms-runtime.js (3KB): fetch /api/content → aplica textos,      │
│  imagens e TEMA (CSS vars) → edições refletem NA HORA           │
└──────────────┬──────────────────────────────────────────────────┘
               │ GET /api/content?site=hdm (só published)
┌─ VPS (docker compose) ──────────────────────────────────────────┐
│  caddy ─┬─ hdm.nexo-digital.app      → static out/ (o site)     │
│         ├─ hdm.nexo-digital.app/edit → painel admin (senha)     │
│         └─ hdm.nexo-digital.app/api  → cms-api (Fastify/Next)   │
│  app (1 container): serve o out/ + a API + o overlay editor     │
│  postgres (1 container): conteúdo, tema, mídias, audit          │
└─────────────────────────────────────────────────────────────────┘
```

### 3.1 Componentes do núcleo (todos site-agnósticos)
| Componente | Função |
|---|---|
| `cms-runtime` | Script client 3KB: lê JSON de conteúdo, substitui `[data-cms]` (texto, src de imagem, alt) e aplica tema via CSS variables. Cache + invalidação por versão. |
| `cms-editor` | Overlay de edição: login admin → toolbar → clique em qualquer `[data-cms]` → popover inline (textarea / upload de imagem / cor) → salvar (draft). Abas por idioma. |
| `cms-api` | Rotas: `POST /edit/login` (bcrypt, cookie HttpOnly), `GET/PUT /api/content/:key` (draft), `POST /api/publish`, `POST /api/media` (upload → `/uploads`, MIME allowlist), `GET /api/content` (published, público e cacheado). |
| `cms-codemod` | Script que instrumenta um site Next estático UMA vez: mapeia dictionaries/conteúdo para atributos `data-cms="<locale>:<keypath>"` nos componentes. |
| `cms.config.json` (por site) | `{ siteId, locales, editable: {...}, guardrails: {...} }` — único arquivo específico. |

### 3.2 Banco (Postgres, migração simples)
```sql
content(site_id, key, locale, value, status draft|published, updated_by, updated_at)
theme(site_id, tokens jsonb, status, updated_at)
media(site_id, id, file, alts jsonb, status, updated_at)
audit(id, site_id, actor, action, key, at)
```
O **build continua existindo**: o `cms-codemod` gera `content.json` inicial a partir dos
dictionaries atuais; o runtime sobrepõe publicado > build. Estrutura (novas seções/páginas)
continua exigindo rebuild via `publicar.sh` — textos/imagens/tema/cores/radios são **instantâneos**.

### 3.3 O que dá pra editar (superset do pedido)
- ✅ Todos os textos de todas as páginas (mantendo hierarquia: H1 continua H1 — o editor edita
  o CONTEÚDO do nó, nunca a tag)
- ✅ Bordão/slogan (H1 do hero + eyebrow + lead)
- ✅ Todas as fotos (upload novo ou escolher da biblioteca de mídia; alt em 4 idiomas)
- ✅ Cores (tokens do `@theme`), arredondamento (radios), tipografia
- ✅ Vídeo do hero (transcodado)
- ⛔ Estrutura/seções novas → rebuild pelo time (fora do escopo do editor)

### 3.4 Segurança
- Senha admin: hash bcrypt em env (`CMS_ADMIN_HASH`), cookie de sessão assinado (mesmo padrão
  do portal /relatorios), rate-limit no login, 2FA opcional depois.
- Upload: MIME allowlist + limite de tamanho + nome aleatório (igual às regras do Doc 09).
- Guardrails: antes do publish, o `cms-api` roda as mesmas checagens de claims do repo
  (números proibidos, palavras proibidas: líder/excelencia/innovador...) — publicação bloqueia
  se quebrar (com mensagem clara pro editor).
- NADA de credencial no repo/brain (regra do time).

---

## 4. Plano de execução (fases)

**Fase 0 — Preparo de ativos (meio período)**
- Extrair PNG transparente + favicon do PDF oficial do logo; confirmar versão final c/ Matheus.
- Transcodar vídeos (ffmpeg → H.264 1080p; alvo ≤ 10–15 MB cada); conferir conteúdo com ele.
- Colher autorização de uso das fotos (DR-10) e confirmar narrativa (pessoa-first, sem "fabricamos").

**Fase 1 — Núcleo reusável `@nexo/site-cms` (2–3 dias)**
- Docker compose: app + postgres + caddy; CI de build da imagem.
- Auth /edit + sessão; content API (draft/publish); cms-runtime; editor overlay básico
  (texto + imagem + alt por idioma).

**Fase 2 — Instrumentar o HDM (2 dias)**
- `cms-codemod` no repo (branch nova `feat/modo-edicao`): mapear ~500 keys × 4 idiomas para
  `data-cms`; converter dictionaries para JSON consumido pelos mesmos acessores (sem reescrita
  de componentes); expor tokens de tema como CSS vars.
- Guardrails de claims no publish.

**Fase 3 — Fotos reais + mídia + VPS (1–2 dias)**
- Subir IMG_0078/0080/0081/0082 (otimizadas) + vídeo transcodado; trocar slots stock→real
  (hero person-first, TIG no perfil, ambience nas seções de confiança).
- Media library com upload (o Matheus poderá mandar fotos novas direto pelo /edit depois).
- Cutover de hospedagem: build no VPS, Caddy + SSL, DNS do preview; Vercel vira fallback.

**Fase 4 — Hardening + docs (1 dia)**
- Backup automático do Postgres; audit log visível; rate limit; runbook pro time;
  template `cms.config.json` documentado pra reutilizar no próximo site (Jess, Jr Reformas...).

**Estimativa total: 6–8 dias úteis de dev.** Primeiro deliverable executável: Fase 0 + 1.

---

## 5. Decisões que precisam do Abner/time antes de codar
1. **Hospedagem**: confirmar migração Vercel → VPS (plano prevê VPS como primário; custo ~0, performance equivalente p/ estático).
2. **URL do editor**: `/edit` no mesmo domínio (recomendado) ou subdomínio `edit.`?
3. **Senha admin**: quem define/quem guarda (recomendo: hash no env da VPS, 1 senha forte do time, trocar a cada 90d).
4. **i18n no editor**: edição espelhada (edita ES e a IA traduz?) ou 4 abas independentes (recomendado começar com 4 abas; tradução assistida vem depois).
5. **Escopo de estrutura**: confirmar que "adicionar/remover seções e páginas" fica FORA do editor (é rebuild pelo time).

---

## 6. Referências
- Estrutura de conteúdo headless: https://www.afteractive.com/blog/best-practices-for-structuring-content-in-a-headless-cms
- Abordagens de edição visual: https://unlayer.com/blog/visual-editing-approaches-headless-cms
- Visual editing Next.js (padrão Sanity): https://www.sanity.io/docs/visual-editing/visual-editing-with-next-js-app-router
- CMS self-hosted c/ builder visual: https://www.reddit.com/r/nextjs/comments/1my4jec/self_hosted_cms_with_visual_builder/
- Mapa do site + inventário de mídia: ver `.brain/luna/analises/` (análises 26/09) e este documento §1.

---

## 7. Status da execução (27/09)

- [x] **Site no VPS**: branch `main` (com fotos reais do Matheus + logo oficial integradas pelo
      time) em Docker (node20→nginx) em `https://vps.nexo-digital.app/previas/hdm-matheus`
      (Caddy via API admin, strip prefix; basePath via env + patch de deploy de refs `/images/`
      SOMENTE no diretório de deploy — repo do cliente intacto). Botão "Ver prévia" no relatório.
- [x] **Decisão de pesquisa (EN/ES/PT/ZH/RU)**: núcleo do editor = **Moveable** (MIT) sobre o DOM
      existente + contenteditable + API própria. GrapesJS/Puck/Craft descartados (document model
      próprio / React-only / sem UI).
- [x] **nexo-cms v0 no VPS** (`/home/nexo/nexo-cms`): API auth (bcrypt+HMAC+rate-limit), content
      draft/publish, theme, audit; runtime 3KB; editor overlay demo. Ciclo completo validado.
      Portas 127.0.0.1:13720/13721 (não públicas ainda).
- [ ] Codemod `data-cms` no site HDM · media library · tema visual · guardrails de claims ·
      rota pública do `/edit` · migração de layout entre containers (fase avançada).
