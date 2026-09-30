# Handoff pro Kimi Code — fixes do site HDM (ordem direta do Abner, 26/09/2026 ~12:20)

## Decreto do owner (transcrito)

"Você consegue sim, só você mandar pro Kimi Code fazer. Faz um prompt pra ele e manda
toda essa conversa que você mandou pra mim aqui e fala pra ele o que te falei — ou seja,
envie pra ele tanto suas mensagens quanto as minhas, e já era."
(Abaixo: "Já mapeados pelo Noke: alt text das imagens + rota /cookies. Acesso cliente:
HDM-industrial@nexo-digital.app, sem senha — first access define.")

## O que executar (priorizado)

Site REAL: https://hdm-six.vercel.app (Next.js, 4 idiomas ES/CA/EN/PT, hero com
carrossel de 4 slides de fundo, painel configurador de perfis). Repo/deploy do Matheus.

1. **Prefetch RSC 404 em TODAS as rotas** — `__next...__PAGE__.txt?_rsc=` → 404.
   Navegação client-side instável. Provável build desalinhado no Vercel → REDEPLOY
   e confirmar que os prefetch voltam 200. (MAIS GRAVE)
2. **Faixa vazia gigante no meio da página no MOBILE** — seção renderiza em branco
   (412x915). Pode ser consequência do item 1 ou imagem quebrada. Investigar e corrigir.
3. **Botão "SOLICITAR PERSONAL" do footer gigante no mobile** — exagero de zoom/tamanho
   (report original do Enoque no Android 13 2400x1080, reproduzido por mim em 412x915).
   Também: informações do footer não centralizadas.
4. **Banner de cookies cobre o rodapé** — ajustar z-index para não sobrepor o footer.
5. **Alt text das imagens + rota /cookies** — já mapeados pelo Noke, incluir no mesmo bloco.
6. **Verificar auto-rotação do carrossel do hero** — slides devem girar sozinhos a cada 30s
   (pedido original do Matheus). Confirmar ao vivo.

## Evidências

- Prints (desktop hero, scroll, mobile 412x915, footer desktop/mobile, full page):
  `.brain/luna/analises/2026-09-26-hdm-real-preview/` (maquina do Abner)
- Lista 404 capturada: todas as rotas (/ca, /en, /contacto, /cobertura, /cookies, ...)
- Aba "Revisão" já publicada no relatório do cliente:
  vps.nexo-digital.app/relatorios → login HDM-industrial@nexo-digital.app (sem senha)
  → container nexo_relatorios, página public/clientes/hdm/index.html na VPS
- SSL: apex hdmindustrial.es (sem www) tem cert quebrado — site NOVO é o vercel;
  o www.hdmindustrial.es é o site ANTIGO (fora de escopo aqui, domínio do cliente).

## Conversa completa (Luna × Abner/Enoque no Production, transcrita)

**Abner:** Luna analisa o carrossel do HDM matheus que foi colocado, analisa a primeira
página e me relata erros melhorias bugs e tira print e olha pra ver se tá bonito.

**Luna (relatório 1 — SITE ERRADO, www.hdmindustrial.es antigo):** [ver mensagem ae42d77d
no banco] — SSL do apex quebrado, CTA "Inicio" anti-pattern, logo sem alt...

**Abner:** Esse site que vc tá olhando luna não é o site de vdd, acessa o link que te
mandei e vc vai entender.

**Enoque:** @luna o botao de abaixo de tudo esta com muito zoom e algumas informação nao
esta centralizadas... Estou usando um celular Android 13 resolução tela 2400x1080, nos
iPhone parece que se sincroniza bem.

**Luna (relatório 2 — SITE REAL hdm-six.vercel.app, prints em 412x915):**
BUGS: (1) prefetch RSC 404 em todas as rotas — navegação quebrada, provável redeploy Vercel;
(2) faixa vazia gigante mid-page só no mobile; (3) botão "SOLICITAR PERSONAL" do footer
gigante no mobile (confirmado report do Noke); (4) banner de cookies por cima do rodapé.
CARROSSEL: 4 slides com overlay, boa legibilidade; auto-rotação a verificar ao vivo 30s.
ESTÉTICA: muito bom — tipografia forte, hierarquia clara, CTA certo, painel de perfis limpo.
Zero erros JS. Fila: redeploy Vercel, investigar faixa vazia, botão footer, z-index cookies.
Alt text + rota /cookies o Noke já tinha pego.

**Abner:** (quote das pendências) Duas coisas ficam pendentes de decisão: o ok pra abrir a
branch do preview, e quem pega o SSL da produção.

**Luna:** Sobre as duas pendências: (1) branch do preview — aguardo teu ok; (2) SSL do apex
— eu pego com acesso ao painel do domínio (15 min: cert pro apex ou redirect DNS pra www).

**Abner:** Joga tudo isso pro relatório deles numa aba de revisão — pode criar essa aba no
vps.nexo-digital.app/relatórios, entra no do Matheus. O email dele pra entrar é
HDM-industrial@nexo-digital.app e não tem senha. Você já tem acesso à VPS, pode ir lá
direto e mudar, depois vem aqui e me avisa se deu.

**Luna:** A aba Revisão JÁ estava criada pelo time com minha análise. Validei end-to-end:
login sem senha funciona, página 200, aba renderizando, público e interno. Tá no ar.

**Abner:** Você consegue sim — só você mandar pro Kimi Code fazer. Faz um prompt pra ele e
manda toda essa conversa que você mandou pra mim aqui... envie pra ele tanto suas msg
quanto as minhas, e já era.

## Registro de ouro
Site real = hdm-six.vercel.app. www.hdmindustrial.es = site ANTIGO (não confundir).
