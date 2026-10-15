# Relatório Codex — migração da Luna para Superclim

Data: 2026-10-15

Este documento registra as alterações feitas durante a instalação e adaptação local da Luna para a Superclim. Ele também separa o que pertence a este repositório do que foi configurado em repositórios ou serviços externos.

## Objetivo aplicado

- Usar o `luna-agent` oficial como agente operacional da Luna.
- Remover a identidade, contatos, clientes, grupos e regras herdadas da Nexo.
- Usar um cérebro independente chamado `brain-superclim`.
- Restringir WhatsApp a contatos individuais cadastrados no `chat_registry`.
- Não autorizar grupos.
- Manter, nesta fase, somente os contatos que Elias cadastrar manualmente no Painel da Luna.
- Permitir cadastro e remoção de contatos tanto pela API quanto pelo frontend.
- Fazer o envio oficial funcionar também para contatos recém-cadastrados.
- Evitar que leitura automática, busca ou outro ciclo feche o chat durante uma intenção de envio.

## Arquitetura local adotada

Repositórios irmãos esperados:

- `luna-agent`: este repositório.
- `luna-kernel`: dashboard/kernel oficial da Luna.
- `brain-superclim`: memória e identidade exclusivas da Superclim.

O arquivo `ecosystem.superclim.config.cjs` inicia:

- `brain-superclim` — Atlas, porta 4321.
- `luna-server` — dashboard do kernel, porta 3458.
- `luna-orchestrator` — porta 3100.
- `luna-worker`.
- `luna-whatsplay`.
- `luna-painel` — porta 3101, bind local em `127.0.0.1`.

Os caminhos são portáveis: partem de `__dirname`, aceitam `LUNA_KERNEL_ROOT`, `LUNA_BRAIN_ROOT` e `LUNA_HOME`, e não carregam o nome do usuário da máquina no Git.

## Cérebro e remoção da Nexo

- O conteúdo histórico rastreado em `.brain/` era da Nexo e foi removido deste repositório.
- `.brain` passou a ser ignorado por completo no `.gitignore`.
- Na máquina atual, `.brain` é apenas um link local para o repositório irmão `brain-superclim`.
- O link absoluto local não é versionado.
- O cérebro novo contém identidade da Luna, perfil e owner da Superclim, política de WhatsApp e estruturas para clientes, conversas, serviços, preços, histórico e agendamentos.

## Contatos no Painel da Luna

Arquivos criados:

- `apps/painel/app/api/contacts/route.ts`
  - `GET /api/contacts`: lista contatos individuais com papel `allowed`.
  - `POST /api/contacts`: valida nome e telefone, normaliza DDI, cria ou atualiza organização, cliente, contato, conversa e registro autorizado.
- `apps/painel/app/api/contacts/[id]/route.ts`
  - `DELETE /api/contacts/:id`: remove a autorização do `chat_registry` sem apagar o histórico operacional.

Alterações em `apps/painel/lib/store.ts`:

- Tipo `SavedContact`.
- `getContacts()` lê do `chat_registry`, fonte oficial da autorização.
- `saveContact()` executa uma transação que:
  1. garante a organização `Superclim`;
  2. cria/atualiza um cliente com código `sc-{telefone}`;
  3. cria/atualiza o contato WhatsApp;
  4. cria a conversa inicial;
  5. cria/atualiza a autorização individual no `chat_registry`.
- `removeContact()` remove somente a autorização ativa.
- `sendMessage()` normaliza o telefone e procura conversa por mensagens, contato ou metadata.
- Registros antigos que existiam somente na allowlist são materializados automaticamente no primeiro envio.
- Um número não cadastrado não é materializado nem liberado.

Validações realizadas:

- Criação, listagem e remoção de um contato temporário pela API.
- Limpeza do contato temporário e de seus dados de teste.
- Build de produção do Painel concluído.
- Verificação no PostgreSQL de `conversation_id` para os dois contatos cadastrados durante a sessão.

## Segurança e política do WhatsApp

Alterações principais:

- `apps/whatsplay/src/owners.ts`: remoção dos donos e contatos hardcoded da Nexo.
- `packages/database/src/registry.ts`: ajustes para o registro dinâmico ser a autoridade.
- `apps/whatsplay/src/watcher.ts`: ingestão limitada ao registro autorizado, inclusive para chats privados; desconhecidos e grupos ficam bloqueados.
- `apps/whatsplay/src/outbound.ts`: saída validada pelo registro dinâmico; telefone individual em dígitos é convertido em JID `@s.whatsapp.net` para abrir diretamente o chat pelo deeplink.
- `apps/whatsplay/src/index.ts`: integração do registro e comportamento Superclim.
- `apps/whatsplay/src/voice/incoming-fastpath.ts` e `voice/call-executor.ts`: chamadas recebidas obedecem ao registro; chamadas iniciadas pela Luna permanecem desativadas por configuração.
- `packages/database/src/escalation-alert.ts`, `apps/worker/src/jobs/escalation-tick.ts` e `apps/orchestrator/src/notifications/engine.ts`: retirada de destinatários Nexo/Abner hardcoded e uso do contato de escala configurável.

Configuração local adotada, não versionada porque está no `.env`:

- `SUPERCLIM_ESCALATION_CONTACT=Elias Superclim Servicios`.
- `VOICE_CALL_ENABLED=false`.
- Allowlists estáticas de ambiente vazias; `chat_registry` é a fonte de autorização.

## Intenções e concorrência do painel do WhatsApp

Problema observado: o sweep automático podia começar no mesmo instante de um envio, interpretar o chat aberto como sobra de outro ciclo e fechá-lo antes da composição da mensagem.

Correção em `apps/whatsplay/src/panel-guard.ts`:

- O ciclo agora reserva sua posição no mutex antes de aguardar o ciclo anterior.
- Somente uma intenção controla o navegador por vez.
- Em caso de erro ao iniciar um ciclo, o lock é liberado corretamente para não causar deadlock.
- `sendMessage` mantém o painel durante abertura, composição e confirmação; o fechamento ocorre no `finally`, depois da conclusão ou falha explícita da intenção.

Teste adicionado em `apps/whatsplay/src/panel-guard.test.ts`:

- Duas intenções iniciadas no mesmo tick.
- O sweep deve permanecer fora enquanto `sendMessage` estiver ativo.
- O chat precisa continuar aberto até a confirmação simulada do envio.

Resultado: 8 testes do `panel-guard` passaram e o typecheck do WhatsPlay passou.

## Correções de execução e portabilidade

- `apps/whatsplay/src/discover.ts`, `probe.ts`, `readcheck.ts`, `selector-memory.ts` e `voice/operator-preflight.ts`: caminhos locais ajustados para o perfil Superclim e resolução portável.
- `apps/worker/src/index.ts`: criação tardia do cliente Kimi e inicialização tolerante quando a integração não está configurada.
- `apps/worker/src/jobs/live-tools.ts` e `apps/orchestrator/src/agent/router/tools.ts`: tools antigas da Nexo deixaram de ser registradas no contexto Superclim; foi adicionada a base para cadastro controlado de contato.
- `apps/orchestrator/src/agent/context.ts`, `router/structured.ts` e `index.ts`: identidade, contexto e prompts ajustados para a Luna/Superclim.
- `config/providers.json`: catálogo reduzido aos providers realmente usados pelo cérebro configurado, removendo a configuração herdada e extensa da Nexo.
- `ecosystem.superclim.config.cjs`: configuração PM2 completa para todos os processos locais.

## Alteração relacionada no luna-kernel (outro repositório)

No repositório irmão `luna-kernel`, foi alterado:

- `apps/dashboard/luna-chat-routes.js`.

Foi implementado o comando local `/ajuda`, que retorna sem chamar o modelo:

- Luna Web: `http://localhost:3458/`.
- Painel da Luna: `http://localhost:3101/`.
- Brain/Atlas: `http://localhost:4321/`.
- Health do orchestrator: `http://localhost:3100/health`.
- Ready do orchestrator: `http://localhost:3100/ready`.

Essa alteração não faz parte do commit do `luna-agent`; precisa de commit próprio no `luna-kernel` caso deva ser publicada.

## Estado do banco e serviços locais

- PostgreSQL dedicado: container `luna-superclim-postgres`, porta local 5434, banco/usuário `luna_superclim`.
- Perfil WhatsApp dedicado: `~/.luna-superclim/chrome-whatsapp`.
- Contatos observados no registro ao final da configuração:
  - `Elias Superclim Servicios` — `34624529442`.
  - `Elias Superclim Privado` — `34672953062`.
- Nenhum grupo autorizado.
- Todos os seis serviços foram salvos no PM2.

## Teste real de mensagem

Foi solicitada uma mensagem real para `Elias Superclim Privado`. A investigação e o acompanhamento até a confirmação encontraram e corrigiram três problemas adicionais em `apps/whatsplay/src/browser.ts`:

- A recuperação do fallback usava `reload()` e preservava a URL quebrada; agora navega para a URL base do WhatsApp.
- O detector considerava a tag estática de fallback `noscript` como falha mesmo com `#pane-side` carregado; agora a lista real de chats é o sinal de saúde.
- A busca por telefone abria corretamente o contato salvo, mas comparava o título textual do chat com o número e rejeitava o resultado; telefone puro agora é validado como identidade numérica e chat individual.

O envio por JID/deeplink foi descartado nesta instalação porque levava o WhatsApp Web ao fallback `_fb_noscript=1`. O fluxo final usa a busca por número protegida pelo `PanelGuard`.

As duas mensagens da fila foram confirmadas como `sent`:

- `Oi! Esta é uma mensagem de teste da Luna para confirmar que o envio pelo painel está funcionando.` — `sent_at=2026-10-15 11:29:31.339954+00`.
- `iae teste` — `sent_at=2026-10-15 11:29:43.02653+00`.

Além da confirmação técnica no banco, Elias confirmou que as mensagens chegaram corretamente ao WhatsApp de destino. Portanto, o fluxo completo foi validado: Painel/API → fila PostgreSQL → WhatsPlay → abertura do contato por número → composição → confirmação de envio → recebimento no aparelho.

Limitação de testes encontrada:

- `panel-guard.test.ts`: 8/8 passaram.
- Typecheck do WhatsPlay: passou.
- Build do Painel: passou.
- `outbound.test.ts`: 7 testes falham porque os mocks antigos não implementam a consulta obrigatória ao `chat_registry`; essas falhas já ocorrem antes de chegar ao transporte e a suíte precisa ser atualizada para a política dinâmica.

## Arquivos modificados neste repositório

- `.gitignore`
- `CODEX.md`
- `ecosystem.superclim.config.cjs`
- `apps/orchestrator/src/agent/context.ts`
- `apps/orchestrator/src/agent/router/structured.ts`
- `apps/orchestrator/src/agent/router/tools.ts`
- `apps/orchestrator/src/index.ts`
- `apps/orchestrator/src/notifications/engine.ts`
- `apps/painel/lib/store.ts`
- `apps/painel/app/api/contacts/route.ts`
- `apps/painel/app/api/contacts/[id]/route.ts`
- `apps/whatsplay/src/discover.ts`
- `apps/whatsplay/src/browser.ts`
- `apps/whatsplay/src/index.ts`
- `apps/whatsplay/src/outbound.ts`
- `apps/whatsplay/src/owners.ts`
- `apps/whatsplay/src/panel-guard.ts`
- `apps/whatsplay/src/panel-guard.test.ts`
- `apps/whatsplay/src/probe.ts`
- `apps/whatsplay/src/readcheck.ts`
- `apps/whatsplay/src/selector-memory.ts`
- `apps/whatsplay/src/voice/bridge.ts`
- `apps/whatsplay/src/voice/call-executor.ts`
- `apps/whatsplay/src/voice/incoming-fastpath.ts`
- `apps/whatsplay/src/voice/operator-preflight.ts`
- `apps/whatsplay/src/watcher.ts`
- `apps/worker/src/index.ts`
- `apps/worker/src/jobs/escalation-tick.ts`
- `apps/worker/src/jobs/live-tools.ts`
- `config/providers.json`
- `packages/database/src/escalation-alert.ts`
- `packages/database/src/registry.ts`
- remoção do antigo conteúdo rastreado em `.brain/`.

## Procedimento de merge e atualização local

1. Revisar `luna-agent-superclim` no repositório `luna-agent`.
2. Revisar `luna-kernel-superclim` no repositório `luna-kernel`.
3. Revisar `brain-superclim` no repositório do cérebro.
4. Fazer merge das branches desejadas nas respectivas `main`.
5. Nesta máquina, mudar cada repositório para `main`.
6. Executar `git pull --ff-only origin main` em cada um.
7. Recriar ou preservar o link local `.brain -> ../brain-superclim`.
8. Reiniciar os serviços com `pm2 startOrReload ecosystem.superclim.config.cjs`.
