# Luna Premium Icon System — Design v12.5

**Data:** 2026-08-09  
**Status:** Aprovado pelo dono  
**Escopo:** Remover TODOS os emojis e ícones genéricos do frontend Luna Web, substituindo por Lucide Icons + SVGs personalizados premium, mantendo o design Lunar Orbit e sem alterar o wallpaper.

---

## 1. Princípios

- **0 emojis** no frontend. Nenhum emoji Unicode permanece.
- **Ícones Lucide** com estilo unificado: stroke fino, glow do modo, hover sutil.
- **SVG custom** apenas onde Lucide não cobre (logo, mascote, lua, constelação).
- **Não quebrar nada:** funcionalidade, SSE, confirmações, plan mode, mobile — tudo continua igual.
- **Wallpaper intacto:** `ParticleBackground.svelte` não será alterado.

## 2. Arquitetura

### 2.1 Novo módulo `src/lib/icons/`

| Arquivo | Responsabilidade |
|---------|------------------|
| `lunaIconMap.js` | Mapeamento semântico: tool name → Lucide component, action type → Lucide, status → Lucide |
| `LunaIcon.svelte` | Wrapper: aplica `strokeWidth`, `size`, cor do modo, hover scale, `aria-label` |
| `LunaLogo.svelte` | SVG custom do logo/lua (gradiente premium) |

### 2.2 Regras de uso

- Todo ícone passa por `<LunaIcon name="..." size={16|18|20} />`.
- Cores herdadas de CSS vars (`--luna-accent`, `--luna-thinking`), nunca hardcoded.
- `aria-label` em PT-BR para acessibilidade.
- Stroke padrão `1.5px`; ícones de alerta/erro podem usar `1.75px`.

## 3. Ondas de substituição

### Onda 1 — Chat core (impacto imediato)
- `lib/toolMeta.generated.js` → via `scripts/gen-tool-meta.cjs`, gerar `TOOL_ICONS` como nomes Lucide.
- `ToolCard.svelte` → substituir emojis por LunaIcon/Lucide.
- `ChatArea.svelte` → substituir emojis de status, confirmação, erro.

### Onda 2 — Input e comandos
- `lib/slashCommands.js` → cada comando ganha campo `lucide` (alguns já têm).
- `ChatInput.svelte` → expandir uso de Lucide; remover fallback emoji.

### Onda 3 — Navegação e estados
- `ConfigDrawer.svelte` → ícones das seções.
- `Sidebar.svelte` → Nova Sessão, histórico, config.
- `AssistantMessage.svelte`, `ThinkingBubble.svelte` → avatar, thinking, copy/like.

### Onda 4 — Branding e telas
- `LunaMascot.svelte`, `LunaStage.svelte`, `LoginPage.svelte` → SVGs premium.
- Modais (`Finance`, `Lead`, `Task`, `Voting`, `Changelog`) → ícones consistentes.

## 4. Mapeamento de substituição (exemplos)

| Emoji | Significado | Substituição Lucide |
|-------|-------------|---------------------|
| ✅ | sucesso | `CheckCircle2` |
| ❌ | erro | `XCircle` |
| 🗑️ | deletar | `Trash2` |
| 📖 | ler arquivo | `BookOpen` |
| ✍️ | escrever arquivo | `PenSquare` |
| 📝 | append | `FilePlus` |
| ✏️ | substituir | `FilePenLine` |
| 📦 | mover | `Move` |
| 📋 | copiar | `Copy` |
| 📁 | diretório | `Folder` |
| 🔍 | buscar | `Search` |
| 🖥️ | shell | `Terminal` |
| 📡 | output ao vivo | `Radio` |
| 🧠 | thinking | `Brain` |
| ⚡ | instant | `Zap` |
| 🌿 | git | `GitBranch` |
| 💾 | commit | `Save` |
| 📜 | log | `ScrollText` |
| 🩹 | patch | `Bandage` |
| ⬇️ | download | `Download` |
| 🌐 | web | `Globe` |
| 🧪 | testes | `FlaskConical` |
| 📸 | screenshot | `Camera` |
| 🤔 | thinking bubble | `BrainCircuit` |
| 🔒 | bloqueado | `Lock` |
| 📢 | sistema | `Megaphone` |
| 🔔 | notificação | `Bell` |
| 👍 | like | `ThumbsUp` |
| 👎 | dislike | `ThumbsDown` |
| 📄 | arquivo | `File` |
| 📎 | anexo | `Paperclip` |
| 🎙️ | voz | `Mic` |
| ⏹️ | parar | `Square` |
| 🔄 | refresh | `RotateCcw` |
| 🎯 | alvo/modo | `Target` |
| 💎 | premium | `Gem` |
| 🏆 | conquista | `Trophy` |
| ✨ | sparkle | `Sparkles` |
| ⭐ | favorito | `Star` |
| 🔥 | quente | `Flame` |
| 🚀 | enviar | `Rocket` |
| 💡 | ideia | `Lightbulb` |
| 🔧 | config | `Wrench` |
| ⚙️ | config | `Settings` |
| 🎨 | tema | `Palette` |
| 🎭 | persona | `Drama` |
| 🎪 | estágio | `Tent` |
| 🎬 | ação | `Clapperboard` |
| 🎮 | controle | `Gamepad2` |
| 🎲 | aleatório | `Dice5` |

> A lista completa será finalizada durante a implementação; qualquer emoji não mapeado recebe `CircleDot` como fallback neutro premium.

## 5. Backend

- `friendlyMessage` e `message` no backend já usam alguns emojis. O frontend vai **filtrar/substituir** esses emojis por badges Lucide no `ToolCard` e `ChatArea`, sem exigir reescrita de todo o backend nesta onda.
- Em ondas futuras, remover emojis também de `luna-soul.cjs`, `luna-tools.cjs` e prompts.

## 6. Critérios de sucesso

- [ ] `grep -rP '[\u{1F300}-\u{1FAFF}]|[\u{2600}-\u{27BF}]' src/` retorna zero no frontend (exceto documentação/README).
- [ ] Build `pnpm build` passa.
- [ ] `node --check` nos arquivos backend modificados.
- [ ] Servidor reinicia e HTTP 200.
- [ ] Chat, tools, confirmações, plan mode, mobile funcionam como antes.
- [ ] Wallpaper inalterado.

## 7. Fora do escopo

- Mudar lógica de negócio.
- Alterar wallpapers/animações de fundo.
- Criar modo claro.
- Refatorar markdown parser.
