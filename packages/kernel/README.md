# 🌙 Luna Kernel v5.0

> This package lives inside the [`luna-kernel` monorepo](https://github.com/Jhin1v9/luna-kernel).  
> Dashboard/frontend code is in `apps/dashboard` and the kernel core is in `packages/kernel` (this directory).

<p align="center">
  <strong>Autonomous AI Agent — Web Interface + Telegram Bot + Kimi Bridge</strong><br>
  <sub>Private Software — NEXO DIGITAL S.L. — Built by Abner Gabriel</sub>
</p>

<p align="center">
  <a href="#-instalação">🚀 Instalar</a> •
  <a href="#-como-usar">💡 Como Usar</a> •
  <a href="#-comandos-úteis">⌨️ Comandos</a> •
  <a href="#-solução-de-problemas">🔧 Problemas</a>
</p>

---

## 📸 Preview

```
┌─────────────────────────────────────────────────────────────┐
│  🌙 Luna Web    v5.0              ⭐ thinking    [Nova Sessão]│
├─────────────────────────────────────────────────────────────┤
│  📋 SESSÕES                    │                            │
│  💬 Crie um app React...       │   🌙                       │
│  2 min atrás                   │   Bem-vindo a Luna Web     │
│                                │                            │
│  [+ Nova Sessão]               │   💻 Crie um app React     │
│                                │   🔍 Pesquise notícias IA  │
│  ⚙️ Configurações              │   🐍 Execute Python        │
│  🟢 Conectado      v5.0        │                            │
├─────────────────────────────────────────────────────────────┤
│  📎  │  Mensagem Luna...                │  ➤               │
└─────────────────────────────────────────────────────────────┘
```

---

## ✨ O que há de novo na v5.0

| Feature | Descrição |
|---------|-----------|
| 🌐 **Interface Web** | Chat visual bonito com Svelte 4 + Tailwind CSS |
| ⚡ **Streaming em tempo real** | Veja a Luna "pensando" e executando ferramentas ao vivo |
| 🧠 **Thinking Bubbles** | Acompanhe o raciocínio da IA em tempo real |
| 🛠️ **Tool Cards** | Cards visuais mostrando cada ferramenta executada |
| 🎨 **Dark Mode** | Tema escuro elegante com cores #0f0f1a e #e94560 |
| 📱 **Mobile** | Funciona no celular, tablet e desktop |
| 🔄 **Reconexão automática** | SSE reconecta sozinho se cair a conexão |
| 🛡️ **Code Validator** | Validação automática de código após cada escrita |

---

## 🚀 Instalação (1 comando)

Abra o terminal e cole:

```bash
bash <(curl -fsSL https://raw.githubusercontent.com/Jhin1v9/luna-kernel/main/install.sh)
```

Isso vai:
1. ✅ Verificar Node.js v20+
2. ✅ Clonar/atualizar o repositório
3. ✅ Instalar dependências (`npm install`)
4. ✅ Verificar Chrome/Chromium
5. ✅ Criar arquivo `.env` template

---

## ⚙️ Configuração

Depois de instalar, configure os tokens:

```bash
cd /home/jhin/.luna-kernel
nano .env
```

**Obrigatório preencher:**

```env
# Token do bot do Telegram (pegue em @BotFather)
TELEGRAM_BOT_TOKEN=123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11

# Token da API interna do NEXO
INTERNAL_API_TOKEN=seu_token_aqui

# Segredo JWT (qualquer texto longo, mínimo 32 caracteres)
JWT_SECRET=minha_chave_secreta_muito_longa_e_segura_123456
```

> 💡 **Dica:** Use `openssl rand -hex 32` para gerar um JWT_SECRET seguro.

---

## 💡 Como Usar

### 🌐 Interface Web (recomendado)

O servidor web da Luna agora faz parte do workspace **`@luna/dashboard`**:

```bash
cd /home/jhin/.luna-kernel
node apps/dashboard/luna-server.js
```

Abra no navegador: **http://localhost:3458**

> ⚠️ O antigo `config-server.cjs` foi descontinuado. Use sempre `luna-server.js`.

**Fluxo típico:**
1. Clique em **"Nova Sessão"**
2. Digite sua mensagem (ex: "Crie um site em React")
3. Aperte **Enter**
4. Veja a Luna pensando 🧠 → executando ferramentas 🛠️ → respondendo 💬

### 💬 Bot do Telegram

```bash
cd /home/jhin/.luna-kernel
node packages/kernel/telegram-luna-adapter.cjs
```

- Adicione **@lunanexobot** ao seu grupo
- Envie mensagens para interagir

### 💻 Terminal (CLI)

```bash
cd /home/jhin/.luna-kernel
node packages/kernel/luna-cli.cjs
```

---

## ⌨️ Comandos Úteis

```bash
# Iniciar servidor web (via monorepo)
cd /home/jhin/.luna-kernel
node apps/dashboard/luna-server.js

# Iniciar bot do Telegram
cd /home/jhin/.luna-kernel
node packages/kernel/telegram-luna-adapter.cjs

# Usar via terminal
cd /home/jhin/.luna-kernel
node packages/kernel/luna-cli.cjs

# Rodar em background com PM2 (usa o ecosystem do monorepo)
cd /home/jhin/.luna-kernel
pm2 start pm2-ecosystem.config.js
pm2 save

# Ver logs
pm2 logs luna-server

# Parar tudo
pm2 stop all
```

---

## 🏗️ Arquitetura

```
┌─────────────┐     HTTP/SSE      ┌─────────────────┐
│   Navegador │ ◄──────────────► │  luna-server    │
│  (Luna Web) │                   │ (@luna/dashboard)│
└─────────────┘                   └────────┬────────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌───────────┐        ┌─────────────┐       ┌──────────────┐
            │ Luna Soul │        │ Kimi Bridge │       │   Telegram   │
            │(orquestra)│        │(Playwright) │       │   Adapter    │
            └─────┬─────┘        └──────┬──────┘       └──────────────┘
                  │                     │
                  ▼                     ▼
            ┌───────────┐        ┌─────────────┐
            │  Tools    │        │ Kimi Web AI │
            │writeFile  │        │  (via CDP)  │
            │executeSh  │        └─────────────┘
            │searchWeb  │
            └───────────┘
```

### Arquivos principais:

| Arquivo | Função |
|---------|--------|
| `apps/dashboard/luna-server.js` | Servidor web da Luna (HTTP + API REST + SSE + interface) |
| `config-server.cjs` | ⚠️ Descontinuado — não usar |
| `luna-soul.cjs` | Cérebro da Luna — modos, compactação, roteamento |
| `kimi-bridge.cjs` | Bridge Playwright CDP para o Kimi Web AI |
| `luna-tools.cjs` | Ferramentas: writeFile, readFile, executeShell, etc. |
| `luna-code-validator.cjs` | Valida código automaticamente após escrita |
| `luna-tool-guard.cjs` | Sandbox de segurança para execução de tools |
| `telegram-luna-adapter.cjs` | Adapter do Bot do Telegram |
| `luna-web/dist/` | Interface web compilada (Svelte + Tailwind) |

---

## 🖥️ Requisitos

| Requisito | Versão |
|-----------|--------|
| Node.js | v20+ |
| Chrome/Chromium | Qualquer versão recente |
| Git | Qualquer |
| RAM | 4GB+ recomendado |
| Espaço em disco | ~500MB |

---

## 🔧 Solução de Problemas

### ❌ "Node.js não encontrado"
```bash
# Instale o Node.js v20+
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### ❌ "Chrome não encontrado"
```bash
# Instale o Google Chrome
wget -q -O - https://dl.google.com/linux/linux_signing_key.pub | sudo apt-key add -
sudo sh -c 'echo "deb [arch=amd64] http://dl.google.com/linux/chrome/deb/ stable main" >> /etc/apt/sources.list.d/google-chrome.list'
sudo apt-get update
sudo apt-get install -y google-chrome-stable
```

### ❌ Erro "MODULE_NOT_FOUND"
```bash
cd /home/jhin/.luna-kernel
corepack pnpm install
```

### ❌ Porta 3458 já em uso
```bash
# Mude a porta no .env de apps/dashboard
LUNA_PORT=3459
```

### ❌ A interface web não carrega
```bash
# Verifique se o servidor está rodando
curl http://localhost:3458/api/chat/sessions
# Deve retornar: {"ok":true,"sessions":[]}
```

---

## 🛠️ Desenvolvimento

O código fonte Svelte da interface web vive no workspace `luna-web` (`packages/kernel/luna-web`).  
Para rebuild a partir do root do monorepo:

```bash
cd /home/jhin/.luna-kernel
corepack pnpm --filter luna-web build
```

---

## 📞 Suporte

- **Autor:** Abner Gabriel
- **Empresa:** NEXO DIGITAL S.L.
- **Bot:** @lunanexobot
- **Repo:** https://github.com/Jhin1v9/luna-kernel

---

<p align="center">
  <sub>🌙 Luna Kernel v5.0 — Built with love by NEXO DIGITAL S.L.</sub>
</p>
