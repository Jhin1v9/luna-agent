# Luna Web — Redesign "Lunar Orbit"

**Data:** 28 de Junho de 2026  
**Versão alvo:** 10.20  
**Status:** Aprovado pelo usuário (abordagem A)

---

## 1. Objetivo

Transformar a Luna Web em uma interface **extraordinária**, **clean** e **tecnológica**, mantendo a identidade lunar. Resolver os problemas visuais e de usabilidade levantados sem perder funcionalidade.

## 2. Problemas a resolver

| # | Problema | Solução no redesign |
|---|----------|---------------------|
| 1 | Wallpaper fica paralisado no modo Thinking | Cada modo tem comportamento contínuo de partículas; Thinking usa órbita lenta e rastros |
| 2 | Header mobile cobre "Nova Sessão" / menu | Sidebar vira bottom bar no mobile; header reduzido só com título, modo e provider |
| 3 | Balões de chat estouram a tela no mobile | `max-width: 85%` mobile, `overflow-wrap: anywhere`, padding e tipografia ajustados |
| 4 | Balões estouram também no PC | `max-width: 70%` desktop, tabela/código com scroll horizontal isolado |
| 5 | Paleta azul genérica | Nova paleta por modo com tons refinados e identidade lunar |
| 6 | Botões rounded genéricos | Formas geométricas chanfradas, glassmorphism, ícones lineares finos |
| 7 | Layout estático | Micro-animações fluidas em entrada, hover, transições de modo e feedback |
| 8 | Provedores invadem área Instant/Thinking | Header desktop reorganizado com `flex-wrap` controlado e grupos separados |

## 3. Direção criativa

### 3.1 Conceito

A interface é uma **órbita lunar**. Elementos flutuam em camadas de profundidade sobre um fundo vivo. O movimento é constante mas sutil — nada acontece "de supetão". Transições são longas o suficiente para serem percebidas, curtas o suficiente para não atrasar.

### 3.2 Tom

- **Clean:** poucos elementos, muito respiro, hierarquia clara.
- **Tecnológico:** cantos chanfrados, linhas finas, glassmorphism, estados de loading que parecem sistemas reais.
- **Lunar:** escala de cinzas, branco lunar, prata, glow suave, curvas apenas onde fazem sentido orgânico (avatar, lua).

## 4. Paleta de cores

### 4.1 Base (modo escuro fixo)

| Token | Valor | Uso |
|-------|-------|-----|
| `--luna-bg` | `#07070f` | Fundo principal |
| `--luna-surface` | `#0d0d17` | Cards, sidebar, balões |
| `--luna-elevated` | `#14141f` | Hover, dropdowns, input |
| `--luna-border` | `rgba(255,255,255,0.08)` | Bordas sutis |
| `--luna-text` | `#f1f5f9` | Texto principal |
| `--luna-text-secondary` | `#94a3b8` | Texto secundário |
| `--luna-text-muted` | `#64748b` | Timestamps, placeholders |

### 4.2 Accents por modo

| Modo | Primary | Glow | Uso |
|------|---------|------|-----|
| Instant | `#e2e8f0` (branco lunar) | `rgba(226,232,240,0.18)` | Destaques, bordas, modo ativo |
| Thinking | `#8b5cf6` (violeta espacial) | `rgba(139,92,246,0.25)` | Raciocínio, thinking bubble |
| Agent | `#f59e0b` (âmbar) | `rgba(245,158,11,0.22)` | Ação/ferramentas |
| Swarm | `#34d399` (verde nebulosa) | `rgba(52,211,153,0.20)` | Múltiplos agentes |
| Plan | `#c9a227` (ouro lunar) | `rgba(201,162,39,0.22)` | Modo plano |

**Racional:** Instant vira branco/prata para fugir do ciano genérico. Os outros modos ganham saturação reduzida e glow mais difuso, parecendo luz de nebulosa em vez de LED de festa.

## 5. Tipografia

- **UI:** Inter, 15px base, line-height 1.5.
- **Código:** JetBrains Mono, 13px.
- **Títulos:** Inter semibold, letter-spacing `-0.01em`.
- **Timestamps:** JetBrains Mono, 11px, uppercase, tracking `0.05em`.

## 6. Formas e componentes

### 6.1 Botões

- **Formato:** retângulo com cantos chanfrados (clip-path com 4px de corte).
- **Estado default:** glassmorphism fosco (`bg-surface/60`, `backdrop-blur-md`, borda 1px).
- **Hover:** elevação `translateY(-1px)`, glow do modo, borda mais brilhante.
- **Active:** `translateY(0)`, glow reduzido.
- **Loading:** shimmer sutil da esquerda para direita.

### 6.2 Inputs

- **Chat input:** linha fina na parte inferior, fundo translúcido, borda glow quando focado.
- **Send button:** ícone de foguete/papel (manter sentido), estado de envio com micro-animação.

### 6.3 Balões de mensagem

- **User:** alinhado à direita, fundo `elevated`, borda direita accent, sombra sutil.
- **Assistant:** alinhado à esquerda, fundo `surface`, borda esquerda accent, header com avatar + nome + badge de modo.
- **Thinking:** bubble flutuante central, borda tracejada animada, cor do modo.

## 7. Layout

### 7.1 Desktop

```
┌─────────────────────────────────────────────────────────────┐
│ [Sidebar 260px] │ Header (modo | título | provider/ações)  │
│                 │                                          │
│  Nova Sessão    │  Messages                                │
│  Histórico      │                                          │
│  ...            │  ─────────────────────────────────────   │
│                 │  Input                                   │
└─────────────────────────────────────────────────────────────┘
```

- Header em **uma única linha**:
  - Esquerda: avatar/logo + título da conversa (truncado).
  - Centro: mode switcher (Instant | Thinking | Agent | Swarm) com `flex-wrap` em telas estreitas.
  - Direita: provider dropdown, persona dropdown, ações (limpar, exportar, novo).
- Provedor **nunca** invade o mode switcher: cada grupo tem `min-width` e `gap` fixos. Em telas abaixo de `1024px`, o mode switcher vira um dropdown compacto ao lado do título para garantir espaço.

### 7.2 Mobile

```
┌─────────────────────────────────┐
│ Header (título + modo + prov)   │
├─────────────────────────────────┤
│                                 │
│  Messages                       │
│                                 │
├─────────────────────────────────┤
│ Input                           │
├─────────────────────────────────┤
│ [Nova] [Hist] [Config] [Perfil] │  ← bottom bar
└─────────────────────────────────┘
```

- Sidebar vira **bottom navigation bar** fixa.
- "Nova Sessão" fica no primeiro item da bottom bar, não no topo.
- Header reduzido para não sobrepor conteúdo.
- Balões usam `max-width: 85%` e quebra de palavra agressiva.

## 8. Wallpaper / Fundo

O `ParticleBackground` é refatorado para nunca ficar parado:

| Modo | Comportamento |
|------|---------------|
| Instant | Partículas em warp horizontal sutil, branco/prata, velocidade média |
| Thinking | Órbita lenta em espiral ao redor do centro, rastro violeta, velocidade baixa |
| Agent | Ondulação senoidal, partículas âmbar seguindo caminhos curvos |
| Swarm | Aglomerados de partículas verdes que pulsam e se rearranjam |

Adicionalmente:
- **Nebulosa sutil** em gradiente radial por trás das partículas, mudando de cor com o modo.
- **Lua central** apenas em Thinking, como ponto de gravidade visual.
- Transição entre modos com cross-fade de 600ms e interpolação das cores das partículas.

## 9. Animações

### 9.1 Tokens de easing

```css
--ease-out-expo: cubic-bezier(0.16, 1, 0.3, 1);
--ease-in-out-sine: cubic-bezier(0.37, 0, 0.63, 1);
--ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
```

### 9.2 Durações padrão

| Animação | Duração |
|----------|---------|
| Hover de botão | 200ms |
| Entrada de mensagem | 350ms |
| Transição de modo | 400ms |
| Toggle de dropdown | 250ms |
| Loading/thinking pulse | 2000ms |
| Fundo entre modos | 600ms |

### 9.3 Comportamentos

- **Entrada de mensagens:** `opacity 0 → 1`, `translateY(12px) → 0`, `scale(0.98) → 1`.
- **Hover de botão:** `translateY(-1px)`, glow do modo, borda brilhante.
- **Dropdown:** `opacity` + `translateY(-8px) → 0`, origin top.
- **Mode switcher:** botão ativo ganha glow e fundo translúcido; transição de cor suave.
- **Thinking:** borda tracejada gira suavemente (`stroke-dashoffset` ou borda CSS animada).

## 10. Mudanças por componente

### 10.1 Tokens globais (`app.css` + `tailwind.config.js`)
- Atualizar `:root` com novos valores de cor, borda, glow e easing.
- Estender `tailwind.config.js` com a paleta `luna.*` atualizada.
- Adicionar keyframes `fadeInUp`, `shimmer`, `orbitGlow`.

### 10.2 `App.svelte`
- Aplicar novas variáveis CSS.
- No mobile (`< 768px`), renderizar `BottomBar` em vez de `Sidebar`.
- Ajustar grid/flex para novo layout.

### 10.3 `Sidebar.svelte`
- Manter para desktop.
- Simplificar visual: glassmorphism, cantos chanfrados, nova paleta.

### 10.4 `ChatHeader.svelte`
- Reestruturar em três grupos flex com `min-width` e `gap` seguros.
- Provider dropdown com posicionamento abaixo do botão, nunca sobrepondo modo.
- Adicionar animação de entrada do título ao trocar de sessão.

### 10.5 `ChatInput.svelte`
- Redesenhar input como barra inferior translúcida.
- Botão send com micro-animação.
- Manter funcionalidades: anexo, mic, cancelar.

### 10.6 `MessagesList.svelte`
- Ajustar `max-width` e padding.
- Adicionar stagger de entrada das mensagens.

### 10.7 `UserMessage.svelte` / `AssistantMessage.svelte`
- Novos estilos de balão com borda lateral accent e sombra sutil.
- Garantir `overflow-wrap: anywhere` e scroll isolado para tabelas/código.
- Assistant: header com badge de modo colorido.

### 10.8 `ParticleBackground.svelte`
- Implementar comportamentos contínuos por modo.
- Adicionar nebulosa e lua de Thinking.
- Transições suaves entre modos.

### 10.9 Novo componente: `BottomBar.svelte`
- Barra inferior mobile com: Nova Sessão, Histórico, Config, Perfil.
- Glassmorphism, ícones lineares, estado ativo com glow.

## 11. Critérios de sucesso

- [ ] Wallpaper nunca fica parado em nenhum modo.
- [ ] No mobile, header não cobre botão de nova sessão (agora na bottom bar).
- [ ] Balões nunca estouram a viewport mobile nem desktop.
- [ ] Provider dropdown nunca sobrepõe mode switcher.
- [ ] Paleta não usa mais ciano genérico; Instant é branco/prata.
- [ ] Botões têm cantos chanfrados e glassmorphism.
- [ ] Todas as transições usam easing suave e durações ≤ 600ms.
- [ ] Build de produção passa sem erros.
- [ ] Teste E2E DeepSeek continua passando após redesign.

## 12. Fora do escopo

- Criar modo claro.
- Alterar lógica de chat, providers ou backend.
- Refatorar markdown parser.
- Adicionar novas funcionalidades (voz, arquivos, etc.).

## 13. Próximos passos

1. Criar plano de implementação detalhado (`writing-plans`).
2. Implementar mudanças na ordem: tokens CSS → fundo → layout → componentes → animações.
3. Build e teste E2E.
4. Commit com screenshots antes/depois.
