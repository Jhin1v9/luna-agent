# ESPECIFICAÇÃO FUNCIONAL --- SISTEMA DE GESTÃO PARA GESTORIA

## Projeto: Miranda Gestión Contable --- Plataforma Web de Gestão Fiscal, Contábil, Faturação e Clientes

**Versão do documento:** 1.0\
**Data de referência:** 01/10/2026\
**Objetivo:** documento-base para UX/UI, protótipo navegável ("preview")
e posterior desenvolvimento do software.

------------------------------------------------------------------------

## 1. VISÃO DO PRODUTO

Construir uma plataforma SaaS para uma **gestoria/asesoría espanhola**,
inspirada na amplitude funcional de plataformas como ContaSimple, mas
desenhada desde o início para o trabalho **multiempresa/multicliente de
uma gestoria**.

O sistema não deve copiar código, identidade visual, textos, telas ou
elementos proprietários de terceiros. A referência ao ContaSimple serve
para definir **paridade de categorias funcionais e qualidade de
experiência**, criando uma solução própria para a Miranda Gestión
Contable.

### 1.1 Objetivos principais

1.  Centralizar clientes, autónomos e sociedades.
2.  Emitir e gerir faturas, faturas simplificadas, retificativas,
    recorrentes, orçamentos e albaranes.
3.  Registrar faturas recebidas, gastos, bens de investimento, cobranças
    e pagamentos.
4.  Automatizar cálculo fiscal a partir dos lançamentos.
5.  Preparar dados para modelos tributários.
6.  Ter motor fiscal configurável para **AEAT/Território Comum** e, em
    módulos separados, **Navarra** e futuros territórios forais.
7.  Ser preparado para requisitos de \*\*VERI\*FACTU/SIF\*\*, sem tratar
    isso como simples geração de PDF.
8.  Possibilitar Facturae/FACe.
9.  Conciliação bancária.
10. OCR de faturas/tickets.
11. CRM de clientes e fornecedores.
12. Portal do cliente.
13. Agenda fiscal e operacional.
14. Gestão documental.
15. Gestão de tarefas da gestoria.
16. Controle de honorários/mensalidades da própria gestoria.
17. Relatórios e dashboard.
18. Logs, auditoria, segurança, RGPD e permissões.
19. Arquitetura preparada para módulos futuros de laboral/nóminas,
    Seguridad Social, extranjería e DGT.

------------------------------------------------------------------------

## 2. REFERÊNCIA FUNCIONAL PESQUISADA --- CONTASIMPLE

Na pesquisa realizada em páginas públicas oficiais do ContaSimple, o
plano superior atualmente é denominado **Ultimate**. As páginas públicas
descrevem, entre outras, as seguintes capacidades:

-   documentos/faturas ilimitados;
-   produtos ilimitados;
-   clientes e fornecedores ilimitados;
-   remessas bancárias ilimitadas;
-   geração de PDF;
-   personalização de documentos;
-   envio de faturas por e-mail;
-   CRM de clientes e fornecedores;
-   gestão de cobranças e pagamentos;
-   faturas emitidas e recebidas;
-   gastos e bens de investimento;
-   livros de registro;
-   amortizações;
-   relatórios, incluindo perdas e ganhos;
-   impostos e modelos fiscais;
-   Facturae/fatura eletrônica;
-   funcionalidades ligadas a VERI\*FACTU;
-   conexão bancária/conciliação como funcionalidade complementar;
-   OCR/digitalização certificada como funcionalidade complementar;
-   controle de stock como funcionalidade complementar;
-   TPV como funcionalidade complementar;
-   remessas SEPA;
-   app móvel;
-   armazenamento documental.

A solução Miranda deverá ir além disso na camada de **gestoria
multi-cliente**, workflow, documentação, agenda fiscal, representação e
portal do cliente.

------------------------------------------------------------------------

# 3. PERFIS DE USUÁRIO

## 3.1 Superadministrador

Acesso total: - configurações globais; - empresas/clientes; -
usuários; - permissões; - integrações; - auditoria; - faturação; -
fiscal; - relatórios; - backups; - segurança.

## 3.2 Gestor/Asesor

Pode administrar os clientes atribuídos: - consultar e editar ficha; -
registrar documentos; - revisar OCR; - emitir documentos quando
autorizado; - preparar impostos; - conciliar banco; - criar tarefas; -
solicitar documentos; - gerar relatórios.

## 3.3 Auxiliar administrativo

Permissões limitadas e configuráveis: - cadastro; - upload; -
classificação; - tarefas; - cobrança; - documentos; - sem acesso a
apresentação fiscal, salvo autorização.

## 3.4 Cliente da gestoria

Portal próprio: - vê apenas sua empresa; - envia documentos; - consulta
faturas; - consulta impostos preparados/apresentados; - vê tarefas e
solicitações; - baixa relatórios; - recebe avisos; - aprova documentos
quando aplicável; - consulta honorários da gestoria.

## 3.5 Auditor/consulta

Somente leitura, com logs de acesso.

------------------------------------------------------------------------

# 4. ARQUITETURA MULTIEMPRESA / MULTICLIENTE

Este é um requisito crítico.

Cada cliente deve funcionar como um **tenant lógico** separado.

### Cada ficha de cliente deverá conter

-   ID interno;
-   tipo: autónomo / SL / comunidade de bens / outro;
-   nome/razão social;
-   NIF/NIE/CIF;
-   nome comercial;
-   endereço fiscal;
-   endereço da atividade;
-   telefone;
-   e-mail;
-   IBAN(s);
-   atividade(s);
-   IAE;
-   CNAE;
-   data de início;
-   regime de IVA;
-   regime de IRPF;
-   retenções aplicáveis;
-   território fiscal;
-   AEAT / Navarra / outro;
-   periodicidade fiscal;
-   obrigações/modelos aplicáveis;
-   certificado digital: somente metadados e cofre seguro se
    juridicamente/tecnicamente apropriado;
-   procurações/apoderamentos;
-   situação RETA;
-   dados de Seguridad Social;
-   gestor responsável;
-   honorário mensal;
-   serviços contratados;
-   documentos pendentes;
-   notas internas;
-   tags;
-   estado: prospect / onboarding / ativo / suspenso / baixa.

### Regra de isolamento

Nenhum usuário cliente pode visualizar dados de outro cliente. Toda
consulta de banco de dados deverá ser filtrada pelo tenant/empresa e
validada também no backend, não apenas na interface.

------------------------------------------------------------------------

# 5. DASHBOARD PRINCIPAL DA GESTORIA

A home deve ser operacional, não apenas estética.

### Cards

-   clientes ativos;
-   novos clientes no mês;
-   faturação da gestoria no mês;
-   honorários pendentes;
-   documentos pendentes de clientes;
-   faturas de clientes pendentes de cobrança;
-   impostos a preparar;
-   impostos a revisar;
-   impostos próximos do vencimento;
-   tarefas vencidas;
-   tarefas de hoje;
-   conciliações pendentes;
-   documentos OCR pendentes de validação.

### Gráficos

-   receita mensal da gestoria;
-   receita x despesa;
-   clientes por tipo;
-   clientes por território fiscal;
-   impostos por estado;
-   cobranças pendentes;
-   evolução mensal.

### Agenda

Calendário com: - obrigações fiscais; - vencimentos; - mensalidades; -
tarefas; - citas; - renovações; - datas de documentos; - alertas
personalizados.

------------------------------------------------------------------------

# 6. CRM --- CLIENTES E FORNECEDORES

## 6.1 Clientes

Campos: - pessoa física/jurídica; - NIF/NIE/CIF; - nome; - nome
comercial; - endereço; - código postal; - cidade; - província; - país; -
e-mail; - telefone; - IBAN; - condições de pagamento; - idioma; -
observações; - tags; - anexos.

## 6.2 Fornecedores

Mesma estrutura, adicionando: - categoria de gasto; - conta
contábil/configuração; - retenção habitual; - regime fiscal; -
vencimento padrão.

## 6.3 Histórico

Mostrar cronologicamente: - faturas; - pagamentos; - documentos; -
e-mails/notificações; - tarefas; - mudanças de cadastro; - impostos; -
notas.

------------------------------------------------------------------------

# 7. CATÁLOGO DE PRODUTOS E SERVIÇOS

Campos: - SKU/código; - descrição; - categoria; - preço líquido; - IVA
padrão; - IRPF/retenção padrão; - unidade; - desconto; -
ativo/inativo; - estoque (se módulo ativado); - custo; - margem; -
observações.

Permitir importação/exportação CSV/XLSX e edição em massa.

------------------------------------------------------------------------

# 8. MOTOR DE FATURAÇÃO

## 8.1 Tipos de documentos

-   orçamento/presupuesto;
-   albarán;
-   proforma;
-   fatura completa;
-   fatura simplificada;
-   fatura retificativa;
-   fatura recorrente;
-   recibo;
-   nota/documento interno quando permitido;
-   Facturae.

## 8.2 Fluxo

Orçamento → aprovado → albarán opcional → fatura → cobrança →
conciliação.

## 8.3 Dados da fatura

-   série;
-   número;
-   data de expedição;
-   data da operação;
-   emissor;
-   receptor;
-   linhas;
-   quantidade;
-   unidade;
-   preço;
-   desconto;
-   base;
-   IVA por linha;
-   retenção;
-   recargo de equivalencia quando aplicável;
-   suplidos, quando aplicável;
-   total;
-   forma de pagamento;
-   vencimento;
-   IBAN;
-   notas;
-   anexos;
-   estado;
-   referência externa;
-   campos de Facturae/FACe quando necessário.

## 8.4 Estados

-   rascunho;
-   emitida;
-   enviada;
-   visualizada;
-   parcialmente cobrada;
-   cobrada;
-   vencida;
-   retificada;
-   anulada segundo regras legais/SIF.

## 8.5 Séries

Configuração independente por: - empresa; - exercício; - tipo de
documento; - estabelecimento; - série especial/retificativa.

Bloquear duplicidade e manter sequência auditável.

## 8.6 PDF

Editor de template: - logo; - cores; - tipografia; - dados fiscais; -
rodapé; - condições; - QR quando obrigatório; - marca de
pago/pendente; - idiomas ES/PT/CAT inicialmente.

## 8.7 Envio

-   e-mail;
-   download;
-   portal do cliente;
-   link seguro;
-   futura integração WhatsApp Business.

Registrar data/hora e status do envio.

------------------------------------------------------------------------

# 9. VERI\*FACTU / SIF --- REQUISITO DE COMPLIANCE CRÍTICO

O desenvolvimento desta parte deve ser tratado como um **subsistema
regulatório próprio**.

O sistema deverá ser desenhado para cumprir a regulamentação SIF
aplicável, incluindo requisitos de: - integridade; - conservação; -
acessibilidade; - legibilidade; - rastreabilidade; - inalterabilidade; -
registros de faturação de alta; - registros de anulação; - encadeamento
dos registros; - hash/huella; - QR regulamentar; - capacidade de
comunicação com a AEAT; - registro de eventos; - declaração responsável
da versão do software; - versionamento e evidência de alterações.

### Regras de arquitetura

1.  Uma fatura fiscalmente emitida não pode simplesmente ser apagada.
2.  Correções devem seguir fluxos legais: retificação e/ou anulação
    conforme o caso.
3.  Preservar registro original e cadeia.
4.  Toda ação sensível deve gerar audit log imutável.
5.  Separar "rascunho" de "registro fiscal emitido".
6.  Implementar idempotência no envio à AEAT.
7.  Guardar request, response, timestamp, status e identificador
    técnico.
8.  Criar fila de reenvio em caso de indisponibilidade.
9.  Não permitir ao usuário editar diretamente hash, QR ou registro
    fiscal.
10. Gerar evidência por versão do software.

### Tela "VERI\*FACTU"

-   estado da integração;
-   modalidade/configuração aplicável;
-   certificados;
-   registros pendentes;
-   enviados;
-   aceitos;
-   rejeitados;
-   erros;
-   reenvios;
-   eventos;
-   consulta por cliente/data/fatura;
-   exportação técnica.

**Importante:** a empresa desenvolvedora deverá validar a implementação
final com assessoria fiscal/jurídica e especificações técnicas oficiais
vigentes no momento de produção.

------------------------------------------------------------------------

# 10. FACTURA ELECTRÓNICA / FACTURAE / FACe

O sistema deve: - gerar XML Facturae compatível com versão vigente; -
validar XSD; - suportar assinatura eletrônica quando exigida; -
armazenar XML original; - gerar visualização PDF; - suportar códigos
DIR3; - campos Oficina Contable / Órgano Gestor / Unidad Tramitadora; -
preparar integração com FACe; - registrar envio e estado.

Arquitetura deve permitir futuros formatos de faturação eletrônica B2B
exigidos pela legislação espanhola.

------------------------------------------------------------------------

# 11. FATURAS RECEBIDAS, GASTOS E COMPRAS

Tipos: - fatura recebida; - ticket/fatura simplificada; - gasto sem
fatura, apenas quando contabilmente permitido; - bem de investimento; -
gasto recorrente.

Campos: - fornecedor; - número; - data; - vencimento; - base; - IVA; -
IVA dedutível; - retenção; - total; - categoria; - método de
pagamento; - estado; - atividade; - centro de custo; - anexo; -
observação; - regra de dedutibilidade.

### Estados

pendente de revisar / validado / contabilizado / pago / parcialmente
pago / rejeitado.

------------------------------------------------------------------------

# 12. OCR / DIGITALIZAÇÃO

Entrada por: - upload; - drag & drop; - câmera; - e-mail dedicado
futuro; - portal do cliente.

Extrair: - fornecedor; - NIF; - número; - data; - base; - IVA; -
total; - moeda; - vencimento; - linhas quando possível.

### Regra obrigatória

OCR nunca deve contabilizar silenciosamente dados incertos. Mostrar
nível de confiança e encaminhar campos duvidosos para revisão humana.

Detectar: - duplicidade por fornecedor+número+data+valor; - documento já
enviado; - imagem ilegível; - NIF inválido; - soma inconsistente.

------------------------------------------------------------------------

# 13. BANCO E CONCILIAÇÃO

## 13.1 Contas

-   múltiplos IBANs por cliente;
-   saldo;
-   banco;
-   titular;
-   moeda;
-   estado da sincronização.

## 13.2 Importação

-   integração Open Banking/PSD2 por provedor autorizado;
-   CSV;
-   Excel;
-   formatos bancários quando aplicável.

## 13.3 Conciliação

O motor sugere correspondência entre movimento e: - fatura emitida; -
fatura recebida; - gasto; - honorário; - transferência interna.

Critérios: - valor; - data; - conceito; - NIF; - IBAN; - referência.

Estados: - não conciliado; - sugerido; - conciliado; - ignorado; -
dividido.

Permitir 1:N e N:1.

------------------------------------------------------------------------

# 14. COBRANÇAS, PAGAMENTOS E VENCIMENTOS

-   vencimentos;
-   cobrança parcial;
-   múltiplos pagamentos;
-   pagamento antecipado;
-   atraso;
-   aging;
-   alertas;
-   recibos;
-   métodos de pagamento;
-   notas de cobrança.

Dashboard: - a vencer 7/15/30 dias; - vencidas; - total pendente; - por
cliente; - por fornecedor.

------------------------------------------------------------------------

# 15. REMESSAS SEPA

-   criar mandato;
-   guardar referência;
-   gerar cobrança pontual/recorrente;
-   selecionar faturas;
-   gerar arquivo SEPA XML adequado;
-   status da remessa;
-   devoluções;
-   reconciliação;
-   histórico.

------------------------------------------------------------------------

# 16. CONTABILIDADE E LIVROS REGISTRO

A primeira versão pode focar na contabilidade fiscal/registro para
autónomos, deixando contabilidade financeira completa de sociedades para
fase posterior.

### Livros

-   faturas expedidas;
-   faturas recebidas;
-   vendas e ingressos;
-   compras e gastos;
-   bens de investimento;
-   provisões/suplidos quando aplicável.

### Funções

-   filtros;
-   exportação;
-   fechamento por período;
-   bloqueio após fechamento;
-   reabertura apenas com permissão e log;
-   trilha de alterações.

------------------------------------------------------------------------

# 17. BENS DE INVESTIMENTO E AMORTIZAÇÕES

Cadastro: - descrição; - fornecedor; - data; - custo; - IVA; - base
amortizável; - método; - vida útil; - coeficiente; - data de início; -
atividade; - baixa; - valor acumulado.

Gerar: - quadro anual; - amortização do período; - histórico.

------------------------------------------------------------------------

# 18. MOTOR FISCAL

O motor fiscal deve ser **parametrizável por território, exercício e
versão da regra**.

Nunca gravar regras tributárias importantes diretamente no código sem
versionamento.

## 18.1 Configuração por cliente

-   território;
-   regime;
-   atividade;
-   IAE;
-   IVA;
-   IRPF;
-   retenções;
-   intracomunitário;
-   aluguel;
-   operações com terceiros;
-   periodicidade.

## 18.2 Território Comum / AEAT

Preparar, no mínimo, dados e pré-cálculo para: - Modelo 303; - Modelo
390 quando aplicável; - Modelo 130; - Modelo 111; - Modelo 190; - Modelo
115; - Modelo 180; - Modelo 347; - Modelo 349.

Modelos adicionais entram por módulos/versionamento.

## 18.3 Navarra

**Não reutilizar automaticamente o motor AEAT.**

Criar `TaxEngineNavarra` separado: - regras próprias; - modelos
próprios; - calendários próprios; - endpoints/formatos próprios quando
existirem; - configuração por exercício; - tabelas versionadas.

A aplicação deve mostrar claramente ao gestor se o cliente pertence a
AEAT ou Hacienda Foral de Navarra para evitar apresentação no órgão
incorreto.

## 18.4 Workflow de imposto

1.  período aberto;
2.  importar/validar lançamentos;
3.  verificar pendências;
4.  pré-cálculo;
5.  revisão do gestor;
6.  bloqueio;
7.  gerar arquivo/dados;
8.  aprovação;
9.  apresentação externa ou via integração;
10. guardar justificante;
11. marcar apresentado;
12. registrar valor e data de pagamento.

Estados: - não iniciado; - em preparação; - faltam documentos; - pronto
para revisar; - revisado; - aprovado; - apresentado; - pago; -
incidência.

------------------------------------------------------------------------

# 19. CENTRO DE OBRIGAÇÕES E CALENDÁRIO FISCAL

Por cliente: - obrigações cadastradas; - periodicidade; - próximo
vencimento; - responsável; - status; - documentos necessários.

Calendário global da gestoria: - todos os clientes; - filtros por
gestor/modelo/território; - semáforo; - alertas D-30, D-15, D-7, D-3,
D-1 configuráveis.

O calendário deve ser versionado por ano e território.

------------------------------------------------------------------------

# 20. PORTAL DO CLIENTE

Dashboard simples: - documentos solicitados; - uploads recentes; -
impostos; - faturas; - honorários; - mensagens; - prazos; - tarefas que
exigem ação.

### Botão "Enviar documentos"

Categorias: - vendas; - compras; - banco; - aluguel; - Seguridad
Social; - impostos; - nóminas; - extranjería; - outros.

### Solicitação de documento

Gestor seleciona: - tipo; - período; - prazo; - mensagem; - recorrência.

Cliente recebe notificação e faz upload diretamente na solicitação.

------------------------------------------------------------------------

# 21. GESTÃO DOCUMENTAL

Estrutura automática: `Cliente > Ano > Área > Período > Tipo`

Áreas: - fiscal; - contábil; - faturação; - banco; - laboral; -
Seguridad Social; - extranjería; - DGT; - contratos; - certificados; -
outros.

Funções: - upload; - preview; - tags; - versão; - expiração; -
assinatura/status; - busca OCR/full-text; - permissões; - histórico; -
download em lote.

Nunca sobrescrever documento sem manter versão/histórico.

------------------------------------------------------------------------

# 22. TAREFAS E WORKFLOW DA GESTORIA

Campos: - cliente; - área; - responsável; - prioridade; - status; -
prazo; - checklist; - anexos; - comentários; - recorrência; - tempo
gasto.

Templates: - alta autónomo; - baixa autónomo; - fechamento trimestral; -
declaração de renda; - onboarding cliente; - alta atividade; -
preparação 303/130; - cobrança mensal; - solicitação de documentos.

Kanban: Backlog / A fazer / Em andamento / Aguardando cliente / Revisão
/ Concluído.

------------------------------------------------------------------------

# 23. MÓDULO DE HONORÁRIOS DA GESTORIA

A Miranda deve poder cobrar seus próprios clientes dentro do sistema.

Cadastro: - plano; - mensalidade; - IVA; - serviço adicional; -
desconto; - data de cobrança; - recorrência; - método; - SEPA; - status.

Automação: - gerar fatura mensal; - enviar; - registrar vencimento; -
conciliar pagamento; - cobrar extras; - alertar inadimplência.

Relatório: - MRR; - faturação mensal; - clientes inadimplentes; -
receita por serviço; - ticket médio.

------------------------------------------------------------------------

# 24. RELATÓRIOS

Por cliente: - receitas; - despesas; - resultado; - IVA repercutido; -
IVA suportado; - IRPF/retenções; - contas a receber; - contas a pagar; -
P&L simplificado; - principais clientes; - principais fornecedores; -
evolução mensal; - impostos por período.

Gestoria: - carteira de clientes; - receita; - honorários; - churn; -
tarefas; - produtividade; - obrigações; - documentos pendentes.

Exportar PDF/XLSX/CSV conforme relatório.

------------------------------------------------------------------------

# 25. NOTIFICAÇÕES

Canais: - in-app; - e-mail; - futura integração WhatsApp/SMS.

Eventos: - imposto próximo; - documento pendente; - tarefa vencida; -
fatura vencida; - pagamento recebido; - OCR com erro; - banco
desconectado; - certificado próximo de expirar; - novo upload do
cliente; - apresentação concluída; - erro VERI\*FACTU.

Permitir configurar frequência e evitar spam.

------------------------------------------------------------------------

# 26. BUSCA GLOBAL

Busca por: - cliente; - NIF; - fatura; - fornecedor; - valor; -
documento; - tarefa; - imposto; - conceito bancário.

Atalho de teclado recomendado: `Ctrl/Cmd + K`.

------------------------------------------------------------------------

# 27. IMPORTAÇÃO E MIGRAÇÃO

Assistentes de importação: - clientes; - fornecedores; - produtos; -
faturas; - gastos; - movimentos bancários; - saldos; - documentos.

Formatos: - CSV; - XLSX; - ZIP de documentos; - conectores/API futuros.

Antes de importar: 1. upload; 2. mapear colunas; 3. validar; 4. mostrar
erros; 5. preview; 6. confirmar; 7. relatório de importação; 8. rollback
lógico quando tecnicamente possível.

------------------------------------------------------------------------

# 28. API E INTEGRAÇÕES

Arquitetura API-first.

### Integrações prioritárias

-   AEAT/VERI\*FACTU;
-   Facturae/FACe;
-   Open Banking/PSD2;
-   e-mail;
-   armazenamento;
-   OCR;
-   assinatura eletrônica;
-   SEPA.

### Futuras

-   Seguridad Social/Sistema RED, conforme acessos e APIs disponíveis;
-   DGT;
-   extranjería/administración electrónica;
-   Google Drive/OneDrive;
-   WhatsApp Business;
-   e-commerce;
-   TPV.

API: - REST ou equivalente; - autenticação forte; - rate limit; -
scopes; - webhooks; - idempotency keys; - versionamento `/v1`.

------------------------------------------------------------------------

# 29. MÓDULO LABORAL --- FASE FUTURA

Preparar arquitetura para: - empresas; - centros de trabalho; -
empregados; - contratos; - jornada; - férias; - ausências; - nóminas; -
seguros sociais; - documentos; - vencimentos; - comunicação com sistemas
autorizados.

Não misturar o motor de nómina com o fiscal até especificação própria.

------------------------------------------------------------------------

# 30. EXTRANJERÍA / DGT / TRÂMITES --- DIFERENCIAL DA MIRANDA

Criar módulo de expedientes.

Campos: - cliente; - tipo de trámite; - órgão; - responsável; -
status; - data início; - prazo; - checklist; - documentos; - taxas; -
cita; - número de expediente; - protocolo; - resolução; - renovação.

Templates: - estancia por estudios; - autorizaciones; - extranjería; -
DGT; - certificados; - outros configuráveis.

O sistema não deve prometer integração automática onde não houver API
oficial disponível; deve permitir workflow manual assistido.

------------------------------------------------------------------------

# 31. PERMISSÕES E SEGURANÇA

## 31.1 RBAC

Permissão por: - módulo; - ação; - cliente; - equipe; - dado sensível.

Ações: view / create / edit / delete-logical / approve / submit / export
/ admin.

## 31.2 Autenticação

-   senha forte;
-   MFA/2FA;
-   sessão;
-   revogação;
-   dispositivos;
-   recuperação segura;
-   SSO futuro.

## 31.3 Criptografia

-   TLS em trânsito;
-   criptografia em repouso;
-   secrets em vault;
-   certificados/chaves privadas nunca em texto plano;
-   rotação de chaves.

## 31.4 Auditoria

Registrar: - usuário; - IP; - data/hora; - tenant; - ação; - objeto; -
antes/depois quando apropriado; - resultado.

Logs críticos devem ser protegidos contra alteração.

------------------------------------------------------------------------

# 32. RGPD / PROTEÇÃO DE DADOS

O projeto deverá prever: - privacy by design; - minimização; -
finalidade; - base jurídica; - consentimentos quando necessários; -
contratos de encarregado; - subencarregados; - registro de acesso; -
retenção; - eliminação/anonimização quando legalmente possível; -
exportação de dados; - gestão de incidentes; - backups; - segregação de
dados.

Dados fiscais que tenham obrigação legal de conservação não devem ser
apagados simplesmente porque um usuário clicou "eliminar".

------------------------------------------------------------------------

# 33. BACKUP E CONTINUIDADE

-   backups automáticos;
-   criptografados;
-   cópia geograficamente separada;
-   política de retenção;
-   teste periódico de restauração;
-   RPO/RTO definidos;
-   monitoramento;
-   plano de disaster recovery.

Sugestão inicial: - RPO \<= 24h, ideal menor; - RTO \<= 8h, a validar
conforme SLA.

------------------------------------------------------------------------

# 34. REQUISITOS NÃO FUNCIONAIS

-   aplicação web responsiva;
-   desktop-first para gestoria;
-   mobile-friendly para cliente;
-   PWA/app futura;
-   carregamento das telas comuns \<2s em condições normais;
-   paginação server-side;
-   filas assíncronas;
-   observabilidade;
-   logs;
-   métricas;
-   alertas;
-   ambientes DEV/STAGING/PROD;
-   CI/CD;
-   testes automatizados;
-   feature flags;
-   migrations versionadas.

------------------------------------------------------------------------

# 35. MODELO DE DADOS --- ENTIDADES PRINCIPAIS

``` text
Tenant
User
Role
Permission
ClientAccount
Business
Activity
TaxProfile
TaxObligation
Contact
Customer
Supplier
ProductService
Invoice
InvoiceLine
InvoiceSeries
CreditRectification
FiscalRecord
FiscalEvent
Quote
DeliveryNote
Expense
ReceivedInvoice
InvestmentAsset
Amortization
Payment
Receipt
BankAccount
BankTransaction
Reconciliation
SepaMandate
SepaBatch
TaxPeriod
TaxReturn
TaxCalculation
Document
DocumentVersion
DocumentRequest
Task
TaskTemplate
Workflow
Notification
Message
Subscription
ServicePlan
FeeInvoice
AuditLog
Integration
IntegrationCredential
WebhookEvent
CaseFile
CaseFileType
Appointment
Deadline
```

Todas as entidades de negócio devem conter, quando aplicável: - `id`; -
`tenant_id`; - `created_at`; - `updated_at`; - `created_by`; -
`updated_by`; - `status`; - `version`.

------------------------------------------------------------------------

# 36. PROPOSTA DE MENU

``` text
Dashboard

Clientes
  - Todos
  - Autónomos
  - Empresas
  - Onboarding
  - Prospects

CRM
  - Clientes
  - Fornecedores
  - Produtos/Serviços

Faturação
  - Faturas
  - Faturas simplificadas
  - Retificativas
  - Recorrentes
  - Orçamentos
  - Albaranes
  - Facturae
  - Séries

Compras e Gastos
  - Faturas recebidas
  - Gastos
  - OCR
  - Bens de investimento

Banco
  - Contas
  - Movimentos
  - Conciliação
  - Remessas SEPA

Fiscal
  - Obrigações
  - Períodos
  - Modelos
  - AEAT
  - Navarra
  - VERI*FACTU
  - Livros registro

Gestoria
  - Tarefas
  - Calendário
  - Documentos
  - Solicitações
  - Expedientes
  - Honorários

Relatórios

Portal do Cliente

Configurações
  - Minha gestoria
  - Usuários
  - Permissões
  - Templates
  - Impostos
  - Integrações
  - Certificados
  - Notificações
  - Auditoria
```

------------------------------------------------------------------------

# 37. TELAS OBRIGATÓRIAS NO PRIMEIRO PROTÓTIPO

A empresa de design/desenvolvimento deverá entregar um **protótipo
navegável antes de programar o produto final**.

Criar no mínimo:

1.  Login + 2FA.
2.  Dashboard da gestoria.
3.  Lista de clientes.
4.  Ficha 360º de cliente.
5.  Onboarding de novo cliente.
6.  Lista de faturas.
7.  Criar fatura.
8.  Preview da fatura.
9.  Fatura emitida + status VERI\*FACTU.
10. Lista de gastos.
11. Upload/OCR + tela de revisão.
12. Banco/movimentos.
13. Conciliação bancária.
14. Centro fiscal.
15. Detalhe de período fiscal.
16. Modelo 303 --- prévia/revisão.
17. Modelo 130 --- prévia/revisão.
18. Centro fiscal Navarra (interface separada).
19. Calendário fiscal.
20. Solicitação de documentos.
21. Gestão documental.
22. Tarefas/Kanban.
23. Portal do cliente.
24. Honorários/mensalidades.
25. Relatórios.
26. Configurações/permissões.
27. Auditoria.
28. Tela de integrações.

### O protótipo deve usar dados fictícios

Nunca usar dados reais de clientes no Figma/protótipo.

------------------------------------------------------------------------

# 38. FLUXO DE DEMONSTRAÇÃO DO PROTÓTIPO

O protótipo deverá permitir testar esta história completa:

1.  Gestor entra no sistema.
2.  Dashboard mostra obrigação fiscal pendente.
3.  Abre cliente fictício "Peluquería Demo Navarra".
4.  Visualiza território fiscal Navarra.
5.  Cliente enviou três documentos pelo portal.
6.  Um documento entra no OCR.
7.  Gestor revisa e confirma gasto.
8.  Importa movimento bancário.
9.  Sistema sugere conciliação.
10. Gestor confirma.
11. Emite uma fatura de venda.
12. Sistema mostra fluxo fiscal/VERI\*FACTU somente quando aplicável à
    configuração daquele cliente.
13. Centro fiscal recalcula o trimestre.
14. Gestor abre o período e vê pendências.
15. Sistema mostra imposto preliminar.
16. Gestor marca como revisado.
17. Documento/justificante é arquivado.
18. Tarefa fiscal é concluída.
19. Cliente vê no portal o status atualizado.
20. Miranda gera sua mensalidade de gestoria para o cliente.

------------------------------------------------------------------------

# 39. REGRAS DE UX

-   interface limpa;
-   linguagem simples;
-   ações críticas claramente diferenciadas;
-   não esconder informação fiscal importante;
-   evitar telas com excesso de campos;
-   wizard para processos complexos;
-   salvar rascunho automaticamente;
-   filtros persistentes;
-   pesquisa rápida;
-   atalhos;
-   ações em massa;
-   confirmação reforçada para operações irreversíveis;
-   mensagens de erro úteis;
-   histórico acessível.

### Cores de status

A equipe de design pode propor a paleta final, mantendo identidade
profissional da Miranda em **azul marinho, bege e branco**.

Não depender somente de cor para acessibilidade.

------------------------------------------------------------------------

# 40. REGRAS DE NEGÓCIO CRÍTICAS

1.  Não excluir fatura fiscal emitida como se nunca tivesse existido.
2.  Não permitir números duplicados na mesma série/exercício/empresa.
3.  Não recalcular imposto fechado sem processo explícito de reabertura.
4.  Não contabilizar OCR incerto sem validação.
5.  Não misturar AEAT e Navarra.
6.  Não permitir acesso cruzado entre clientes.
7.  Não guardar certificados/chaves sem criptografia apropriada.
8.  Toda ação fiscal relevante gera log.
9.  Toda regra tributária deve possuir vigência/versionamento.
10. Importações devem ter validação e relatório.
11. Cálculos monetários devem usar decimal, nunca float binário.
12. Datas fiscais devem considerar timezone Europe/Madrid e regras
    específicas do território.
13. Operações externas devem ser idempotentes.
14. Falha de integração não pode causar duplicação de envio.
15. O sistema deve preservar evidência do que foi apresentado/enviado.

------------------------------------------------------------------------

# 41. MVP RECOMENDADO

## Fase 1 --- Núcleo

-   autenticação;
-   multiempresa;
-   CRM;
-   faturação;
-   gastos;
-   documentos;
-   dashboard;
-   tarefas;
-   portal;
-   relatórios básicos;
-   honorários;
-   auditoria.

## Fase 2 --- Fiscal e automação

-   livros;
-   motor fiscal AEAT;
-   motor Navarra;
-   calendário;
-   OCR;
-   banco;
-   conciliação;
-   SEPA.

## Fase 3 --- Compliance e integrações avançadas

-   SIF/VERI\*FACTU;
-   Facturae/FACe;
-   assinatura;
-   APIs;
-   automações.

## Fase 4 --- Expansão gestoria

-   laboral/nóminas;
-   expedientes;
-   extranjería;
-   DGT;
-   integrações adicionais;
-   app móvel.

**Observação:** a ordem técnica de VERI\*FACTU pode precisar ser
antecipada se a faturação produtiva for lançada já sujeita às obrigações
SIF. A equipe deve validar isso antes de colocar o módulo de faturação
em produção.

------------------------------------------------------------------------

# 42. CRITÉRIOS DE ACEITE DO PROTÓTIPO

O protótipo será aprovado somente se:

-   demonstrar claramente operação multi-cliente;
-   diferenciar cliente AEAT e Navarra;
-   permitir navegar pelo ciclo fatura → cobrança → banco → fiscal;
-   demonstrar OCR com revisão;
-   demonstrar portal do cliente;
-   demonstrar calendário e tarefas;
-   demonstrar honorários da gestoria;
-   mostrar estados e alertas;
-   possuir design responsivo;
-   ter todos os estados importantes desenhados: vazio, carregando,
    sucesso, erro, sem permissão;
-   não depender de telas genéricas sem fluxo real.

------------------------------------------------------------------------

# 43. CRITÉRIOS DE ACEITE DO SOFTWARE

Antes de produção: - testes unitários; - testes de integração; - testes
E2E; - teste de isolamento entre tenants; - teste de permissões; - teste
de restore de backup; - teste de importação; - teste de arredondamento
fiscal; - teste de duplicidade; - teste de concorrência de numeração; -
teste de idempotência; - teste de falhas de APIs; - revisão RGPD; -
pentest; - revisão fiscal; - validação SIF/VERI\*FACTU; - declaração
responsável do sistema quando legalmente aplicável; - documentação de
operação; - plano de incidentes.

------------------------------------------------------------------------

# 44. O QUE NÃO DEVE SER FEITO

-   copiar interface/código do ContaSimple;
-   hardcode de alíquotas/regras sem vigência;
-   usar uma única tabela sem isolamento multiempresa;
-   permitir apagar registros fiscais críticos;
-   armazenar senhas/certificados em texto plano;
-   assumir que Navarra usa os mesmos modelos/fluxos da AEAT;
-   automatizar apresentação oficial sem tratamento de erros e
    evidência;
-   usar OCR como fonte incontestável;
-   lançar tudo em produção sem staging;
-   usar dados reais em protótipos;
-   prometer integrações públicas inexistentes.

------------------------------------------------------------------------

# 45. ENTREGÁVEIS EXIGIDOS DA EMPRESA DESENVOLVEDORA

## Etapa A --- Descoberta

-   mapa funcional;
-   dúvidas;
-   riscos;
-   integrações;
-   arquitetura proposta;
-   backlog.

## Etapa B --- UX/UI

-   sitemap;
-   wireframes;
-   design system;
-   protótipo navegável desktop;
-   protótipo portal/mobile;
-   estados de erro;
-   revisão com Miranda.

## Etapa C --- Especificação técnica

-   arquitetura;
-   banco;
-   APIs;
-   segurança;
-   integrações;
-   filas;
-   logs;
-   backups;
-   ambientes;
-   plano de testes.

## Etapa D --- Desenvolvimento

-   entregas por sprint;
-   ambiente staging;
-   demonstração;
-   homologação;
-   documentação.

## Etapa E --- Go-live

-   migração;
-   checklist;
-   treinamento;
-   monitoramento;
-   suporte;
-   SLA;
-   rollback.

------------------------------------------------------------------------

# 46. PERGUNTAS QUE A EMPRESA DEVE RESPONDER ANTES DO ORÇAMENTO FINAL

1.  Qual arquitetura multi-tenant será usada?
2.  Como garantirá isolamento entre clientes?
3.  Como implementará numeração concorrente de faturas?
4.  Como será feita a imutabilidade/auditoria dos registros fiscais?
5.  Qual estratégia para SIF/VERI\*FACTU?
6.  Quem assumirá validação técnica/regulatória?
7.  Como serão versionadas regras fiscais?
8.  Como será separado AEAT de Navarra?
9.  Qual provedor de Open Banking?
10. Qual OCR?
11. Como serão protegidos certificados?
12. Onde os dados serão hospedados?
13. Em que região?
14. Qual política de backup?
15. Como funciona disaster recovery?
16. Qual SLA?
17. Como será feito pentest?
18. Como será feita migração?
19. Quem será dono do código-fonte?
20. A Miranda terá acesso ao repositório?
21. Há documentação completa?
22. Existem custos por API/usuário/documento/OCR/banco?
23. Como funcionará manutenção legal?
24. Qual custo para mudanças fiscais anuais?
25. O produto poderá futuramente ser vendido como SaaS para outras
    gestorías?

------------------------------------------------------------------------

# 47. REQUISITO DE PROPRIEDADE E PORTABILIDADE

O contrato com a desenvolvedora deve definir claramente: - propriedade
intelectual do código; - titularidade do domínio; - titularidade da
cloud; - titularidade das contas de terceiros; - acesso ao
repositório; - exportação completa dos dados; - documentação; -
credenciais; - processo de saída; - backup; - continuidade caso a
fornecedora deixe de prestar serviço.

Evitar lock-in desnecessário.

------------------------------------------------------------------------

# 48. VISÃO DE LONGO PRAZO

A plataforma deverá nascer para a Miranda, mas ser tecnicamente
preparada para virar um SaaS de gestorias:

``` text
Platform
 ├── Gestoria A
 │    ├── Cliente 1
 │    ├── Cliente 2
 │    └── Cliente 3
 └── Gestoria B
      ├── Cliente 1
      └── Cliente 2
```

Isso exige separar: - `platform`; - `gestoria tenant`; -
`client business`.

Mesmo que a primeira versão tenha apenas Miranda, evitar decisões que
impeçam essa evolução.

------------------------------------------------------------------------

# 49. FONTES OFICIAIS UTILIZADAS NA PESQUISA

Pesquisa pública consultada em 01/10/2026:

-   ContaSimple --- página oficial de preços e funcionalidades:
    https://www.contasimple.com/precios/
-   ContaSimple --- site oficial e funcionalidades:
    https://www.contasimple.com/
-   ContaSimple --- contabilidade:
    https://app.contasimple.com/contabilidad
-   ContaSimple --- impostos: https://app.contasimple.com/impuestos
-   ContaSimple --- faturação: https://app.contasimple.com/facturacion
-   ContaSimple --- informação pública sobre VERI\*FACTU:
    https://www.contasimple.com/verifactu-en-cegid-contasimple/
-   AEAT --- FAQ oficial de Sistemas Informáticos de
    Faturação/VERI\*FACTU.
-   BOE --- Real Decreto 1007/2023 e alterações/vigência aplicáveis.
-   Facturae --- portal oficial de formato Facturae e FACe.

**Nota:** links são incluídos nesta especificação para a equipe técnica
verificar requisitos. A implementação deverá sempre consultar a versão
oficial vigente no momento de cada release.

------------------------------------------------------------------------

# 50. INSTRUÇÃO FINAL À EQUIPE

Este documento define o **escopo funcional de referência**, não
substitui: - especificação técnica detalhada; - desenho de banco; -
contratos de API; - análise jurídica; - validação fiscal; - análise
RGPD; - documentação oficial de SIF/VERI\*FACTU.

A primeira entrega esperada é um **protótipo navegável de alta
fidelidade**, usando dados fictícios, que permita à Miranda testar os
fluxos antes de autorizar o desenvolvimento integral.

O objetivo não é criar uma cópia do ContaSimple. O objetivo é criar um
**sistema próprio de gestão para gestoria**, com experiência comparável
a um software premium de faturação/contabilidade, porém otimizado para
gerir muitos clientes, múltiplos territórios fiscais, documentos,
tarefas e serviços administrativos em uma única plataforma.
