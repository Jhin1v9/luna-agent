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

## R002 — Nomes próprios SEMPRE capitalizados e corretos (owner, 13/10/2026, 00:09)

> Owner: "SEMPRE NOME PROPRIO 1 LETRA MAIUSCULA E SEMPRE ESCRITA CORRETAMENTE
> 'Vênus' 'Luna'"

**Regra absoluta de escrita (todos os canais — WhatsApp, Telegram, painel, docs,
código comentado, commits, synapses):**

1. Todo nome próprio começa com letra MAIÚSCULA: Vênus, Luna, Nexo, Rottu, Enoque,
   Abner, Jess, Dudu, Kimi.
2. Escrita correta SEMPRE — com acentos e grafia exatas: "Vênus" (nunca "Venus",
   "venus", "VÊNUS" fora de código constante), "Luna" (nunca "luna" em prosa).
3. Válido em qualquer lugar: respostas ao time/cliente, UI do painel, memória,
   relatórios. Em código/identificadores (nomes de processo, tabelas, variáveis)
   vale o padrão técnico — mas qualquer texto humano segue a regra.

**Motivo:** nomes são identidade — escrever errado soa descuido e quebra a persona
profissional da Nexo. O owner chamou atenção às 00:09 após leitura das mensagens.

**Status:** requisito ativo, vigor imediato.
