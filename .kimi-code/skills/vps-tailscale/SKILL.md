# SKILL — VPS Nexo via Tailscale (acesso direto)

> Entrada oficial na VPS Nexo pela tailnet. Registrado 2026-09-26 após
> validação ao vivo. Decreto owner: a Luna EXECUTA na VPS (sistemas Nexo),
> não precisa mais de intermediário humano.

## Acesso

```
ssh vps
```

Config já no `~/.ssh/config` desta máquina:

```
Host vps
    HostName 100.106.140.11      # tailnet (nexudo-mp100, Ubuntu 24.04)
    User nexo
    IdentityFile ~/.ssh/kimi-vps
    IdentitiesOnly yes
```

- Tailscale instalado e logado neste PC (desktop-eteleus, 100.76.122.118).
- `tailscale status` confirma os peers. Se o SSH falhar: checar `tailscale status` primeiro.
- SSH por IP público/porta 22 fica BLOQUEADO da rede local — a tailnet é o caminho.

## O que tem lá (docker, visto ao vivo 26/09)

Containers: `nexo-brain`, `nexo_workspace_cliente`, `nexo_workspace_nexo`,
`nexo_hdm_cv`, `nexo_relatorios`, `nexo_tpv_*` (vários).
Listar: `ssh vps 'docker ps --format "{{.Names}}\t{{.Status}}"'`

## nexo_relatorios (portal /relatorios) — estrutura de dados

Host path: `/home/nexo/Documentos/VPS/VPS/relatorios/`

- `public/clientes/<slug>/index.html` — relatório one-page de cada cliente
  (static, servido só com sessão). "Aba" = âncora `<section id="...">` + link
  na `.nav-links`. Estilo: `.section-tag`/`.section-title`/`.changelog-list`.
  Ícones via unpkg lucide (`data-lucide="kebab-case"` → PascalCase no bundle).
- `data/users.json` — acesso clientes: `{ "<email>": { "slug", "name", "brand" } }`.
  Login de cliente = email cadastrado, SEM senha. Relido a cada login
  (editar no HOST, não precisa reiniciar container).
- `data/cambios/<slug>.json` — registros do puesto de mando (API team).
- **GOTCHA mount:** `/app/data` é montado RO no container; só `data/cambios`
  é RW. Editar `users.json`/páginas SEMPRE no host (bind propaga na hora).
- **Auth:** cookie `nxrel` (HMAC, secret em `RELATORIOS_SESSION_SECRET` do
  container). Sem cookie: 303 → login. Team: emails em `RELATORIOS_TEAM_EMAILS`
  + senha (sha256 em env). Testar página com sessão: gerar cookie HMAC e
  `wget --header "Cookie: nxrel=<valor>"` (validado 26/09).
- Convenção de backup antes de editar página de cliente:
  `cp index.html index.html.bak-YYYYMMDD`.

## Nexo-brain (Atlas)

Container `nexo-brain` serve `/brain` (API leitura). Escrita = git no
principal-brain + `node atlas/generate.mjs` no clone da VPS. Ver skill
`brain-principal`.

## Regras

- VPS = sistema NEXO: mexer é permitido (diferente de projeto de cliente).
- Sempre backup antes de sobrescrever arquivo no host.
- Registrar toda mudança no diário (synapses) com o que mudou + evidência.
