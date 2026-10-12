# Luna DOM Observer — Extensão Chrome

Extensão Chrome que injeta o observador DOM persistente no Kimi Web.

## Por que extensão?

- ✅ Injetada automaticamente pelo Chrome em TODAS as páginas kimi.ai
- ✅ Roda no MAIN world da página (acesso total ao DOM)
- ✅ Sobrevive a navegações SPA (React re-renders)
- ✅ Auto-heal: reinicia sozinho se o React destruir o DOM
- ✅ Nunca mais "Observer lost"
- ✅ Elimina a necessidade de fallback no bridge

## Instalação

1. Abra o Chrome e vá para `chrome://extensions/`
2. Ative o **"Modo do desenvolvedor"** (cantinho superior direito)
3. Clique em **"Carregar sem compactação"**
4. Selecione a pasta `~/.luna-kernel/luna-extension`
5. Pronto! A extensão aparece com um ícone de lua rosa

## Verificação

Abra o Kimi Web (`kimi.ai`), pressione **F12** → aba **Console**, e digite:

```js
window.__lunaEventQueue.stats()
```

Se retornar `{ length: ..., lastEvent: ... }`, está funcionando.

## Como funciona

- `content.js` — roda no isolated world, injeta `<script src="injected.js">` no MAIN world
- `injected.js` — roda no MAIN world, cria `window.__lunaEventQueue` e o `MutationObserver`
- O bridge (`kimi-bridge.cjs`) só lê `window.__lunaEventQueue` — nunca mais injeta nada

## Arquivos

```
luna-extension/
├── manifest.json    # Manifest V3 — permissões e injeção
├── content.js       # Content script — injeta no MAIN world
├── injected.js      # Script principal — observer + queue
├── icon16.png       # Ícones
├── icon48.png
├── icon128.png
└── README.md
```