# 🌙 Luna Installer

Instala a stack Luna completa (luna-agent + luna-kernel + Postgres + pm2 + WhatsApp)
em qualquer PC — Windows ou Linux — com um comando. Sem paths hardcoded: o instalador
pergunta o diretório e deriva tudo dele.

## Um comando (digita e toma)

**Windows** (PowerShell como Administrador não é obrigatório, mas recomendado):

```powershell
irm https://raw.githubusercontent.com/Jhin1v9/luna-agent/main/scripts/install/install.ps1 | iex
```

**Linux / macOS**:

```bash
curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-agent/main/scripts/install/install.sh | bash
```

**Windows (Git Bash)** — se preferir o .sh no Windows:

```bash
curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-agent/main/scripts/install/install.sh | bash
```

## O que o instalador faz

1. **Verifica dependências** — git, Node ≥ 22, pnpm (corepack), Docker, pm2 (instala se faltar)
2. **Pergunta o diretório** de instalação (default `~/luna` / `%USERPROFILE%\luna`)
3. **Clona** `luna-agent` + `luna-kernel`
4. **Configuração** — duas opções:
   - **Importar** `.env` + `config/providers.json` + `roda/providers.json` + `.env` do kernel
     de uma instalação que já funciona (ex.: seu PC atual) — a roda de providers e as
     sessions chegam prontas; **perfil do Chrome WhatsApp é copiado junto (sem QR de novo)**
   - **Gerar** `.env` novo interativo (baseado no `.env.example`)
5. **Sobe Postgres 16** em Docker (porta 5433) se o banco for local
6. **pnpm install** nos dois repos + **migrações** + builds (painel :3101, luna-web)
7. **Gera ecosystem pm2** (`luna-stack.ecosystem.config.js`) com paths dinâmicos e sobe:
   orchestrator (:3100), worker, whatsplay, painel (:3101), luna-server, nexo-dashboard (:3456)
8. **Pareamento WhatsApp** — abre o WhatsApp Web com o QR por 3 min (`pnpm --filter whatsplay login`)
9. **Health checks** + resumo final com os comandos do dia a dia

## Migração para outro PC (a máquina "digita e toma")

Na máquina que já funciona, guarde:

- `luna-agent/.env` — todas as keys e configs
- `~/.luna/chrome-whatsapp/` — **sessão WhatsApp pareada** (o `Login Data`/cookies do perfil)
- `luna-agent/config/providers.json` — a roda de providers
- `luna-kernel/roda/providers.json` — roda standalone do kernel (se existir)

Copie esses itens pro pendrive/nuvem. Na máquina nova, rode o instalador e escolha
**"Importar de instalação existente"** apontando a pasta. A Luna sobe com a roda de
providers e o WhatsApp **já pareado** — sem QR, sem reconfigurar nada.

> ⚠️ O `.env` e o perfil do Chrome contêm secrets — nunca suba pra nuvem pública
> sem criptografia (zip com senha, etc).

## Comandos do dia a dia

```bash
pm2 status                 # tudo que está rodando
pm2 logs luna-whatsplay    # ver o WhatsApp trabalhando
pm2 restart all --update-env  # aplicar mudanças no .env
cd <luna-agent> && pnpm --filter whatsplay login   # parear WhatsApp de novo
```

## Variáveis do instalador

| Variável | Default | Uso |
|-|-|-|
| `LUNA_AGENT_REPO` | github.com/Jhin1v9/luna-agent | mirror/fork do agent |
| `LUNA_KERNEL_REPO` | github.com/Jhin1v9/luna-kernel | mirror/fork do kernel |
