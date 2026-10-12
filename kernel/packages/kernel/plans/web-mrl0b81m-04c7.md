# Plano: Auto-save de cookies no kimi-bridge após login

## Resumo
O `waitForLogin` em `kimi-bridge.cjs` detecta o login com sucesso mas não persiste os cookies/localStorage nos arquivos `*-master-cookies.json` / `*-master-localstorage.json`. Hoje só um script Node manual externo faz esse salvamento. O objetivo é injetar a lógica de auto-save diretamente no fluxo de detecção de login do bridge.

## Análise
- `.luna-kernel/packages/kernel/kimi-bridge.cjs:1297-1299` — matches de `master-cookies`, `masterLs`, `masterLocalstorage` indicam onde o bridge lê/consome os arquivos master, mas não os grava.
- `cookies/kimi-master-cookies.json` / `deepseek-master-cookies.json` — formato esperado: `{savedAt, totalCookies, kimiCookies, cookies}`.
- `waitForLogin` — detecta estado autenticado (provavelmente via `page.evaluate` checando `localStorage` ou DOM), mas encerra sem chamar nenhuma função de persistência.

## Passos
1. **kimi-bridge.cjs**: localizar a função `waitForLogin` (ou equivalente) e identificar o ponto exato onde o login é confirmado.
2. **kimi-bridge.cjs**: após a confirmação de login, adicionar chamada para extrair `document.cookie`, `localStorage` e `sessionStorage` da página e formatar no mesmo schema dos arquivos master existentes.
3. **kimi-bridge.cjs**: escrever o payload no arquivo `kimi-master-cookies.json` (ou provider correspondente) dentro de `packages/kernel/cookies/` com timestamp `savedAt`.
4. **kimi-bridge.cjs**: garantir que o auto-save só execute uma vez por sessão (flag interna) para evitar writes repetidos.
5. **(Opcional)**: criar função reutilizável `saveMasterCookies(page, provider)` para ser chamada também em outros pontos (ex: antes de fechar o browser).

## Riscos
- **Race condition**: se o auto-save rodar antes da página completar o set de cookies pelo JS. Mitigação: aguardar 2-3s após confirmação de login ou checar `document.cookie.length > threshold`.
- **Formato divergente**: se o schema master mudar no futuro, o auto-save grava formato errado. Mitigação: usar a mesma função de serialização que o script manual usa hoje (extrair para shared util).
- **Sobrescrever cookies válidos**: se já existir um master válido, o auto-save pode substituir por um parcial. Mitigação: merge inteligente (append + dedup por nome/dominio) em vez de overwrite total.

## Estimativa
5 passos | 1 arquivo principal (`kimi-bridge.cjs`) | ~15-20 min