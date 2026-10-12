# Requisitos do owner — cérebro da Luna

## R001 — Cérebro individual E compartilhado (owner, 12/10/2026, 20:56)

> Owner: "veja o que eu falei sobre o cerebro individual e compartilhado da luna e
> anote esse requisito necessario". (Fala original não localizada no histórico de
> WhatsApp acessível — productions/privado só carregam mensagens recentes; inbox do
> banco não tem registro. Interpretação abaixo; owner corrige se divergir.)

**A Luna deve operar com dois níveis de memória, explicitamente separados:**

1. **Cérebro individual** — memória privada dela como operadora: contexto acumulado,
   decretos, perfis de cliente, aprendizados, notas de diagnóstico. Hoje = `.brain/`
   do luna-agent + memória de sessão. Deve ser persistente e sobreviver a reinícios —
   nada de contexto vivo só na cabeça da sessão.
2. **Cérebro compartilhado** — tudo o que o time precisa ver/deliberar deve estar
   acessível fora do privado dela: painel Nexo (requests, relatórios, previas),
   brain remoto (`/brain/api`), documentos versionados no workspace (commits),
   docs/adr/ para decisões, e transparência no grupo productions.

**Implicações práticas (como vou operar):**
- Registro de pendências/demandas → `.brain/luna/pedidos-clientes.md` + painel (nunca só conversa).
- Decisões de arquitetura/negócio → `docs/adr/` + brain do cliente.
- Pareceres/análises → arquivo no `.brain/clients/<cliente>/` + resumo comunicado no canal do time.
- O grupo productions é canal de transparência: o que a Luna conclui, o time vê.
- O cérebro compartilhado NÃO substitui o individual: o individual guarda o porquê e o
  contexto; o compartilhado guarda o que foi decidido e o que é ação do time.

**Status:** requisito ativo. Owner ainda não deu a definição exata da fala original —
validar com ele e substituir a interpretação acima se necessário.
