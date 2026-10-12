/**
 * ═════════════════════════════════════════════════════════════════════════════
 * LUNA NLU ENGINE — NEXO Dashboard Pro
 * ═════════════════════════════════════════════════════════════════════════════
 *
 * Motor de Natural Language Understanding baseado em NLP.js (AXA Group).
 * Treinado para entender comandos em Português, Espanhol e Catalão
 * nos domínios do ERP NEXO Digital: email, tarefas, projetos, clientes,
 * financeiro, whatsapp, orçamentos, leads, ideias.
 *
 * Funciona 100% offline — não depende de API externa.
 * Quando API Gemini disponível: complementa com geração de texto.
 * Quando API indisponível: Smart Form Assistant assume com contexto.
 *
 * Arquitetura: Multi-domain NLU com confidence scoring e fallback.
 */

const { NlpManager } = require('node-nlp');
const fs = require('fs');
const path = require('path');

const MODEL_PATH = path.join(__dirname, '..', 'data', 'luna-model.nlp');
const CORPUS_PATH = path.join(__dirname, '..', 'data', 'luna-corpus.json');

// Configuração do manager
const manager = new NlpManager({
  languages: ['pt', 'es', 'ca'],
  forceNER: true,
  nlu: {
    useNoneFeature: true,      // Previne false positives
    log: false,
  },
});

// Domínios e intents do NEXO Digital
const DOMAINS = {
  email: {
    description: 'Comandos relacionados a emails e comunicação por email',
    intents: [
      'email.responder',
      'email.resumir',
      'email.analisar',
      'email.criar_rascunho',
      'email.enviar',
      'email.arquivar',
      'email.mover_lixeira',
      'email.marcar_importante',
      'email.listar_nao_lidos',
      'email.marcar_lido',
      'email.sincronizar',
      'email.listar_rascunhos',
      'email.aprovar_rascunho',
      'email.rejeitar_rascunho',
      'email.favoritar',
      'email.desfavoritar',
      'email.marcar_spam',
      'email.restaurar_lixeira',
      'email.listar_arquivados',
      'email.listar_lixeira',
      'email.listar_enviados',
      'email.listar_com_estrela',
    ],
  },
  tarefas: {
    description: 'Comandos relacionados a tarefas e gestão de atividades',
    intents: [
      'tarefa.criar',
      'tarefa.listar',
      'tarefa.atualizar',
      'tarefa.deletar',
      'tarefa.concluir',
      'tarefa.atribuir',
      'tarefa.adicionar_comentario',
      'tarefa.minhas',
      'tarefa.p0',
      'tarefa.p1',
      'tarefa.atrasadas',
      'tarefa.por_projeto',
      'tarefa.por_responsavel',
      'tarefa.concluidas',
    ],
  },
  projetos: {
    description: 'Comandos relacionados a projetos e gestão de projetos',
    intents: [
      'projeto.criar',
      'projeto.listar',
      'projeto.atualizar',
      'projeto.deletar',
      'projeto.adicionar_cliente',
      'projeto.ver_status',
    ],
  },
  clientes: {
    description: 'Comandos relacionados a gestão de clientes e contatos',
    intents: [
      'cliente.criar',
      'cliente.listar',
      'cliente.buscar',
      'cliente.atualizar',
      'cliente.deletar',
    ],
  },
  financeiro: {
    description: 'Comandos relacionados a finanças, pagamentos e despesas',
    intents: [
      'financeiro.consultar_caixa',
      'financeiro.adicionar_receita',
      'financeiro.adicionar_despesa',
      'financeiro.listar_pagamentos',
      'financeiro.listar_despesas',
      'financeiro.projetar_caixa',
      'financeiro.ver_balanco',
      'financeiro.extrato',
      'financeiro.gastos_do_mes',
      'financeiro.receitas_do_mes',
      'financeiro.balanco',
      'financeiro.projecao',
      'financeiro.historico_caixa',
      'financeiro.reconciliar',
      'financeiro.ajustar_caixa',
      'financeiro.pagar_despesa',
      'financeiro.split',
      'financeiro.excluir_despesa',
      'financeiro.excluir_pagamento',
      'financeiro.atualizar_despesa',
      'financeiro.atualizar_pagamento',
    ],
  },
  whatsapp: {
    description: 'Comandos relacionados ao WhatsApp Business',
    intents: [
      'whatsapp.enviar_mensagem',
      'whatsapp.responder_cliente',
      'whatsapp.ver_historico',
      'whatsapp.sincronizar',
      'whatsapp.marcar_nao_lido',
      'whatsapp.verificar_mencoes',
      'whatsapp.mensagens_recentes',
      'whatsapp.scan',
      'whatsapp.classificar',
      'whatsapp.relatorio',
      'whatsapp.limpar_buffer',
      'whatsapp.checkpoint',
      'whatsapp.configurar',
    ],
  },
  links: {
    description: 'Comandos relacionados a links e recursos',
    intents: [
      'link.listar',
      'link.adicionar',
      'link.excluir',
    ],
  },
  orcamentos: {
    description: 'Comandos relacionados a orçamentos e propostas comerciais',
    intents: [
      'orcamento.criar',
      'orcamento.listar',
      'orcamento.atualizar',
      'orcamento.enviar_cliente',
      'orcamento.aprovar',
      'orcamento.rejeitar',
    ],
  },
  leads: {
    description: 'Comandos relacionados a leads e pipeline de vendas',
    intents: [
      'lead.criar',
      'lead.listar',
      'lead.atualizar_status',
      'lead.converter',
      'lead.deletar',
    ],
  },
  ideias: {
    description: 'Comandos relacionados a sessão de ideias e brainstorm',
    intents: [
      'ideia.criar',
      'ideia.listar',
      'ideia.atualizar',
      'ideia.deletar',
      'ideia.converter_tarefa',
      'ideia.adicionar_comentario',
    ],
  },
  sistema: {
    description: 'Comandos gerais do sistema e navegação',
    intents: [
      'sistema.ajuda',
      'sistema.status',
      'sistema.navegar',
      'sistema.notificacoes',
      'sistema.notificacoes_lidas',
      'sistema.configuracoes',
      'sistema.trocar_usuario',
      'sistema.alterar_senha',
      'sistema.usuarios',
      'sistema.changelog',
      'sistema.relatorios_bug',
      'sistema.auto_fix',
      'sistema.controlar_servico',
      // Sistema admin removidos (foco no Dashboard)
    ],
  },
  social: {
    description: 'Saudações e conversação social',
    intents: [
      'social',
    ],
  },
  workspace: {
    description: 'Comandos relacionados ao workspace de clientes',
    intents: [
      'workspace.listar_clientes',
      'workspace.abrir',
      'workspace.criar_cliente',
      'workspace.criar_pasta',
      'workspace.upload',
      'workspace.servidores',
      'workspace.iniciar_demo',
      'workspace.parar_demo',
      'workspace.logs',
    ],
  },
  confirmacao: {
    description: 'Confirmação e negação de ações',
    intents: [
      'confirmacao.sim',
      'confirmacao.nao',
    ],
  },
  utilitario: {
    description: 'Comandos utilitários: undo, redo, ajuda',
    intents: [
      'desfazer',
      'refazer',
    ],
  },
  instagram: {
    description: 'Comandos relacionados ao Instagram',
    intents: [
      'instagram.importar',
      'instagram.mensagens',
      'instagram.configurar',
    ],
  },
  github: {
    description: 'Comandos relacionados ao GitHub',
    intents: [
      'github.repos',
      'github.git_push',
      'github.status',
    ],
  },
  vercel: {
    description: 'Comandos relacionados à Vercel',
    intents: [
      'vercel.projetos',
      'vercel.status',
    ],
  },
  seguranca: {
    description: 'Comandos relacionados à segurança e alertas',
    intents: [
      'seguranca.configuracoes',
      'seguranca.logs',
      'seguranca.testar_whatsapp',
      'seguranca.alerta',
    ],
  },
  operacoes: {
    description: 'Comandos relacionados ao centro de operações',
    intents: [
      'operacao.alerta',
      'operacao.excluir_alerta',
      'operacao.mudanca',
      'operacao.status',
    ],
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// CORPUS DE TREINAMENTO — Versão Inicial (expansível)
// ═════════════════════════════════════════════════════════════════════════════

const TRAINING_CORPUS = {
  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: EMAIL
  // ══════════════════════════════════════════════════════════════════════════
  'email.responder': {
    pt: [
      'responde esse email',
      'responde essa mensagem',
      'manda uma resposta pro cliente',
      'quero responder esse email',
      'responde pro remetente',
      'dá uma resposta sobre isso',
      'dá retorno por email',
      'responde o cara do email',
      'manda email de volta',
      'replica essa mensagem',
      'responde sobre o orçamento',
      'responde sobre o projeto',
      'manda resposta pro contato',
      'quero dar retorno sobre isso',
      'responde falando que sim',
      'responde falando que não',
      'manda um reply',
      'responde essa thread',
      'dá retorno pro cliente',
      'responde o email atual',
      'elabora uma resposta',
      'redige uma resposta pro cliente',
      'responde educadamente',
      'manda uma resposta formal',
    ],
    es: [
      'responde este email',
      'responde este mensaje',
      'manda una respuesta al cliente',
      'quiero responder este email',
      'responde al remitente',
      'escribe una respuesta',
      'responde al tipo del email',
      'manda email de vuelta',
      'replica este mensaje',
      'responde sobre el presupuesto',
      'responde sobre el proyecto',
      'manda respuesta al contacto',
      'quiero dar feedback sobre esto',
      'responde diciendo que sí',
      'responde diciendo que no',
      'manda un reply',
      'responde este hilo',
      'da feedback al cliente',
      'responde el email actual',
      'elabora una respuesta',
      'redacta una respuesta al cliente',
      'responde educadamente',
      'manda una respuesta formal',
    ],
    ca: [
      'respon aquest email',
      'respon aquest missatge',
      'envia una resposta al client',
      'vull respondre aquest email',
      'respon al remitent',
      'escriu una resposta',
      'respon al del email',
      'envia email de tornada',
      'replica aquest missatge',
      'respon sobre el pressupost',
      'respon sobre el projecte',
      'envia resposta al contacte',
      'vull donar feedback sobre això',
      'respon dient que sí',
      'respon dient que no',
      'envia un reply',
      'respon aquest fil',
      'dóna feedback al client',
      'respon l\'email actual',
      'elabora una resposta',
      'redacta una resposta al client',
      'respon educadament',
      'envia una resposta formal',
    ],
  },

  'email.resumir': {
    pt: [
      'resume essa conversa',
      'resume esse email',
      'o que foi discutido aqui',
      'me dá um resumo',
      'resume essa thread',
      'quero um resumo rápido',
      'sintetiza essa conversa',
      'resume os pontos principais',
      'me conta o essencial',
      'resume em bullets',
      'quero saber o que aconteceu',
      'resume essa troca de emails',
    ],
    es: [
      'resume esta conversación',
      'resume este email',
      'qué se discutió aquí',
      'dame un resumen',
      'resume este hilo',
      'quiero un resumen rápido',
      'sintetiza esta conversación',
      'resume los puntos principales',
      'cuéntame lo esencial',
      'resume en bullets',
      'quiero saber qué pasó',
      'resume este intercambio de emails',
    ],
    ca: [
      'resumeix aquesta conversa',
      'resumeix aquest email',
      'què s\'ha discutit aquí',
      'dona\'m un resum',
      'resumeix aquest fil',
      'vull un resum ràpid',
      'sintetitza aquesta conversa',
      'resumeix els punts principals',
      'explica\'m l\'essencial',
      'resumeix en bullets',
      'vull saber què ha passat',
      'resumeix aquest intercanvi d\'emails',
    ],
  },

  'email.analisar': {
    pt: [
      'analisa esse email',
      'avalia esse email',
      'isso é phishing',
      'quão urgente é isso',
      'analisa o sentimento',
      'o que esse cliente quer',
      'qual a intenção desse email',
      'analisa a prioridade',
      'isso parece suspeito',
      'verifica se é seguro',
    ],
    es: [
      'analiza este email',
      'evalúa este email',
      'esto es phishing',
      'qué tan urgente es esto',
      'analiza el sentimiento',
      'qué quiere este cliente',
      'cuál es la intención de este email',
      'analiza la prioridad',
      'esto parece sospechoso',
      'verifica si es seguro',
    ],
    ca: [
      'analitza aquest email',
      'avalua aquest email',
      'això és phishing',
      'quina urgència té això',
      'analitza el sentiment',
      'què vol aquest client',
      'quina és la intenció d\'aquest email',
      'analitza la prioritat',
      'això sembla sospitós',
      'verifica si és segur',
    ],
  },

  'email.criar_rascunho': {
    pt: [
      'cria um rascunho',
      'escreve um draft',
      'gera um draft',
      'faz um rascunho de resposta',
      'cria um borrador',
      'elabora uma resposta profissional',
      'escreve um email pro cliente',
      'redige uma mensagem',
    ],
    es: [
      'crea un borrador',
      'redacta una respuesta',
      'genera un draft',
      'haz un borrador de respuesta',
      'elabora una respuesta profesional',
      'escribe un email al cliente',
      'redacta un mensaje',
    ],
    ca: [
      'crea un esborrany',
      'redacta una resposta',
      'genera un draft',
      'fes un esborrany de resposta',
      'elabora una resposta professional',
      'escriu un email al client',
      'redacta un missatge',
    ],
  },

  'email.enviar': {
    pt: [
      'envia esse email',
      'manda essa mensagem',
      'envia pro cliente',
      'dispara esse email',
      'manda agora',
      'envia imediatamente',
      'enviar email para',
      'manda email para o cliente',
      'envia email pro contato',
      'disparar email de cobrança',
      'enviar email com assunto',
      'manda email urgente',
      'envia email pro cliente sobre o projeto',
    ],
    es: [
      'envía este email',
      'manda este mensaje',
      'envía al cliente',
      'dispara este email',
      'manda ahora',
      'envía inmediatamente',
      'enviar email a',
      'manda email al cliente',
      'envía email al contacto',
      'disparar email de cobro',
      'enviar email con asunto',
      'manda email urgente',
      'envía email al cliente sobre el proyecto',
    ],
    ca: [
      'envia aquest email',
      'envia aquest missatge',
      'envia al client',
      'dispara aquest email',
      'envia ara',
      'envia immediatament',
      'enviar email a',
      'envia email al client',
      'envia email al contacte',
      'disparar email de cobrament',
      'enviar email amb assumpte',
      'envia email urgent',
      'envia email al client sobre el projecte',
    ],
  },

  'email.arquivar': {
    pt: [
      'arquiva esse email',
      'arquiva essa mensagem',
      'manda pra arquivados',
      'arquiva isso',
      'guarda esse email',
    ],
    es: [
      'archiva este email',
      'archiva este mensaje',
      'manda a archivados',
      'archiva esto',
      'guarda este email',
    ],
    ca: [
      'arquiva aquest email',
      'arquiva aquest missatge',
      'envia a arxivats',
      'arquiva això',
      'guarda aquest email',
    ],
  },

  'email.mover_lixeira': {
    pt: [
      'manda pra lixeira',
      'deleta esse email',
      'exclui essa mensagem',
      'joga no lixo',
      'remove esse email',
    ],
    es: [
      'manda a la papelera',
      'borra este email',
      'elimina este mensaje',
      'tira a la basura',
      'elimina este email',
    ],
    ca: [
      'envia a la paperera',
      'esborra aquest email',
      'elimina aquest missatge',
      'tira a la brossa',
      'elimina aquest email',
    ],
  },

  'email.listar_nao_lidos': {
    pt: [
      'mostra emails não lidos',
      'quais emails são novos',
      'lista mensagens não lidas',
      'tem email novo',
      'mostra notificações de email',
    ],
    es: [
      'muestra emails no leídos',
      'qué emails son nuevos',
      'lista mensajes no leídos',
      'hay email nuevo',
      'muestra notificaciones de email',
    ],
    ca: [
      'mostra emails no llegits',
      'quins emails són nous',
      'llista missatges no llegits',
      'hi ha email nou',
      'mostra notificacions d\'email',
    ],
  },

  'email.marcar_lido': {
    pt: [
      'marcar email como lido',
      'marcar email lido',
      'email lido',
      'marcar como lido',
      'marcar mensagem como lida',
      'marca esse email como lido',
      'marcar lido',
    ],
    es: [
      'marcar email como leído',
      'marcar email leído',
      'email leído',
      'marcar como leído',
      'marcar mensaje como leída',
      'marca este email como leído',
      'marcar leído',
    ],
    ca: [
      'marcar email com a llegit',
      'marcar email llegit',
      'email llegit',
      'marcar com a llegit',
      'marcar missatge com a llegida',
      'marca aquest email com a llegit',
      'marcar llegit',
    ],
  },

  'email.sincronizar': {
    pt: [
      'sincroniza emails',
      'atualiza a caixa de entrada',
      'puxa emails novos',
      'sincroniza gmail',
      'atualiza mensagens',
    ],
    es: [
      'sincroniza emails',
      'actualiza la bandeja de entrada',
      'trae emails nuevos',
      'sincroniza gmail',
      'actualiza mensajes',
    ],
    ca: [
      'sincronitza emails',
      'actualitza la safata d\'entrada',
      'agafa emails nous',
      'sincronitza gmail',
      'actualitza missatges',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: TAREFAS
  // ══════════════════════════════════════════════════════════════════════════
  'tarefa.criar': {
    pt: [
      'cria uma tarefa',
      'adiciona tarefa',
      'nova tarefa',
      'cria lembrete',
      'preciso fazer uma tarefa',
      'adiciona atividade',
      'cria uma coisa pra fazer',
      'nova atividade',
      'cria tarefa urgente',
      'adiciona ao backlog',
      // Typos comuns
      'crria tarefa',
      'cria tarfa',
      'cria tareefa',
      'nova tareefa',
    ],
    es: [
      'crea una tarea',
      'añade tarea',
      'nueva tarea',
      'crea recordatorio',
      'necesito hacer una tarea',
      'añade actividad',
      'crea algo que hacer',
      'nueva actividad',
      'crea tarea urgente',
      'añade al backlog',
    ],
    ca: [
      'crea una tasca',
      'afegeix tasca',
      'nova tasca',
      'crea recordatori',
      'necessito fer una tasca',
      'afegeix activitat',
      'crea una cosa per fer',
      'nova activitat',
      'crea tasca urgent',
      'afegeix al backlog',
    ],
  },

  'tarefa.listar': {
    pt: [
      'mostra minhas tarefas',
      'lista tarefas pendentes',
      'quais tarefas tenho',
      'mostra o backlog',
      'tarefas pra hoje',
      'o que preciso fazer',
      'lista atividades',
      'minhas tarefas pendentes',
    ],
    es: [
      'muestra mis tareas',
      'lista tareas pendientes',
      'qué tareas tengo',
      'muestra el backlog',
      'tareas para hoy',
      'qué necesito hacer',
      'lista actividades',
      'mis tareas pendientes',
    ],
    ca: [
      'mostra les meves tasques',
      'llista tasques pendents',
      'quines tasques tinc',
      'mostra el backlog',
      'tasques per avui',
      'què necessito fer',
      'llista activitats',
      'les meves tasques pendents',
    ],
  },

  'tarefa.concluir': {
    pt: [
      'marca como concluída',
      'finaliza essa tarefa',
      'conclui a tarefa',
      'marca como feito',
      'tarefa pronta',
      'termina essa atividade',
    ],
    es: [
      'marca como completada',
      'finaliza esta tarea',
      'concluye la tarea',
      'marca como hecho',
      'tarea lista',
      'termina esta actividad',
    ],
    ca: [
      'marca com a completada',
      'finalitza aquesta tasca',
      'conclou la tasca',
      'marca com a fet',
      'tasca llista',
      'termina aquesta activitat',
    ],
  },

  'tarefa.atribuir': {
    pt: [
      'atribui tarefa pro Abner',
      'manda essa tarefa pro Nonoke',
      'delega pro Elias',
      'quem vai fazer isso',
      'atribui responsável',
      'manda pro time',
    ],
    es: [
      'asigna tarea a Abner',
      'manda esta tarea a Nonoke',
      'delega a Elias',
      'quién va a hacer esto',
      'asigna responsable',
      'manda al equipo',
    ],
    ca: [
      'assigna tasca a l\'Abner',
      'envia aquesta tasca al Nonoke',
      'delega a l\'Elias',
      'qui farà això',
      'assigna responsable',
      'envia a l\'equip',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: FINANCEIRO
  // ══════════════════════════════════════════════════════════════════════════
  'financeiro.consultar_caixa': {
    pt: [
      'quanto temos no caixa',
      'saldo atual',
      'como está o caixa',
      'balanço atual',
      'dinheiro disponível',
      'quanto temos em conta',
      'consulta caixa',
      'status financeiro',
    ],
    es: [
      'cuánto tenemos en caja',
      'saldo actual',
      'cómo está la caja',
      'balance actual',
      'dinero disponible',
      'cuánto tenemos en cuenta',
      'consulta caja',
      'estado financiero',
    ],
    ca: [
      'quant tenim a caixa',
      'saldo actual',
      'com està la caixa',
      'balanç actual',
      'diners disponibles',
      'quant tenim al compte',
      'consulta caixa',
      'estat financer',
    ],
  },

  'financeiro.adicionar_receita': {
    pt: [
      'adiciona receita',
      'nova receita',
      'registra pagamento',
      'cliente pagou',
      'entrada de dinheiro',
      'adiciona pagamento recebido',
    ],
    es: [
      'añade ingreso',
      'nuevo ingreso',
      'registra pago',
      'cliente pagó',
      'entrada de dinero',
      'añade pago recibido',
    ],
    ca: [
      'afegeix ingrés',
      'nou ingrés',
      'registra pagament',
      'client ha pagat',
      'entrada de diners',
      'afegeix pagament rebut',
    ],
  },

  'financeiro.adicionar_despesa': {
    pt: [
      'adiciona despesa',
      'nova despesa',
      'novo gasto para registrar',
      'tivemos um custo',
      'saída de dinheiro',
      'registra pagamento feito',
      'quero registrar uma despesa',
      'registrar despesa',
      'nova saída de dinheiro',
      'temos um gasto novo',
    ],
    es: [
      'añade gasto',
      'nuevo gasto',
      'nuevo coste para registrar',
      'tuvimos un coste',
      'salida de dinero',
      'registra pago realizado',
    ],
    ca: [
      'afegeix despesa',
      'nova despesa',
      'nou cost per registrar',
      'hem tingut un cost',
      'sortida de diners',
      'registra pagament fet',
    ],
  },

  'financeiro.listar_pagamentos': {
    pt: [
      'listar pagamentos',
      'mostrar pagamentos',
      'ver pagamentos',
      'pagamentos recebidos',
      'receitas registradas',
      'histórico de pagamentos',
      'quais pagamentos temos',
    ],
    es: [
      'listar pagos',
      'mostrar pagos',
      'ver pagos',
      'pagos recibidos',
      'ingresos registrados',
      'histórico de pagos',
      'qué pagos tenemos',
    ],
    ca: [
      'llistar pagaments',
      'llistar pagaments',
      'veure pagaments',
      'pagaments rebuts',
      'ingressos registrats',
      'històric de pagaments',
      'quins pagaments tenim',
    ],
  },

  'financeiro.listar_despesas': {
    pt: [
      'listar despesas',
      'mostrar despesas',
      'ver despesas',
      'gastos registrados',
      'todas as despesas',
      'histórico de despesas',
      'quais despesas temos',
    ],
    es: [
      'listar gastos',
      'mostrar gastos',
      'ver gastos',
      'costes registrados',
      'todos los gastos',
      'histórico de gastos',
      'qué gastos tenemos',
    ],
    ca: [
      'llistar despeses',
      'mostrar despeses',
      'veure despeses',
      'costos registrats',
      'despeses del mes',
      'històric de despeses',
      'quines despeses tenim',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: SOCIAL
  // ══════════════════════════════════════════════════════════════════════════
  'social': {
    pt: [
      'oi',
      'ola',
      'oi luna',
      'ola luna',
      'bom dia',
      'boa tarde',
      'boa noite',
      'tudo bem',
      'como vai',
      'como você está',
      'como voce esta',
      'e ai',
      'e aí',
      'salve',
      'opa',
      'iae',
    ],
    es: [
      'hola',
      'hola luna',
      'buenos dias',
      'buenas tardes',
      'buenas noches',
      'todo bien',
      'como estás',
      'como va',
      'que tal',
      'saludos',
    ],
    ca: [
      'hola',
      'hola luna',
      'bon dia',
      'bona tarda',
      'bona nit',
      'com estàs',
      'com va',
      'que tal',
      'salutacions',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: WHATSAPP
  // ══════════════════════════════════════════════════════════════════════════
  'whatsapp.enviar_mensagem': {
    pt: [
      'manda mensagem no whatsapp',
      'envia mensagem pro cliente',
      'manda zap',
      'envia whatsapp',
      'manda msg pro contato',
      'envia mensagem pelo whatsapp',
    ],
    es: [
      'manda mensaje por whatsapp',
      'envía mensaje al cliente',
      'manda zap',
      'envía whatsapp',
      'manda msg al contacto',
      'envía mensaje por whatsapp',
    ],
    ca: [
      'envia missatge per whatsapp',
      'envia missatge al client',
      'envia zap',
      'envia whatsapp',
      'envia msg al contacte',
      'envia missatge per whatsapp',
    ],
  },

  'whatsapp.responder_cliente': {
    pt: [
      'responde no whatsapp',
      'responde a mensagem',
      'manda resposta no zap',
      'reply no whatsapp',
      'responde o cliente no zap',
    ],
    es: [
      'responde por whatsapp',
      'responde el mensaje',
      'manda respuesta por zap',
      'reply por whatsapp',
      'responde al cliente por zap',
    ],
    ca: [
      'respon per whatsapp',
      'respon el missatge',
      'envia resposta per zap',
      'reply per whatsapp',
      'respon el client per zap',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: ORÇAMENTOS
  // ══════════════════════════════════════════════════════════════════════════
  'orcamento.criar': {
    pt: [
      'cria orçamento',
      'novo orçamento',
      'faz proposta',
      'gera orçamento pro cliente',
      'preciso de um orçamento',
      'cria proposta comercial',
      // Typos comuns
      'faz orcamentu',
      'cria orcamento',
      'faz propostta',
      'novo orçamentu',
    ],
    es: [
      'crea presupuesto',
      'nuevo presupuesto',
      'haz propuesta',
      'genera presupuesto para el cliente',
      'necesito un presupuesto',
      'crea propuesta comercial',
    ],
    ca: [
      'crea pressupost',
      'nou pressupost',
      'fes proposta',
      'genera pressupost per al client',
      'necessito un pressupost',
      'crea proposta comercial',
    ],
  },

  'orcamento.enviar_cliente': {
    pt: [
      'manda orçamento pro cliente',
      'envia proposta',
      'dispara o orçamento',
      'envia proposta comercial',
      'manda o orçamento por email',
    ],
    es: [
      'manda presupuesto al cliente',
      'envía propuesta',
      'dispara el presupuesto',
      'envía propuesta comercial',
      'manda el presupuesto por email',
    ],
    ca: [
      'envia pressupost al client',
      'envia proposta',
      'dispara el pressupost',
      'envia proposta comercial',
      'envia el pressupost per email',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: PROJETOS
  // ══════════════════════════════════════════════════════════════════════════
  'projeto.listar': {
    pt: [
      'listar projetos',
      'mostrar projetos',
      'ver projetos',
      'projetos ativos',
      'quais projetos temos',
      'todos os projetos',
      'meus projetos',
    ],
    es: [
      'listar proyectos',
      'mostrar proyectos',
      'ver proyectos',
      'proyectos activos',
      'qué proyectos tenemos',
      'estado de los proyectos',
      'mis proyectos',
    ],
    ca: [
      'llistar projectes',
      'mostrar projectes',
      'veure projectes',
      'projectes actius',
      'quins projectes tenim',
      'tots els projectes',
      'els meus projectes',
    ],
  },

  'projeto.criar': {
    pt: [
      'criar projeto',
      'novo projeto',
      'adicionar projeto',
      'criar novo projeto',
    ],
    es: [
      'crear proyecto',
      'nuevo proyecto',
      'añadir proyecto',
      'crear nuevo proyecto',
    ],
    ca: [
      'crear projecte',
      'nou projecte',
      'afegir projecte',
      'crear nou projecte',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: IDEIAS
  // ══════════════════════════════════════════════════════════════════════════
  'ideia.listar': {
    pt: [
      'listar ideias',
      'mostrar ideias',
      'ver ideias',
      'ideias salvas',
      'brainstorms',
      'quais ideias temos',
      'minhas ideias',
      'sessao de ideias',
    ],
    es: [
      'listar ideas',
      'mostrar ideas',
      'ver ideas',
      'ideas guardadas',
      'brainstorms',
      'qué ideas tenemos',
      'mis ideas',
      'sesión de ideas',
    ],
    ca: [
      'llistar idees',
      'mostrar idees',
      'veure idees',
      'idees guardades',
      'brainstorms',
      'quines idees tenim',
      'les meves idees',
      'sessió d\'idees',
    ],
  },

  'ideia.criar': {
    pt: [
      'criar ideia',
      'nova ideia',
      'adicionar ideia',
      'novo brainstorm',
      'criar brainstorm',
    ],
    es: [
      'crear idea',
      'nueva idea',
      'añadir idea',
      'nuevo brainstorm',
      'crear brainstorm',
    ],
    ca: [
      'crear idea',
      'nova idea',
      'afegir idea',
      'nou brainstorm',
      'crear brainstorm',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: SISTEMA / GERAL
  // ══════════════════════════════════════════════════════════════════════════
  'whatsapp.verificar_mencoes': {
    pt: [
      'verificar mencoes',
      'checar mencoes',
      'tem alguem me mencionando',
      'quem me mencionou',
      'verifica se tem mencao',
      'menções pendentes',
      '@luna mencoes',
      'tem mencao no whatsapp',
    ],
    es: [
      'verificar menciones',
      'checar menciones',
      'hay alguien mencionándome',
      'quién me mencionó',
      'verifica si hay mención',
      'menciones pendientes',
      '@luna menciones',
      'hay mención en whatsapp',
    ],
    ca: [
      'verificar mencions',
      'comprovar mencions',
      'hi ha algú mencionant-me',
      'qui m\'ha mencionat',
      'verifica si hi ha menció',
      'mencions pendents',
      '@luna mencions',
      'hi ha menció al whatsapp',
    ],
  },

  'link.listar': {
    pt: [
      'listar links',
      'mostrar links',
      'ver links',
      'links cadastrados',
      'recursos salvos',
      'mostra os links',
      'quais links temos',
    ],
    es: [
      'listar links',
      'mostrar links',
      'ver links',
      'links registrados',
      'recursos guardados',
      'muestra los links',
      'qué links tenemos',
    ],
    ca: [
      'llistar links',
      'mostrar links',
      'veure links',
      'links registrats',
      'recursos guardats',
      'mostra els links',
      'quins links tenim',
    ],
  },

  'link.adicionar': {
    pt: [
      'adicionar link',
      'salvar link',
      'guardar link',
      'novo link',
      'adicionar url',
      'salvar url',
    ],
    es: [
      'añadir link',
      'guardar link',
      'salvar link',
      'nuevo link',
      'añadir url',
      'guardar url',
    ],
    ca: [
      'afegir link',
      'guardar link',
      'salvar link',
      'nou link',
      'afegir url',
      'guardar url',
    ],
  },

  'sistema.notificacoes': {
    pt: [
      'listar notificacoes',
      'mostrar notificacoes',
      'ver notificacoes',
      'notificacoes pendentes',
      'tem notificacao',
      'notificacoes do sistema',
      'alertas',
      'ver alertas',
    ],
    es: [
      'listar notificaciones',
      'mostrar notificaciones',
      'ver notificaciones',
      'notificaciones pendientes',
      'hay notificación',
      'notificaciones del sistema',
      'alertas',
      'ver alertas',
    ],
    ca: [
      'llistar notificacions',
      'mostrar notificacions',
      'veure notificacions',
      'notificacions pendents',
      'hi ha notificació',
      'notificacions del sistema',
      'alertes',
      'veure alertes',
    ],
  },

  'sistema.ajuda': {
    pt: [
      'ajuda',
      'o que você pode fazer',
      'como usar',
      'me ajuda',
      'preciso de ajuda',
      'o que consigo fazer',
      'quais comandos você entende',
      'me mostra as opções',
    ],
    es: [
      'ayuda',
      'qué puedes hacer',
      'cómo usar',
      'ayúdame',
      'necesito ayuda',
      'qué puedo hacer',
      'qué comandos entiendes',
      'muéstrame las opciones',
    ],
    ca: [
      'ajuda',
      'què pots fer',
      'com usar',
      'ajuda\'m',
      'necessito ajuda',
      'què puc fer',
      'quins comandaments entens',
      'mostra\'m les opcions',
    ],
  },

  'sistema.status': {
    pt: [
      'como está o sistema',
      'status do dashboard',
      'tudo ok',
      'tem algum problema',
      'como está tudo',
      'verifica status',
    ],
    es: [
      'cómo está el sistema',
      'estado del dashboard',
      'todo ok',
      'hay algún problema',
      'cómo está todo',
      'verifica estado',
    ],
    ca: [
      'com està el sistema',
      'estat del dashboard',
      'tot ok',
      'hi ha algun problema',
      'com està tot',
      'verifica estat',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: CONFIRMAÇÃO / NEGAÇÃO
  // ══════════════════════════════════════════════════════════════════════════
  'confirmacao.sim': {
    pt: [
      'sim', 'confirmo', 'pode', 'executa', 'vai', 'faz', 'ok', 'beleza', 'certo',
      'isso mesmo', 'exatamente', 'pode ir', 'pode fazer', 'confirma', 'aprovo',
      'manda ver', 'pode executar', 'faz isso', 'vai em frente', 'deixa assim',
      'correto', 'tá certo', 'tudo certo', 'show', 'pode prosseguir', 'segue',
    ],
    es: [
      'si', 'confirmo', 'puede', 'ejecuta', 'vale', 'hazlo', 'ok', 'correcto',
      'eso mismo', 'exactamente', 'puede ir', 'puede hacer', 'confirma', 'apruebo',
      'dale', 'puede ejecutar', 'haz eso', 'sigue adelante', 'déjalo así',
      'correcto', 'todo correcto', 'puede proseguir', 'sigue',
    ],
    ca: [
      'sí', 'confirmo', 'puc', 'executa', 'val', 'fes-ho', 'ok', 'correcte',
      'això mateix', 'exactament', 'pot anar', 'pot fer', 'confirma', 'aprovo',
      'endavant', 'pot executar', 'fes això', 'segueix endavant', 'deixa-ho així',
      'correcte', 'tot correcte', 'pot proseguir', 'segueix',
    ],
  },
  'confirmacao.nao': {
    pt: [
      'não', 'cancela', 'espera', 'para', 'não quero', 'errado', 'deixa',
      'não faz', 'não executa', 'cancela isso', 'pare', 'não é isso',
      'deixa quieto', 'não faça', 'não execute', 'cancela tudo', 'desiste',
      'não é isso que eu quero', 'volta', 'desfaz', 'não prossegue',
    ],
    es: [
      'no', 'cancela', 'espera', 'para', 'no quiero', 'errado', 'deja',
      'no hagas', 'no ejecutes', 'cancela eso', 'para', 'no es eso',
      'déjalo', 'no hagas eso', 'no ejecutes eso', 'cancela todo', 'desiste',
      'no es eso lo que quiero', 'vuelve', 'deshaz', 'no prosigas',
    ],
    ca: [
      'no', 'cancel·la', 'espera', 'para', 'no vull', 'errat', 'deixa',
      'no facis', 'no executis', 'cancel·la això', 'atura', 'no és això',
      'deixa-ho estar', 'no facis això', 'no executis això', 'cancel·la tot', 'desisteix',
      'no és això el que vull', 'torna', 'desfés', 'no prossegueixis',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: UTILITÁRIO — Undo, Redo, Ajuda
  // ══════════════════════════════════════════════════════════════════════════
  'desfazer': {
    pt: [
      'desfazer', 'desfaz', 'voltar', 'volta', 'ctrl z', 'control z',
      'volta atrás', 'voltar atrás', 'desfazer isso', 'volta isso',
      'não era isso', 'me enganei', 'errei', 'volta como estava',
      'desfaz a última ação', 'volta a última coisa', 'cancela o que fez',
      'deshacer', 'ctrl z', 'volver atrás', 'retroceder',
    ],
    es: [
      'deshacer', 'deshaz', 'volver', 'vuelve', 'ctrl z', 'control z',
      'volver atrás', 'retroceder', 'deshacer esto', 'vuelve esto',
      'no era eso', 'me equivoqué', 'erré', 'vuelve como estaba',
      'deshaz la última acción', 'vuelve la última cosa', 'cancela lo que hiciste',
    ],
    ca: [
      'desfer', 'desfés', 'tornar', 'torna', 'ctrl z', 'control z',
      'tornar enrere', 'retrocedir', 'desfer això', 'torna això',
      'no era això', 'm\'he equivocat', 'he errat', 'torna com estava',
      'desfés l\'última acció', 'torna l\'última cosa', 'cancel·la el que vas fer',
    ],
  },
  'refazer': {
    pt: [
      'refazer', 'refaz', 'ctrl y', 'control y', 'fazer de novo',
      'refazer isso', 'refaz a última', 'refazer a ação', 'refaz o que desfez',
      'rehacer', 'ctrl y', 'hacer de nuevo',
    ],
    es: [
      'rehacer', 'rehaz', 'ctrl y', 'control y', 'hacer de nuevo',
      'rehacer esto', 'rehaz la última', 'rehacer la acción', 'rehaz lo que deshiciste',
    ],
    ca: [
      'refer', 'refés', 'ctrl y', 'control y', 'fer de nou',
      'refer això', 'refés l\'última', 'refer l\'acció', 'refés el que vas desfer',
    ],
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOMÍNIO: ADMINISTRAÇÃO DE SISTEMA — REMOVIDO (foco no Dashboard)
  // ══════════════════════════════════════════════════════════════════════════

  // ══════════════════════════════════════════════════════════════════════════
  // FALLBACK / NONE — Frases que NÃO pertencem a nenhum domínio do NEXO
  // Objetivo: evitar false positives quando o usuário fala de coisas
  // completamente fora do contexto do ERP (comida, clima, notícias, etc.)
  // ══════════════════════════════════════════════════════════════════════════
  'None': {
    pt: [
      // Comida e bebida
      'batata frita', 'cachorro quente', 'eu gosto de pizza',
      'hambúrguer com queijo', 'sushi de salmão', 'café da manhã',
      'jantar com a família', 'almoço no restaurante',
      // Clima e tempo
      'o clima está bom hoje', 'qual é a previsão do tempo',
      'está chovendo lá fora', 'fez sol ontem',
      // Entretenimento
      'vamos ao cinema', 'me conta uma piada', 'melhor filme do ano',
      'recomendação de série', 'música boa para ouvir',
      // Conhecimento geral
      'quem é o presidente', 'como funciona a gravidade',
      'qual a capital do japão', 'quanto é dois mais dois',
      'quem descobriu o brasil', 'quando foi a segunda guerra',
      // Notícias e mundo
      'notícias do mundo', 'resultado do jogo de ontem',
      'últimas notícias de hoje', 'política internacional',
      // Receitas e domesticidade
      'receita de bolo de chocolate', 'como fazer macarrão',
      'como cozinhar arroz', 'ingredientes para lasanha',
      // Texto aleatório / nonsense
      'xyz abc def ghi', 'lorem ipsum dolor sit', 'foo bar baz qux',
      'asdfghjkl qwerty', 'números aleatórios 987654',
      // Cores, frutas, natureza
      'banana maçã laranja', 'vermelho azul verde',
      'sol lua estrela', 'montanha oceano floresta',
      // Frases com preposições que podem confundir (simulando overlap)
      'no espaço sideral', 'para o outro lado', 'pro lado de lá',
      'sobre a mesa', 'debaixo da cadeira', 'dentro do carro',
      // Mix de palavras do domínio em contexto irrelevante
      'email do meu amigo', 'tarefa de casa da escola',
      'projeto de artes', 'cliente do restaurante',
      'caixa de sapato', 'mensagem no grupo da família',
      'orçamento da construção da casa', 'lead de guitarra',
      'ideia genial para jantar', 'status do relacionamento',
    ],
    es: [
      // Comida y bebida
      'patatas fritas', 'perro caliente', 'me gusta la pizza',
      'hamburguesa con queso', 'sushi de salmón', 'desayuno completo',
      'cena con la familia', 'almuerzo en el restaurante',
      // Clima y tiempo
      'el clima está bueno', 'qué tiempo hace hoy',
      'está lloviendo afuera', 'hizo sol ayer',
      // Entretenimiento
      'vamos al cine', 'cuéntame un chiste', 'mejor película del año',
      'recomendación de serie', 'buena música para escuchar',
      // Conocimiento general
      'quién es el presidente', 'cómo funciona la gravedad',
      'cuál es la capital de japón', 'cuánto es dos más dos',
      'quién descubrió américa', 'cuándo fue la segunda guerra',
      // Noticias y mundo
      'noticias del mundo', 'resultado del partido',
      'últimas noticias de hoy', 'política internacional',
      // Recetas y domesticidad
      'receta de tarta de chocolate', 'cómo hacer pasta',
      'cómo cocinar arroz', 'ingredientes para lasaña',
      // Texto aleatorio / nonsense
      'xyz abc def ghi', 'lorem ipsum dolor sit', 'foo bar baz qux',
      'asdfghjkl qwerty', '1234567890 prueba',
      // Colores, frutas, naturaleza
      'plátano manzana naranja', 'rojo azul verde',
      'palabras al azar sin sentido', 'montaña océano bosque',
      // Frases con preposiciones que pueden confundir
      'en el espacio sideral', 'para el otro lado', 'al lado de allá',
      'sobre la mesa', 'debajo de la silla', 'dentro del coche',
      // Mix de palabras del dominio en contexto irrelevante
      'email de mi amigo', 'tarea de la escuela',
      'proyecto de arte', 'cliente del restaurante',
      'caja de zapatos', 'mensaje en el grupo familiar',
      'presupuesto de la construcción', 'lead de guitarra',
      'idea genial para cenar', 'estado de la relación',
    ],
    ca: [
      // Menjar i beguda
      'patates fregides', 'gos calent', 'm\'agrada la pizza',
      'hamburguesa amb formatge', 'sushi de salmó', 'esmorzar complet',
      'sopar amb la família', 'dinar al restaurant',
      // Clima i temps
      'el temps és bo avui', 'quina previsió hi ha',
      'plou a fora', 'va fer sol ahir',
      // Entreteniment
      'anem al cinema', 'explica\'m un acudit', 'millor pel·lícula de l\'any',
      'recomanació de sèrie', 'bona música per escoltar',
      // Coneixement general
      'qui és el president', 'com funciona la gravetat',
      'quina és la capital del japó', 'quant és dos més dos',
      'qui va descobrir américa', 'quan va ser la segona guerra',
      // Notícies i món
      'notícies del món', 'resultat del partit',
      'últimes notícies d\'avui', 'política internacional',
      // Receptes i llar
      'recepta de pastís de xocolata', 'com fer pasta',
      'com cuinar arròs', 'ingredients per lasanya',
      // Text aleatori / nonsense
      'xyz abc def ghi', 'lorem ipsum dolor sit', 'foo bar baz qux',
      'asdfghjkl qwerty', '1234567890 prova',
      // Colors, fruites, natura
      'plàtan poma taronja', 'vermell blau verd',
      'sol lluna estrella', 'muntanya oceà bosc',
      // Frases amb preposicions que poden confondre
      'a l\'espai sideral', 'per l\'altre costat', 'cap al costat de llà',
      'sobre la taula', 'sota la cadira', 'dins del cotxe',
      // Mix de paraules del domini en context irrelevant
      'email del meu amic', 'tasca de l\'escola',
      'projecte d\'art', 'client del restaurant',
      'caixa de sabates', 'missatge al grup familiar',
      'pressupost de la construcció', 'lead de guitarra',
      'idea genial per sopar', 'estat de la relació',
    ],
  },
  'email.listar_rascunhos': {
    pt: [
      'rascunhos pendentes',
      'ver rascunhos',
      'drafts pendentes',
      'listar rascunhos da luna',
      'rascunhos para aprovar',
      'mostrar drafts',
      'ver drafts pendentes',
      'quais rascunhos temos',
      'rascunhos da luna',
      'revisar rascunhos',
      'conferir drafts',
      'ver rascunhos pendentes',
      'drafts para aprovação',
      'listar drafts',
    ],
    es: [
      'borradores pendientes',
      'ver borradores',
      'drafts pendientes',
      'listar borradores de luna',
      'borradores para aprobar',
      'mostrar drafts',
      'ver borradores pendientes',
      'qué borradores tenemos',
      'borradores de luna',
      'revisar borradores',
      'conferir drafts',
      'ver borradores pendientes',
      'drafts para aprobación',
      'listar drafts',
    ],
    ca: [
      'esborranys pendents',
      'veure esborranys',
      'drafts pendents',
      'llistar esborranys de luna',
      'esborranys per aprovar',
      'mostrar drafts',
      'veure esborranys pendents',
      'quins esborranys tenim',
      'esborranys de luna',
      'revisar esborranys',
      'revisar drafts',
      'veure esborranys pendents',
      'drafts per aprovació',
      'llistar drafts',
    ],
  },
  'email.aprovar_rascunho': {
    pt: [
      'aprovar rascunho',
      'aprovar draft',
      'aceitar rascunho',
      'ok para o rascunho',
      'aprovar resposta da luna',
      'aprovar email da luna',
      'confirmar rascunho',
      'tá bom o rascunho',
      'pode enviar o rascunho',
      'aprovar e enviar',
    ],
    es: [
      'aprobar borrador',
      'aprobar draft',
      'aceptar borrador',
      'ok para el borrador',
      'aprobar respuesta de luna',
      'aprobar email de luna',
      'confirmar borrador',
      'está bien el borrador',
      'puede enviar el borrador',
      'aprobar y enviar',
    ],
    ca: [
      'aprovar esborrany',
      'aprovar draft',
      'acceptar esborrany',
      'ok per a l\'esborrany',
      'aprovar resposta de luna',
      'aprovar email de luna',
      'confirmar esborrany',
      'està bé l\'esborrany',
      'pot enviar l\'esborrany',
      'aprovar i enviar',
    ],
  },
  'email.rejeitar_rascunho': {
    pt: [
      'rejeitar rascunho',
      'rejeitar draft',
      'não aprovar rascunho',
      'rascunho não tá bom',
      'recusar rascunho',
      'descartar draft',
      'não gostei do rascunho',
      'refazer rascunho',
      'rejeitar resposta da luna',
    ],
    es: [
      'rechazar borrador',
      'rechazar draft',
      'no aprobar borrador',
      'el borrador no está bien',
      'recusar borrador',
      'descartar draft',
      'no me gusta el borrador',
      'rehacer borrador',
      'rechazar respuesta de luna',
    ],
    ca: [
      'rebutjar esborrany',
      'rebutjar draft',
      'no aprovar esborrany',
      'l\'esborrany no està bé',
      'recusar esborrany',
      'descartar draft',
      'no m\'agrada l\'esborrany',
      'refer esborrany',
      'rebutjar resposta de luna',
    ],
  },
  'email.favoritar': {
    pt: [
      'favoritar email',
      'dar estrela no email',
      'email com estrela',
      'salvar como favorito',
      'adicionar aos favoritos',
      'email favorito',
      'marcar com estrela',
      'colocar estrela',
      'star no email',
    ],
    es: [
      'favoritar email',
      'dar estrella al email',
      'poner estrella en email',
      'guardar como favorito',
      'añadir a favoritos',
      'email favorito',
      'marcar con estrella',
      'poner estrella',
      'star en email',
    ],
    ca: [
      'favorit email',
      'donar estrella a l\'email',
      'email amb estrella',
      'guardar com a favorit',
      'afegir a favorits',
      'email favorit',
      'marcar amb estrella',
      'posar estrella',
      'star a l\'email',
    ],
  },
  'email.desfavoritar': {
    pt: [
      'tirar estrela',
      'desfavoritar email',
      'remover dos favoritos',
      'tirar dos importantes',
      'desmarcar estrela',
    ],
    es: [
      'quitar estrella',
      'desfavoritar email',
      'remover de favoritos',
      'quitar de importantes',
      'desmarcar estrella',
    ],
    ca: [
      'treure estrella',
      'desfavorit email',
      'eliminar de favorits',
      'treure d\'importants',
      'desmarcar estrella',
    ],
  },
  'email.marcar_spam': {
    pt: [
      'marcar como spam',
      'isso é spam',
      'lixo eletrônico',
      'email suspeito',
      'spam',
      'mover para spam',
      'denunciar spam',
    ],
    es: [
      'marcar como spam',
      'esto es spam',
      'correo basura',
      'email sospechoso',
      'spam',
      'mover a spam',
      'denunciar spam',
    ],
    ca: [
      'marcar com a spam',
      'això és spam',
      'correu brossa',
      'email sospitós',
      'spam',
      'moure a spam',
      'denunciar spam',
    ],
  },
  'email.restaurar_lixeira': {
    pt: [
      'restaurar email',
      'tirar da lixeira',
      'recuperar email',
      'restaurar da lixeira',
      'desfazer exclusão',
      'recuperar mensagem',
    ],
    es: [
      'restaurar email',
      'sacar de la papelera',
      'recuperar email',
      'restaurar de la papelera',
      'deshacer eliminación',
      'recuperar mensaje',
    ],
    ca: [
      'restaurar email',
      'treure de la paperera',
      'recuperar email',
      'restaurar de la paperera',
      'desfer eliminació',
      'recuperar missatge',
    ],
  },
  'email.listar_arquivados': {
    pt: [
      'emails arquivados',
      'listar arquivados',
      'ver arquivados',
      'emails guardados',
      'caixa de arquivados',
      'archived',
    ],
    es: [
      'emails archivados',
      'listar archivados',
      'ver archivados',
      'emails almacenados',
      'caja de archivados',
      'archived',
    ],
    ca: [
      'emails arxivats',
      'llistar arxivats',
      'veure arxivats',
      'emails guardats',
      'caixa d\'arxivats',
      'archived',
    ],
  },
  'email.listar_lixeira': {
    pt: [
      'lixeira',
      'emails na lixeira',
      'ver lixeira',
      'papelera',
      'emails excluídos',
      'trash',
    ],
    es: [
      'papelera',
      'emails en la papelera',
      'ver papelera',
      'basura',
      'emails eliminados',
      'trash',
    ],
    ca: [
      'paperera',
      'emails a la paperera',
      'veure paperera',
      'brossa',
      'emails eliminats',
      'trash',
    ],
  },
  'email.listar_enviados': {
    pt: [
      'emails enviados',
      'sent',
      'caixa de enviados',
      'emails que enviei',
      'ver enviados',
      'outbox',
    ],
    es: [
      'emails enviados',
      'sent',
      'bandeja de enviados',
      'emails que envié',
      'ver enviados',
      'outbox',
    ],
    ca: [
      'emails enviats',
      'sent',
      'safata d\'enviats',
      'emails que vaig enviar',
      'veure enviats',
      'outbox',
    ],
  },
  'email.listar_com_estrela': {
    pt: [
      'emails com estrela',
      'favoritos',
      'starred',
      'emails favoritos',
      'emails salvos',
      'ver favoritos',
    ],
    es: [
      'emails con estrella',
      'favoritos',
      'starred',
      'emails guardados',
      'emails destacados',
      'ver favoritos',
    ],
    ca: [
      'emails amb estrella',
      'favorits',
      'starred',
      'emails importants',
      'emails destacats',
      'veure favorits',
    ],
  },
  'tarefa.minhas': {
    pt: [
      'minhas tarefas',
      'tarefas minhas',
      'o que tenho que fazer',
      'minhas pendências',
      'tarefas atribuídas a mim',
      'meu workload',
      'o que é meu',
      'tarefas pessoais',
      'meu backlog',
    ],
    es: [
      'mis tareas',
      'tareas mías',
      'qué tengo que hacer',
      'mis pendencias',
      'tareas asignadas a mí',
      'mi workload',
      'lo que es mío',
      'tareas personales',
      'mi backlog',
    ],
    ca: [
      'les meves tasques',
      'tasques meves',
      'què he de fer',
      'les meves pendències',
      'tasques assignades a mi',
      'el meu workload',
      'el que és meu',
      'tasques personals',
      'el meu backlog',
    ],
  },
  'tarefa.p0': {
    pt: [
      'tarefas P0',
      'tarefas críticas',
      'prioridade zero',
      'urgentes',
      'tarefas prioritárias',
      'o que tá pegando fogo',
      'tarefas mais importantes',
      'P0',
    ],
    es: [
      'tareas P0',
      'tareas críticas',
      'prioridad cero',
      'urgentes',
      'tareas prioritarias',
      'lo que está ardiendo',
      'tareas más importantes',
      'P0',
    ],
    ca: [
      'tasques P0',
      'tasques crítiques',
      'prioritat zero',
      'urgents',
      'tasques prioritàries',
      'el que està cremant',
      'tasques més importants',
      'P0',
    ],
  },
  'tarefa.p1': {
    pt: [
      'tarefas P1',
      'prioridade 1',
      'tarefas importantes',
      'segunda prioridade',
      'tarefas que não podem esperar',
    ],
    es: [
      'tareas P1',
      'prioridad 1',
      'tareas importantes',
      'segunda prioridad',
      'tareas que no pueden esperar',
    ],
    ca: [
      'tasques P1',
      'prioritat 1',
      'tasques importants',
      'segona prioritat',
      'tasques que no poden esperar',
    ],
  },
  'tarefa.atrasadas': {
    pt: [
      'tarefas atrasadas',
      'tarefas vencidas',
      'tarefas em atraso',
      'tarefas com prazo vencido',
      'tarefas que passaram do prazo',
      'atrasadas',
    ],
    es: [
      'tareas atrasadas',
      'tareas vencidas',
      'tareas en atraso',
      'tareas con plazo vencido',
      'tareas que pasaron del plazo',
      'atrasadas',
    ],
    ca: [
      'tasques endarrerides',
      'tasques vençudes',
      'tasques en endarreriment',
      'tasques amb termini vençut',
      'tasques que han passat el termini',
      'endarrerides',
    ],
  },
  'tarefa.por_projeto': {
    pt: [
      'tarefas do projeto',
      'tarefas do cliente',
      'tarefas vinculadas',
      'tarefas por projeto',
      'filtrar por projeto',
    ],
    es: [
      'tareas del proyecto',
      'tareas del cliente',
      'tareas vinculadas',
      'tareas por proyecto',
      'filtrar por proyecto',
    ],
    ca: [
      'tasques del projecte',
      'tasques del client',
      'tasques vinculades',
      'tasques per projecte',
      'filtrar per projecte',
    ],
  },
  'tarefa.por_responsavel': {
    pt: [
      'tarefas do abner',
      'tarefas do nonoke',
      'tarefas do elias',
      'tarefas por responsável',
      'filtrar por pessoa',
      'tarefas de quem',
    ],
    es: [
      'tareas de abner',
      'tareas de nonoke',
      'tareas de elias',
      'tareas por responsable',
      'filtrar por persona',
      'tareas de quién',
    ],
    ca: [
      'tasques d\'abner',
      'tasques de nonoke',
      'tasques d\'elias',
      'tasques per responsable',
      'filtrar per persona',
      'tasques de qui',
    ],
  },
  'tarefa.concluidas': {
    pt: [
      'tarefas concluídas',
      'tarefas feitas',
      'tarefas finalizadas',
      'tarefas completadas',
      'histórico de tarefas',
      'tarefas terminadas',
    ],
    es: [
      'tareas concluidas',
      'tareas hechas',
      'tareas finalizadas',
      'tareas completadas',
      'histórico de tareas',
      'tareas terminadas',
    ],
    ca: [
      'tasques concloses',
      'tasques fetes',
      'tasques finalitzades',
      'tasques completades',
      'històric de tasques',
      'tasques terminades',
    ],
  },
  'financeiro.extrato': {
    pt: [
      'extrato financeiro',
      'ver extrato',
      'histórico de transações',
      'movimentações',
      'extrato completo',
      'todas as transações',
      'relatório financeiro',
    ],
    es: [
      'extracto financiero',
      'ver extracto',
      'histórico de transacciones',
      'movimientos',
      'extracto completo',
      'todas las transacciones',
      'reporte financiero',
    ],
    ca: [
      'extracte financer',
      'veure extracte',
      'històric de transaccions',
      'moviments',
      'extracte complet',
      'totes les transaccions',
      'informe financer',
    ],
  },
  'financeiro.gastos_do_mes': {
    pt: [
      'gastos do mês',
      'quanto gastamos',
      'total de gastos',
      'gastos mensais',
      'despesas mensais',
    ],
    es: [
      'gastos del mes',
      'gastos del mes',
      'cuánto gastamos',
      'total de gastos',
      'gastos mensuales',
      'gastos mensuales',
    ],
    ca: [
      'gastos del mes',
      'quant gastem',
      'total de despeses',
      'gastos mensuals',
      'despeses mensuals',
    ],
  },
  'financeiro.receitas_do_mes': {
    pt: [
      'receitas do mês',
      'entradas do mês',
      'quanto recebemos',
      'total de receitas',
      'receitas mensais',
      'pagamentos do mês',
    ],
    es: [
      'ingresos del mes',
      'entradas del mes',
      'cuánto recibimos',
      'total de ingresos',
      'ingresos mensuales',
      'pagos del mes',
    ],
    ca: [
      'ingressos del mes',
      'entrades del mes',
      'quant rebem',
      'total d\'ingressos',
      'ingressos mensuals',
      'pagaments del mes',
    ],
  },
  'financeiro.balanco': {
    pt: [
      'balanço do mês',
      'receitas vs despesas',
      'como foi o mês',
      'resultado do mês',
      'lucro do mês',
      'fechamento mensal',
      'resumo financeiro do mês',
    ],
    es: [
      'balance del mes',
      'ingresos vs gastos',
      'cómo fue el mes',
      'resultado del mes',
      'ganancia del mes',
      'cierre mensual',
      'resumen financiero del mes',
    ],
    ca: [
      'balanç del mes',
      'ingressos vs despeses',
      'com va el mes',
      'resultat del mes',
      'benefici del mes',
      'tancament mensual',
      'resum financer del mes',
    ],
  },
  'financeiro.projecao': {
    pt: [
      'mostrar projeção',
      'ver projeção de caixa',
      'projeção salva',
      'consultar forecast',
      'exibir projeção financeira',
      'qual a projeção atual',
    ],
    es: [
      'mostrar proyección',
      'ver proyección de caja',
      'proyección guardada',
      'consultar forecast',
      'exhibir proyección financiera',
      'cuál es la proyección actual',
    ],
    ca: [
      'mostrar projecció',
      'veure projecció de caixa',
      'projecció desada',
      'consultar forecast',
      'exhibir projecció financera',
      'quina és la projecció actual',
    ],
  },
  'financeiro.historico_caixa': {
    pt: [
      'histórico do caixa',
      'histórico de caixa',
      'movimentações do caixa',
      'caixa ao longo do tempo',
      'evolução do caixa',
    ],
    es: [
      'histórico de caja',
      'histórico de caja',
      'movimientos de caja',
      'caja a lo largo del tiempo',
      'evolución de caja',
    ],
    ca: [
      'històric de caixa',
      'històric de caixa',
      'moviments de caixa',
      'caixa al llarg del temps',
      'evolució de caixa',
    ],
  },
  'financeiro.reconciliar': {
    pt: [
      'reconciliar caixa',
      'conciliar caixa',
      'conferir caixa',
      'fechar caixa',
      'conferência do caixa',
      'reconciliação',
    ],
    es: [
      'reconciliar caja',
      'conciliar caja',
      'conferir caja',
      'cerrar caja',
      'conferencia de caja',
      'reconciliación',
    ],
    ca: [
      'reconciliar caixa',
      'conciliar caixa',
      'confirmar caixa',
      'tancar caixa',
      'conferència de caixa',
      'reconciliació',
    ],
  },
  'financeiro.ajustar_caixa': {
    pt: [
      'ajustar caixa',
      'corrigir caixa',
      'ajuste de caixa',
      'diferença no caixa',
      'correção de caixa',
    ],
    es: [
      'ajustar caja',
      'corregir caja',
      'ajuste de caja',
      'diferencia en caja',
      'corrección de caja',
    ],
    ca: [
      'ajustar caixa',
      'corregir caixa',
      'ajust de caixa',
      'diferència a caixa',
      'correcció de caixa',
    ],
  },
  'financeiro.pagar_despesa': {
    pt: [
      'pagar despesa',
      'quitar despesa',
      'marcar como paga',
      'pagar conta',
      'liquidar despesa',
      'efetuar pagamento',
    ],
    es: [
      'pagar gasto',
      'liquidar gasto',
      'marcar como pagado',
      'pagar cuenta',
      'liquidar gasto',
      'efectuar pago',
    ],
    ca: [
      'pagar despesa',
      'pagar despesa',
      'marcar com a pagada',
      'pagar compte',
      'liquidar despesa',
      'efectuar pagament',
    ],
  },
  'financeiro.split': {
    pt: [
      'receber split',
      'split financeiro',
      'dividir despesa',
      'split',
      'dividir pagamento',
      'compartilhar despesa',
    ],
    es: [
      'recibir split',
      'split financiero',
      'dividir gasto',
      'split',
      'dividir pago',
      'compartir gasto',
    ],
    ca: [
      'rebre split',
      'split financer',
      'dividir despesa',
      'split',
      'dividir pagament',
      'compartir despesa',
    ],
  },
  'financeiro.excluir_despesa': {
    pt: [
      'excluir despesa',
      'deletar despesa',
      'remover despesa',
      'apagar despesa',
      'tirar despesa',
    ],
    es: [
      'excluir gasto',
      'eliminar gasto',
      'remover gasto',
      'borrar gasto',
      'sacar gasto',
    ],
    ca: [
      'excloure despesa',
      'eliminar despesa',
      'suprimir despesa',
      'esborrar despesa',
      'tirar despesa',
    ],
  },
  'financeiro.excluir_pagamento': {
    pt: [
      'excluir pagamento',
      'deletar pagamento',
      'remover pagamento',
      'apagar pagamento',
      'tirar receita',
    ],
    es: [
      'excluir pago',
      'eliminar pago',
      'remover pago',
      'borrar pago',
      'quitar ingreso',
    ],
    ca: [
      'excloure pagament',
      'eliminar pagament',
      'treure pagament',
      'esborrar pagament',
      'tirar ingrés',
    ],
  },
  'financeiro.atualizar_despesa': {
    pt: [
      'atualizar despesa',
      'editar despesa',
      'modificar despesa',
      'mudar despesa',
      'corrigir despesa',
    ],
    es: [
      'actualizar gasto',
      'editar gasto',
      'modificar gasto',
      'cambiar gasto',
      'corregir gasto',
    ],
    ca: [
      'actualitzar despesa',
      'editar despesa',
      'modificar despesa',
      'canviar despesa',
      'corregir despesa',
    ],
  },
  'financeiro.atualizar_pagamento': {
    pt: [
      'atualizar pagamento',
      'editar pagamento',
      'modificar pagamento',
      'mudar receita',
      'corrigir pagamento',
    ],
    es: [
      'actualizar pago',
      'editar pago',
      'modificar pago',
      'cambiar ingreso',
      'corregir pago',
    ],
    ca: [
      'actualitzar pagament',
      'editar pagament',
      'modificar pagament',
      'canviar ingrés',
      'corregir pagament',
    ],
  },
  'whatsapp.mensagens_recentes': {
    pt: [
      'mensagens recentes',
      'últimas mensagens',
      'o que tá rolando no zap',
      'novidades do whatsapp',
      'mensagens novas',
      'últimas do grupo',
    ],
    es: [
      'mensajes recientes',
      'últimos mensajes',
      'qué está pasando en el zap',
      'novedades de whatsapp',
      'mensajes nuevos',
      'últimos del grupo',
    ],
    ca: [
      'missatges recents',
      'últims missatges',
      'què està passant al zap',
      'novetats de whatsapp',
      'missatges nous',
      'últims del grup',
    ],
  },
  'whatsapp.scan': {
    pt: [
      'scan do whatsapp',
      'escanear whatsapp',
      'verificar grupos',
      'scanear mensagens',
      'fazer scan',
      'checar whatsapp',
    ],
    es: [
      'scan de whatsapp',
      'escanear whatsapp',
      'verificar grupos',
      'escanear mensajes',
      'hacer scan',
      'chequear whatsapp',
    ],
    ca: [
      'scan de whatsapp',
      'escanejar whatsapp',
      'verificar grups',
      'escanejar missatges',
      'fer scan',
      'comprovar whatsapp',
    ],
  },
  'whatsapp.classificar': {
    pt: [
      'classificar mensagens',
      'classificar whatsapp',
      'processar mensagens',
      'organizar zap',
      'classificar buffer',
      'categorizar mensagens',
    ],
    es: [
      'clasificar mensajes',
      'clasificar whatsapp',
      'procesar mensajes',
      'organizar zap',
      'clasificar buffer',
      'categorizar mensajes',
    ],
    ca: [
      'classificar missatges',
      'classificar whatsapp',
      'processar missatges',
      'organitzar zap',
      'classificar buffer',
      'categoritzar missatges',
    ],
  },
  'whatsapp.relatorio': {
    pt: [
      'relatório do grupo',
      'relatório do whatsapp',
      'resumo do zap',
      'report do grupo',
      'status do whatsapp',
    ],
    es: [
      'reporte del grupo',
      'reporte de whatsapp',
      'resumen del zap',
      'report del grupo',
      'status de whatsapp',
    ],
    ca: [
      'informe del grup',
      'informe de whatsapp',
      'resum del zap',
      'report del grup',
      'status de whatsapp',
    ],
  },
  'whatsapp.limpar_buffer': {
    pt: [
      'limpar buffer',
      'limpar fila',
      'esvaziar buffer',
      'resetar buffer',
      'limpar mensagens pendentes',
    ],
    es: [
      'limpiar buffer',
      'limpiar cola',
      'vaciar buffer',
      'resetear buffer',
      'limpiar mensajes pendientes',
    ],
    ca: [
      'netejar buffer',
      'netejar cua',
      'buidar buffer',
      'reiniciar buffer',
      'netejar missatges pendents',
    ],
  },
  'whatsapp.checkpoint': {
    pt: [
      'checkpoint',
      'salvar estado',
      'checkpoint do whatsapp',
      'marcar ponto',
      'salvar progresso',
    ],
    es: [
      'checkpoint',
      'guardar estado',
      'checkpoint de whatsapp',
      'marcar punto',
      'guardar progreso',
    ],
    ca: [
      'checkpoint',
      'guardar estat',
      'checkpoint de whatsapp',
      'marcar punt',
      'guardar progrés',
    ],
  },
  'whatsapp.configurar': {
    pt: [
      'configurar whatsapp',
      'config do zap',
      'ajustar whatsapp',
      'whatsapp settings',
      'configurar grupo',
    ],
    es: [
      'configurar whatsapp',
      'config del zap',
      'ajustar whatsapp',
      'whatsapp settings',
      'configurar grupo',
    ],
    ca: [
      'configurar whatsapp',
      'config del zap',
      'ajustar whatsapp',
      'whatsapp settings',
      'configurar grup',
    ],
  },
  'sistema.notificacoes_lidas': {
    pt: [
      'marcar notificações como lidas',
      'limpar notificações',
      'todas lidas',
      'dismiss all',
      'limpar todas notificações',
    ],
    es: [
      'marcar notificaciones como leídas',
      'limpiar notificaciones',
      'todas leídas',
      'dismiss all',
      'limpiar todas notificaciones',
    ],
    ca: [
      'marcar notificacions com a llegides',
      'netejar notificacions',
      'totes llegides',
      'dismiss all',
      'netejar totes notificacions',
    ],
  },
  'sistema.configuracoes': {
    pt: [
      'configurações',
      'settings',
      'preferências',
      'ajustes',
      'config do sistema',
      'minhas configurações',
    ],
    es: [
      'configuraciones',
      'settings',
      'preferencias',
      'ajustes',
      'config del sistema',
      'mis configuraciones',
    ],
    ca: [
      'configuracions',
      'settings',
      'preferències',
      'ajustos',
      'config del sistema',
      'les meves configuracions',
    ],
  },
  'sistema.trocar_usuario': {
    pt: [
      'trocar de usuário',
      'mudar usuário',
      'login como outro',
      'entrar como',
      'switch user',
      'trocar conta',
    ],
    es: [
      'cambiar de usuario',
      'cambiar usuario',
      'login como otro',
      'entrar como',
      'switch user',
      'cambiar cuenta',
    ],
    ca: [
      'canviar d\'usuari',
      'canviar usuari',
      'login com un altre',
      'entrar com',
      'switch user',
      'canviar compte',
    ],
  },
  'sistema.alterar_senha': {
    pt: [
      'alterar senha',
      'mudar senha',
      'trocar senha',
      'nova senha',
      'resetar senha',
      'password',
    ],
    es: [
      'cambiar contraseña',
      'modificar contraseña',
      'cambiar clave',
      'nueva contraseña',
      'resetear contraseña',
      'password',
    ],
    ca: [
      'canviar contrasenya',
      'modificar contrasenya',
      'canviar clau',
      'nova contrasenya',
      'reiniciar contrasenya',
      'password',
    ],
  },
  'sistema.usuarios': {
    pt: [
      'listar usuários',
      'usuários do sistema',
      'quem tem acesso',
      'membros',
      'equipe',
      'founders',
    ],
    es: [
      'listar usuarios',
      'usuarios del sistema',
      'quién tiene acceso',
      'miembros',
      'equipo',
      'founders',
    ],
    ca: [
      'llistar usuaris',
      'usuaris del sistema',
      'qui té accés',
      'membres',
      'equip',
      'founders',
    ],
  },
  'sistema.changelog': {
    pt: [
      'changelog',
      'atualizações',
      'novidades',
      'histórico de mudanças',
      'release notes',
      'o que mudou',
    ],
    es: [
      'changelog',
      'actualizaciones',
      'novedades',
      'histórico de cambios',
      'release notes',
      'qué cambió',
    ],
    ca: [
      'changelog',
      'actualitzacions',
      'novetats',
      'històric de canvis',
      'release notes',
      'què ha canviat',
    ],
  },
  'sistema.relatorios_bug': {
    pt: [
      'relatórios de bug',
      'bug reports',
      'problemas reportados',
      'bugs',
      'relatório de erro',
      'relatório de incidente',
    ],
    es: [
      'reportes de bug',
      'bug reports',
      'problemas reportados',
      'bugs',
      'reporte de error',
      'informe de incidente',
    ],
    ca: [
      'informes de bug',
      'bug reports',
      'problemes reportats',
      'bugs',
      'informe d\'error',
      'llista de problemes',
    ],
  },
  'sistema.auto_fix': {
    pt: [
      'auto fix',
      'consertar automático',
      'reparar',
      'corrigir problemas',
      'autocorreção',
      'diagnosticar',
    ],
    es: [
      'auto fix',
      'arreglar automático',
      'reparar',
      'corregir problemas',
      'autocorrección',
      'diagnosticar',
    ],
    ca: [
      'auto fix',
      'arreglar automàtic',
      'reparar',
      'corregir problemes',
      'autocorrecció',
      'diagnosticar',
    ],
  },
  'sistema.controlar_servico': {
    pt: [
      'controlar serviço',
      'iniciar serviço',
      'parar serviço',
      'status do serviço',
      'gerenciar serviço',
      'restart serviço',
    ],
    es: [
      'controlar servicio',
      'iniciar servicio',
      'parar servicio',
      'status del servicio',
      'gestionar servicio',
      'restart servicio',
    ],
    ca: [
      'controlar servei',
      'iniciar servei',
      'aturar servei',
      'status del servei',
      'gestionar servei',
      'restart servei',
    ],
  },
  'workspace.listar_clientes': {
    pt: [
      'listar clientes do workspace',
      'ver lista de clientes workspace',
      'workspaces disponíveis',
      'pastas de clientes',
      'diretórios',
    ],
    es: [
      'listar clientes del workspace',
      'ver lista de clientes workspace',
      'workspaces disponibles',
      'carpetas de clientes',
      'directorios',
    ],
    ca: [
      'llistar clients del workspace',
      'veure llista de clients workspace',
      'workspaces disponibles',
      'carpetes de clients',
      'directoris',
    ],
  },
  'workspace.abrir': {
    pt: [
      'abrir workspace',
      'abrir pasta do cliente',
      'navegar workspace',
      'ir para workspace',
      'workspace do cliente',
    ],
    es: [
      'abrir workspace',
      'abrir carpeta del cliente',
      'navegar workspace',
      'ir a workspace',
      'workspace del cliente',
    ],
    ca: [
      'obrir workspace',
      'obrir carpeta del client',
      'navegar workspace',
      'anar a workspace',
      'workspace del client',
    ],
  },
  'workspace.criar_cliente': {
    pt: [
      'criar cliente workspace',
      'novo workspace',
      'adicionar cliente workspace',
      'criar pasta cliente',
      'novo cliente no workspace',
    ],
    es: [
      'crear cliente workspace',
      'nuevo workspace',
      'añadir cliente workspace',
      'crear carpeta cliente',
      'nuevo cliente en workspace',
    ],
    ca: [
      'crear client workspace',
      'nou workspace',
      'afegir client workspace',
      'crear carpeta client',
      'nou client al workspace',
    ],
  },
  'workspace.criar_pasta': {
    pt: [
      'criar pasta',
      'nova pasta',
      'adicionar pasta',
      'mkdir',
      'nova diretório',
    ],
    es: [
      'crear carpeta',
      'nueva carpeta',
      'añadir carpeta',
      'mkdir',
      'nuevo directorio',
    ],
    ca: [
      'crear carpeta',
      'nova carpeta',
      'afegir carpeta',
      'mkdir',
      'nou directori',
    ],
  },
  'workspace.upload': {
    pt: [
      'fazer upload',
      'enviar arquivo',
      'upload de arquivo',
      'subir arquivo',
      'adicionar arquivo',
    ],
    es: [
      'hacer upload',
      'enviar archivo',
      'upload de archivo',
      'subir archivo',
      'añadir archivo',
    ],
    ca: [
      'fer upload',
      'enviar fitxer',
      'upload de fitxer',
      'pujar fitxer',
      'afegir fitxer',
    ],
  },
  'workspace.servidores': {
    pt: [
      'status dos servidores',
      'servidores de demo',
      'servidores de desenvolvimento',
      'status dos demos',
      'servidores ativos',
    ],
    es: [
      'status de los servidores',
      'servidores de demo',
      'servidores de desarrollo',
      'status de los demos',
      'servidores activos',
    ],
    ca: [
      'status dels servidors',
      'servidors de demo',
      'servidors de desenvolupament',
      'status dels demos',
      'servidors actius',
    ],
  },
  'workspace.iniciar_demo': {
    pt: [
      'iniciar demo',
      'rodar servidor',
      'start server',
      'iniciar servidor',
      'subir demo',
      'deploy local',
    ],
    es: [
      'iniciar demo',
      'correr servidor',
      'start server',
      'iniciar servidor',
      'subir demo',
      'deploy local',
    ],
    ca: [
      'iniciar demo',
      'executar servidor',
      'start server',
      'iniciar servidor',
      'pujar demo',
      'deploy local',
    ],
  },
  'workspace.parar_demo': {
    pt: [
      'parar demo',
      'parar servidor',
      'stop server',
      'matar servidor',
      'derrubar demo',
      'desligar servidor',
    ],
    es: [
      'parar demo',
      'parar servidor',
      'stop server',
      'matar servidor',
      'bajar demo',
      'apagar servidor',
    ],
    ca: [
      'aturar demo',
      'aturar servidor',
      'stop server',
      'matar servidor',
      'baixar demo',
      'apagar servidor',
    ],
  },
  'workspace.logs': {
    pt: [
      'ver logs',
      'logs do servidor',
      'terminal',
      'console logs',
      'histórico do servidor',
      'output do servidor',
    ],
    es: [
      'ver logs',
      'logs del servidor',
      'terminal',
      'console logs',
      'histórico del servidor',
      'output del servidor',
    ],
    ca: [
      'veure logs',
      'logs del servidor',
      'terminal',
      'console logs',
      'històric del servidor',
      'output del servidor',
    ],
  },
  'instagram.importar': {
    pt: [
      'importar instagram',
      'importar mensagens instagram',
      'sincronizar instagram',
      'buscar instagram',
      'trazer instagram',
    ],
    es: [
      'importar instagram',
      'importar mensajes instagram',
      'sincronizar instagram',
      'buscar instagram',
      'traer instagram',
    ],
    ca: [
      'importar instagram',
      'importar missatges instagram',
      'sincronitzar instagram',
      'buscar instagram',
      'portar instagram',
    ],
  },
  'instagram.mensagens': {
    pt: [
      'mensagens do instagram',
      'instagram dms',
      'direct instagram',
      'mensagens privadas instagram',
      'inbox instagram',
    ],
    es: [
      'mensajes de instagram',
      'instagram dms',
      'direct instagram',
      'mensajes privados instagram',
      'inbox instagram',
    ],
    ca: [
      'missatges d\'instagram',
      'instagram dms',
      'direct instagram',
      'missatges privats instagram',
      'inbox instagram',
    ],
  },
  'instagram.configurar': {
    pt: [
      'configurar instagram',
      'instagram settings',
      'conectar instagram',
      'instagram auth',
      'login instagram',
    ],
    es: [
      'configurar instagram',
      'instagram settings',
      'conectar instagram',
      'instagram auth',
      'login instagram',
    ],
    ca: [
      'configurar instagram',
      'instagram settings',
      'connectar instagram',
      'instagram auth',
      'login instagram',
    ],
  },
  'github.repos': {
    pt: [
      'listar repos',
      'repositórios github',
      'meus repos',
      'projetos no github',
      'github repos',
    ],
    es: [
      'listar repos',
      'repositorios github',
      'mis repos',
      'proyectos en github',
      'github repos',
    ],
    ca: [
      'llistar repos',
      'repositoris github',
      'els meus repos',
      'projectes a github',
      'github repos',
    ],
  },
  'github.git_push': {
    pt: [
      'fazer push',
      'git push',
      'subir código',
      'push para github',
      'commit e push',
      'deploy github',
    ],
    es: [
      'hacer push',
      'git push',
      'subir código',
      'push a github',
      'commit y push',
      'deploy github',
    ],
    ca: [
      'fer push',
      'git push',
      'pujar codi',
      'push a github',
      'commit i push',
      'deploy github',
    ],
  },
  'github.status': {
    pt: [
      'status do github',
      'como tá o github',
      'github status',
      'repos atualizados',
      'sincronização github',
    ],
    es: [
      'status de github',
      'cómo está el github',
      'github status',
      'repos actualizados',
      'sincronización github',
    ],
    ca: [
      'status de github',
      'com està github',
      'github status',
      'repos actualitzats',
      'sincronització github',
    ],
  },
  'vercel.projetos': {
    pt: [
      'projetos na vercel',
      'listar vercel',
      'deploys vercel',
      'vercel projects',
      'sites na vercel',
    ],
    es: [
      'proyectos en vercel',
      'listar vercel',
      'deploys vercel',
      'vercel projects',
      'sites en vercel',
    ],
    ca: [
      'projectes a vercel',
      'llistar vercel',
      'deploys vercel',
      'vercel projects',
      'sites a vercel',
    ],
  },
  'vercel.status': {
    pt: [
      'status da vercel',
      'como tá a vercel',
      'deploy status',
      'build vercel',
      'vercel health',
    ],
    es: [
      'status de vercel',
      'cómo está vercel',
      'deploy status',
      'build vercel',
      'vercel health',
    ],
    ca: [
      'status de vercel',
      'com està vercel',
      'deploy status',
      'build vercel',
      'vercel health',
    ],
  },
  'seguranca.configuracoes': {
    pt: [
      'configurações de segurança',
      'security settings',
      'proteção',
      'segurança do sistema',
      'config de segurança',
    ],
    es: [
      'configuraciones de seguridad',
      'security settings',
      'protección',
      'seguridad del sistema',
      'config de seguridad',
    ],
    ca: [
      'configuracions de seguretat',
      'security settings',
      'protecció',
      'seguretat del sistema',
      'config de seguretat',
    ],
  },
  'seguranca.logs': {
    pt: [
      'logs de segurança',
      'security logs',
      'histórico de segurança',
      'auditoria',
      'log de acesso',
    ],
    es: [
      'logs de seguridad',
      'security logs',
      'histórico de seguridad',
      'auditoría',
      'log de acceso',
    ],
    ca: [
      'logs de seguretat',
      'security logs',
      'històric de seguretat',
      'auditoria',
      'log d\'accés',
    ],
  },
  'seguranca.testar_whatsapp': {
    pt: [
      'testar whatsapp',
      'teste de alerta',
      'whatsapp teste',
      'teste de integração whatsapp',
      'testar notificação',
    ],
    es: [
      'testear whatsapp',
      'test de alerta',
      'whatsapp test',
      'test de integración whatsapp',
      'testear notificación',
    ],
    ca: [
      'testar whatsapp',
      'test d\'alerta',
      'whatsapp test',
      'test d\'integració whatsapp',
      'testar notificació',
    ],
  },
  'seguranca.alerta': {
    pt: [
      'criar alerta',
      'novo alerta',
      'alerta de segurança',
      'notificação de risco',
      'aviso',
      'disparar alerta',
    ],
    es: [
      'crear alerta',
      'nueva alerta',
      'alerta de seguridad',
      'notificación de riesgo',
      'aviso',
      'disparar alerta',
    ],
    ca: [
      'crear alerta',
      'nova alerta',
      'alerta de seguretat',
      'notificació de risc',
      'avís',
      'disparar alerta',
    ],
  },
  'operacao.alerta': {
    pt: [
      'criar alerta operação',
      'alerta de operação',
      'novo alerta ops',
      'alerta crítico',
      'disparar alerta operação',
    ],
    es: [
      'crear alerta operación',
      'alerta de operación',
      'nueva alerta ops',
      'alerta crítica',
      'disparar alerta operación',
    ],
    ca: [
      'crear alerta operació',
      'alerta d\'operació',
      'nova alerta ops',
      'alerta crítica',
      'disparar alerta operació',
    ],
  },
  'operacao.excluir_alerta': {
    pt: [
      'excluir alerta',
      'remover alerta',
      'deletar alerta',
      'tirar alerta',
      'limpar alerta',
    ],
    es: [
      'excluir alerta',
      'remover alerta',
      'eliminar alerta',
      'quitar alerta',
      'limpiar alerta',
    ],
    ca: [
      'excloure alerta',
      'treure alerta',
      'eliminar alerta',
      'tirar alerta',
      'netejar alerta',
    ],
  },
  'operacao.mudanca': {
    pt: [
      'registrar mudança',
      'nova mudança',
      'change log',
      'mudança no sistema',
      'atualização operação',
      'registrar alteração',
    ],
    es: [
      'registrar cambio',
      'nuevo cambio',
      'change log',
      'cambio en el sistema',
      'actualización operación',
      'registrar alteración',
    ],
    ca: [
      'registrar canvi',
      'nou canvi',
      'change log',
      'canvi al sistema',
      'actualització operació',
      'registrar alteració',
    ],
  },
  'operacao.status': {
    pt: [
      'status das operações',
      'estado das operações',
      'como tá o ops',
      'painel de operações',
      'status ops',
      'ops center',
    ],
    es: [
      'status de las operaciones',
      'estado de las operaciones',
      'cómo está el ops',
      'panel de operaciones',
      'status ops',
      'ops center',
    ],
    ca: [
      'status de les operacions',
      'estat de les operacions',
      'com està l\'ops',
      'panell d\'operacions',
      'status ops',
      'ops center',
    ],
  },

  'email.marcar_importante': {
    pt: [
      'marcar como importante',
      'priorizar email',
      'email prioritário',
      'flagar email',
      'salvar como importante',
      'marcar prioridade',
      'sinalizar importância',
      'esse email é importante',
    ],
    es: [
      'marcar como importante',
      'priorizar email',
      'email prioritario',
      'flaggear email',
      'guardar como importante',
      'marcar prioridad',
      'señalizar importancia',
      'ese email es importante',
    ],
    ca: [
      'marcar com a important',
      'prioritzar email',
      'email prioritari',
      'marcar email',
      'guardar com a important',
      'marcar prioritat',
      'senalitzar importància',
      'aquest email és important',
    ],
  },
  'tarefa.atualizar': {
    pt: [
      'atualizar tarefa',
      'editar tarefa',
      'mudar tarefa',
      'modificar tarefa',
      'atualizar descrição da tarefa',
      'mudar status da tarefa',
      'atualizar prazo',
      'trocar responsável da tarefa',
    ],
    es: [
      'actualizar tarea',
      'editar tarea',
      'cambiar tarea',
      'modificar tarea',
      'actualizar descripción de tarea',
      'cambiar estado de tarea',
      'actualizar plazo',
      'cambiar responsable de tarea',
    ],
    ca: [
      'actualitzar tasca',
      'editar tasca',
      'canviar tasca',
      'modificar tasca',
      'actualitzar descripció de tasca',
      'canviar estat de tasca',
      'actualitzar termini',
      'canviar responsable de tasca',
    ],
  },
  'tarefa.deletar': {
    pt: [
      'deletar tarefa',
      'excluir tarefa',
      'remover tarefa',
      'apagar tarefa',
      'tirar tarefa',
      'cancelar tarefa',
      'deletar atividade',
    ],
    es: [
      'eliminar tarea',
      'borrar tarea',
      'remover tarea',
      'quitar tarea',
      'cancelar tarea',
      'eliminar actividad',
    ],
    ca: [
      'eliminar tasca',
      'esborrar tasca',
      'treure tasca',
      'tirar tasca',
      'cancel·lar tasca',
      'eliminar activitat',
    ],
  },
  'tarefa.adicionar_comentario': {
    pt: [
      'comentar tarefa',
      'adicionar comentário',
      'deixar comentário na tarefa',
      'nota na tarefa',
      'observação na tarefa',
      'comentar atividade',
    ],
    es: [
      'comentar tarea',
      'añadir comentario',
      'dejar comentario en tarea',
      'nota en tarea',
      'observación en tarea',
      'comentar actividad',
    ],
    ca: [
      'comentar tasca',
      'afegir comentari',
      'deixar comentari a la tasca',
      'nota a la tasca',
      'observació a la tasca',
      'comentar activitat',
    ],
  },
  'projeto.atualizar': {
    pt: [
      'atualizar projeto',
      'editar projeto',
      'mudar projeto',
      'modificar projeto',
      'atualizar status do projeto',
      'mudar prazo do projeto',
      'atualizar dados do projeto',
    ],
    es: [
      'actualizar proyecto',
      'editar proyecto',
      'cambiar proyecto',
      'modificar proyecto',
      'actualizar estado del proyecto',
      'cambiar plazo del proyecto',
      'actualizar datos del proyecto',
    ],
    ca: [
      'actualitzar projecte',
      'editar projecte',
      'canviar projecte',
      'modificar projecte',
      'actualitzar estat del projecte',
      'canviar termini del projecte',
      'actualitzar dades del projecte',
    ],
  },
  'projeto.deletar': {
    pt: [
      'deletar projeto',
      'excluir projeto',
      'remover projeto',
      'apagar projeto',
      'tirar projeto',
      'cancelar projeto',
      'encerrar projeto',
    ],
    es: [
      'eliminar proyecto',
      'borrar proyecto',
      'remover proyecto',
      'quitar proyecto',
      'cancelar proyecto',
      'cerrar proyecto',
    ],
    ca: [
      'eliminar projecte',
      'esborrar projecte',
      'treure projecte',
      'tirar projecte',
      'cancel·lar projecte',
      'tancar projecte',
    ],
  },
  'projeto.adicionar_cliente': {
    pt: [
      'adicionar cliente ao projeto',
      'vincular cliente',
      'associar cliente ao projeto',
      'colocar cliente no projeto',
      'vincular projeto ao cliente',
    ],
    es: [
      'añadir cliente al proyecto',
      'vincular cliente',
      'asociar cliente al proyecto',
      'poner cliente en proyecto',
      'vincular proyecto al cliente',
    ],
    ca: [
      'afegir client al projecte',
      'vincular client',
      'associar client al projecte',
      'posar client al projecte',
      'vincular projecte al client',
    ],
  },
  'projeto.ver_status': {
    pt: [
      'status do projeto',
      'como está o projeto',
      'progresso do projeto',
      'evolução do projeto',
      'andamento do projeto',
      'estado do projeto',
    ],
    es: [
      'estado del proyecto',
      'cómo está el proyecto',
      'progreso del proyecto',
      'evolución del proyecto',
      'andamiento del proyecto',
    ],
    ca: [
      'estat del projecte',
      'com està el projecte',
      'progrés del projecte',
      'evolució del projecte',
      'avenç del projecte',
    ],
  },
  'cliente.criar': {
    pt: [
      'criar cliente',
      'novo cliente',
      'adicionar cliente',
      'novo cadastro cliente',
      'incluir cliente novo',
      'incluir cliente',
      'novo contato',
    ],
    es: [
      'crear cliente',
      'nuevo cliente',
      'añadir cliente',
      'nuevo registro cliente',
      'incluir cliente nuevo',
      'incluir cliente',
      'nuevo contacto',
    ],
    ca: [
      'crear client',
      'nou client',
      'afegir client',
      'nou registre client',
      'incloure client nou',
      'incloure client',
      'nou contacte',
    ],
  },
  'cliente.listar': {
    pt: [
      'listar clientes',
      'mostrar clientes',
      'ver clientes',
      'clientes cadastrados',
      'quais clientes temos',
      'todos os clientes',
      'clientes ativos',
    ],
    es: [
      'listar clientes',
      'mostrar clientes',
      'ver clientes',
      'clientes registrados',
      'qué clientes tenemos',
      'todos los clientes',
      'clientes activos',
    ],
    ca: [
      'llistar clients',
      'mostrar clients',
      'veure clients',
      'clients registrats',
      'quins clients tenim',
      'tots els clients',
      'clients actius',
    ],
  },
  'cliente.buscar': {
    pt: [
      'buscar cliente',
      'encontrar cliente',
      'procurar cliente',
      'pesquisar cliente',
      'onde está o cliente',
      'achar cliente',
    ],
    es: [
      'buscar cliente',
      'encontrar cliente',
      'procurar cliente',
      'buscar contacto',
      'dónde está el cliente',
    ],
    ca: [
      'buscar client',
      'trobar client',
      'cercar client',
      'buscar contacte',
      'on està el client',
    ],
  },
  'cliente.atualizar': {
    pt: [
      'atualizar cliente',
      'editar cliente',
      'mudar dados do cliente',
      'modificar cliente',
      'atualizar contato',
      'alterar cliente',
    ],
    es: [
      'actualizar cliente',
      'editar cliente',
      'cambiar datos del cliente',
      'modificar cliente',
      'actualizar contacto',
      'alterar cliente',
    ],
    ca: [
      'actualitzar client',
      'editar client',
      'canviar dades del client',
      'modificar client',
      'actualitzar contacte',
      'alterar client',
    ],
  },
  'cliente.deletar': {
    pt: [
      'deletar cliente',
      'excluir cliente',
      'remover cliente',
      'apagar cliente',
      'tirar cliente',
      'cancelar cliente',
    ],
    es: [
      'eliminar cliente',
      'borrar cliente',
      'remover cliente',
      'quitar cliente',
      'cancelar cliente',
    ],
    ca: [
      'eliminar client',
      'esborrar client',
      'treure client',
      'tirar client',
      'cancel·lar client',
    ],
  },
  'financeiro.projetar_caixa': {
    pt: [
      'calcular projeção de caixa',
      'gerar forecast',
      'fazer projeção de caixa',
      'simular caixa futuro',
      'prever fluxo de caixa',
      'estimar caixa próximo mês',
    ],
    es: [
      'calcular proyección de caja',
      'generar forecast',
      'hacer proyección de caja',
      'simular caja futuro',
      'prever flujo de caja',
      'estimar caja próximo mes',
    ],
    ca: [
      'calcular projecció de caixa',
      'generar forecast',
      'fer projecció de caixa',
      'simular caixa futur',
      'preveure flux de caixa',
      'estimar caixa proper mes',
    ],
  },
  'financeiro.ver_balanco': {
    pt: [
      'ver balanço',
      'balanço financeiro',
      'resultado financeiro',
      'lucro e prejuízo',
      'demonstração financeira',
      'balanço mensal',
    ],
    es: [
      'ver balance',
      'balance financiero',
      'resultado financiero',
      'pérdidas y ganancias',
      'demostración financiera',
      'balance mensual',
    ],
    ca: [
      'veure balanç',
      'balanç financer',
      'resultat financer',
      'pèrdues i guanys',
      'demostració financera',
      'balanç mensual',
    ],
  },
  'whatsapp.ver_historico': {
    pt: [
      'ver histórico do whatsapp',
      'histórico de conversas',
      'ver conversas',
      'mensagens antigas',
      'histórico do zap',
      'ver chat',
    ],
    es: [
      'ver histórico de whatsapp',
      'histórico de conversaciones',
      'ver conversaciones',
      'mensajes antiguos',
      'histórico del zap',
      'ver chat',
    ],
    ca: [
      'veure històric de whatsapp',
      'històric de converses',
      'veure converses',
      'missatges antics',
      'històric del zap',
      'veure chat',
    ],
  },
  'whatsapp.sincronizar': {
    pt: [
      'sincronizar whatsapp',
      'atualizar whatsapp',
      'puxar mensagens do zap',
      'sincronizar conversas',
      'atualizar chats',
    ],
    es: [
      'sincronizar whatsapp',
      'actualizar whatsapp',
      'traer mensajes del zap',
      'sincronizar conversaciones',
      'actualizar chats',
    ],
    ca: [
      'sincronitzar whatsapp',
      'actualitzar whatsapp',
      'agafar missatges del zap',
      'sincronitzar converses',
      'actualitzar chats',
    ],
  },
  'whatsapp.marcar_nao_lido': {
    pt: [
      'marcar como não lido',
      'não lido no zap',
      'marcar não lido',
      'mensagem não lida',
      'não lido',
    ],
    es: [
      'marcar como no leído',
      'no leído en zap',
      'marcar no leído',
      'mensaje no leída',
      'no leído',
    ],
    ca: [
      'marcar com a no llegit',
      'no llegit al zap',
      'marcar no llegit',
      'missatge no llegida',
      'no llegit',
    ],
  },
  'link.excluir': {
    pt: [
      'excluir link',
      'deletar link',
      'remover link',
      'apagar link',
      'tirar link',
      'remover url',
    ],
    es: [
      'eliminar link',
      'borrar link',
      'remover link',
      'quitar link',
      'eliminar url',
    ],
    ca: [
      'eliminar link',
      'esborrar link',
      'treure link',
      'tirar link',
      'eliminar url',
    ],
  },
  'orcamento.listar': {
    pt: [
      'listar orçamentos',
      'mostrar orçamentos',
      'ver orçamentos',
      'orçamentos cadastrados',
      'quais orçamentos temos',
      'todos os orçamentos',
    ],
    es: [
      'listar presupuestos',
      'mostrar presupuestos',
      'ver presupuestos',
      'presupuestos registrados',
      'qué presupuestos tenemos',
      'todos los presupuestos',
    ],
    ca: [
      'llistar pressupostos',
      'mostrar pressupostos',
      'veure pressupostos',
      'pressupostos registrats',
      'quins pressupostos tenim',
      'tots els pressupostos',
    ],
  },
  'orcamento.atualizar': {
    pt: [
      'atualizar orçamento',
      'editar orçamento',
      'mudar orçamento',
      'modificar orçamento',
      'atualizar proposta',
      'alterar orçamento',
    ],
    es: [
      'actualizar presupuesto',
      'editar presupuesto',
      'cambiar presupuesto',
      'modificar presupuesto',
      'actualizar propuesta',
      'alterar presupuesto',
    ],
    ca: [
      'actualitzar pressupost',
      'editar pressupost',
      'canviar pressupost',
      'modificar pressupost',
      'actualitzar proposta',
      'alterar pressupost',
    ],
  },
  'orcamento.aprovar': {
    pt: [
      'aprovar orçamento',
      'aceitar orçamento',
      'ok para o orçamento',
      'confirmar orçamento',
      'aprovar proposta',
      'tá aprovado',
    ],
    es: [
      'aprobar presupuesto',
      'aceptar presupuesto',
      'ok para el presupuesto',
      'confirmar presupuesto',
      'aprobar propuesta',
      'está aprobado',
    ],
    ca: [
      'aprovar pressupost',
      'acceptar pressupost',
      'ok per al pressupost',
      'confirmar pressupost',
      'aprovar proposta',
      'està aprovat',
    ],
  },
  'orcamento.rejeitar': {
    pt: [
      'rejeitar orçamento',
      'recusar orçamento',
      'não aprovar orçamento',
      'orçamento recusado',
      'rejeitar proposta',
      'não aceitar orçamento',
    ],
    es: [
      'rechazar presupuesto',
      'recusar presupuesto',
      'no aprobar presupuesto',
      'presupuesto recusado',
      'rechazar propuesta',
      'no aceptar presupuesto',
    ],
    ca: [
      'rebutjar pressupost',
      'recusar pressupost',
      'no aprovar pressupost',
      'pressupost recusat',
      'rebutjar proposta',
      'no acceptar pressupost',
    ],
  },
  'lead.criar': {
    pt: [
      'criar lead',
      'novo lead',
      'adicionar lead',
      'novo cadastro lead',
      'incluir lead novo',
      'novo prospecto',
      'adicionar prospecto',
    ],
    es: [
      'crear lead',
      'nuevo lead',
      'añadir lead',
      'nuevo registro lead',
      'incluir lead nuevo',
      'nuevo prospecto',
      'añadir prospecto',
    ],
    ca: [
      'crear lead',
      'nou lead',
      'afegir lead',
      'nou registre lead',
      'incloure lead nou',
      'nou prospecte',
      'afegir prospecte',
    ],
  },
  'lead.listar': {
    pt: [
      'listar leads',
      'mostrar leads',
      'ver leads',
      'leads cadastrados',
      'quais leads temos',
      'todos os leads',
      'prospectos',
    ],
    es: [
      'listar leads',
      'mostrar leads',
      'ver leads',
      'leads registrados',
      'qué leads tenemos',
      'todos los leads',
      'prospectos',
    ],
    ca: [
      'llistar leads',
      'mostrar leads',
      'veure leads',
      'leads registrats',
      'quins leads tenim',
      'tots els leads',
      'prospectes',
    ],
  },
  'lead.atualizar_status': {
    pt: [
      'atualizar status do lead',
      'mudar status do lead',
      'mover lead no funil',
      'atualizar pipeline',
      'mudar estágio do lead',
      'atualizar funil',
    ],
    es: [
      'actualizar estado del lead',
      'cambiar estado del lead',
      'mover lead en el embudo',
      'actualizar pipeline',
      'cambiar etapa del lead',
      'actualizar embudo',
    ],
    ca: [
      'actualitzar estat del lead',
      'canviar estat del lead',
      'moure lead a l\'embut',
      'actualitzar pipeline',
      'canviar etapa del lead',
      'actualitzar embut',
    ],
  },
  'lead.converter': {
    pt: [
      'converter lead',
      'converter em cliente',
      'transformar lead',
      'promover lead',
      'converter prospecto',
      'lead para cliente',
    ],
    es: [
      'convertir lead',
      'convertir en cliente',
      'transformar lead',
      'promover lead',
      'convertir prospecto',
      'lead a cliente',
    ],
    ca: [
      'convertir lead',
      'convertir en client',
      'transformar lead',
      'promoure lead',
      'convertir prospecte',
      'lead a client',
    ],
  },
  'lead.deletar': {
    pt: [
      'deletar lead',
      'excluir lead',
      'remover lead',
      'apagar lead',
      'tirar lead',
      'cancelar lead',
    ],
    es: [
      'eliminar lead',
      'borrar lead',
      'remover lead',
      'quitar lead',
      'cancelar lead',
    ],
    ca: [
      'eliminar lead',
      'esborrar lead',
      'treure lead',
      'tirar lead',
      'cancel·lar lead',
    ],
  },
  'ideia.atualizar': {
    pt: [
      'atualizar ideia',
      'editar ideia',
      'mudar ideia',
      'modificar ideia',
      'atualizar brainstorm',
      'refinar ideia',
    ],
    es: [
      'actualizar idea',
      'editar idea',
      'cambiar idea',
      'modificar idea',
      'actualizar brainstorm',
      'refinar idea',
    ],
    ca: [
      'actualitzar idea',
      'editar idea',
      'canviar idea',
      'modificar idea',
      'actualitzar brainstorm',
      'refinar idea',
    ],
  },
  'ideia.deletar': {
    pt: [
      'deletar ideia',
      'excluir ideia',
      'remover ideia',
      'apagar ideia',
      'tirar ideia',
      'descartar ideia',
    ],
    es: [
      'eliminar idea',
      'borrar idea',
      'remover idea',
      'quitar idea',
      'descartar idea',
    ],
    ca: [
      'eliminar idea',
      'esborrar idea',
      'treure idea',
      'tirar idea',
      'descartar idea',
    ],
  },
  'ideia.converter_tarefa': {
    pt: [
      'converter ideia em tarefa',
      'transformar ideia',
      'ideia para tarefa',
      'promover ideia',
      'criar tarefa da ideia',
      'transformar brainstorm em tarefa',
    ],
    es: [
      'convertir idea en tarea',
      'transformar idea',
      'idea a tarea',
      'promover idea',
      'crear tarea de idea',
      'transformar brainstorm en tarea',
    ],
    ca: [
      'convertir idea en tasca',
      'transformar idea',
      'idea a tasca',
      'promoure idea',
      'crear tasca de idea',
      'transformar brainstorm en tasca',
    ],
  },
  'ideia.adicionar_comentario': {
    pt: [
      'comentar ideia',
      'adicionar comentário na ideia',
      'nota na ideia',
      'observação na ideia',
      'feedback na ideia',
      'anotação no brainstorm',
    ],
    es: [
      'comentar idea',
      'añadir comentario en idea',
      'nota en idea',
      'observación en idea',
      'feedback en idea',
      'anotación en brainstorm',
    ],
    ca: [
      'comentar idea',
      'afegir comentari a la idea',
      'nota a la idea',
      'observació a la idea',
      'feedback a la idea',
      'anotació al brainstorm',
    ],
  },
  'sistema.navegar': {
    pt: [
      'navegar para',
      'ir para',
      'abrir página',
      'mostrar página',
      'vai para',
      'ir até',
      'acessar página',
      'entrar em',
    ],
    es: [
      'navegar a',
      'ir a',
      'abrir página',
      'mostrar página',
      've a',
      'ir hasta',
      'acceder a página',
      'entrar en',
    ],
    ca: [
      'navegar a',
      'anar a',
      'obrir pàgina',
      'mostrar pàgina',
      'ves a',
      'anar fins a',
      'accedir a pàgina',
      'entrar a',
    ],
  },

};

// ═════════════════════════════════════════════════════════════════════════════
// ENTITIES (Named Entity Recognition)
// ═════════════════════════════════════════════════════════════════════════════

const ENTITIES = {
  cliente: {
    pt: ['cliente', 'clientes', 'contato', 'contatos'],
    es: ['cliente', 'clientes', 'contacto', 'contactos'],
    ca: ['client', 'clients', 'contacte', 'contactes'],
  },
  projeto: {
    pt: ['projeto', 'projetos'],
    es: ['proyecto', 'proyectos'],
    ca: ['projecte', 'projectes'],
  },
  tarefa: {
    pt: ['tarefa', 'tarefas', 'atividade', 'atividades'],
    es: ['tarea', 'tareas', 'actividad', 'actividades'],
    ca: ['tasca', 'tasques', 'activitat', 'activitats'],
  },
  orcamento: {
    pt: ['orçamento', 'orçamentos', 'proposta', 'propostas'],
    es: ['presupuesto', 'presupuestos', 'propuesta', 'propuestas'],
    ca: ['pressupost', 'pressupostos', 'proposta', 'propostes'],
  },
  prioridade: {
    pt: ['urgente', 'prioritário', 'alta prioridade', 'baixa prioridade', 'média'],
    es: ['urgente', 'prioritario', 'alta prioridad', 'baja prioridad', 'media'],
    ca: ['urgent', 'prioritari', 'alta prioritat', 'baixa prioritat', 'mitjana'],
  },
};

// ═════════════════════════════════════════════════════════════════════════════
// FUNÇÕES PÚBLICAS
// ═════════════════════════════════════════════════════════════════════════════

let isTrained = false;
let db = null;
try {
  db = require('../db');
} catch (e) {
  // DB module not available (e.g. standalone usage)
}

/**
 * Popula o manager com o corpus de treinamento.
 */
async function loadTrainingExamplesFromPG() {
  if (!db || !global.process.env.DATABASE_URL) return [];
  try {
    const rows = await db.query('SELECT lang, utterance, intent FROM luna_training_examples ORDER BY created_at ASC');
    console.log(`[LunaNLU] 📚 ${rows.length} exemplos adicionais carregados do PostgreSQL.`);
    return rows;
  } catch (e) {
    console.warn('[LunaNLU] Não foi possível carregar exemplos do PG:', e.message);
    return [];
  }
}

async function populateCorpus() {
  console.log('[LunaNLU] Populando corpus de treinamento...');

  // Corpus base (código-fonte)
  for (const [intent, translations] of Object.entries(TRAINING_CORPUS)) {
    for (const [lang, utterances] of Object.entries(translations)) {
      for (const utterance of utterances) {
        manager.addDocument(lang, utterance, intent);
      }
    }
  }

  // Adicionar respostas padrão para cada intent (usado quando não há API)
  const DEFAULT_ANSWERS = {
    'email.responder': {
      pt: 'Vou abrir o assistente de resposta para você preencher.',
      es: 'Voy a abrir el asistente de respuesta para que lo completes.',
      ca: 'Obriré l\'assistent de resposta perquè ho omplis.',
    },
    'email.resumir': {
      pt: 'Vou gerar um resumo da conversa.',
      es: 'Voy a generar un resumen de la conversación.',
      ca: 'Generaré un resum de la conversa.',
    },
    'email.analisar': {
      pt: 'Vou analisar este email.',
      es: 'Voy a analizar este email.',
      ca: 'Analitzaré aquest email.',
    },
    'tarefa.criar': {
      pt: 'Vou abrir o formulário de nova tarefa.',
      es: 'Voy a abrir el formulario de nueva tarea.',
      ca: 'Obriré el formulari de nova tasca.',
    },
    'financeiro.consultar_caixa': {
      pt: 'Consultando saldo do caixa...',
      es: 'Consultando saldo de caja...',
      ca: 'Consultant saldo de caixa...',
    },
    'sistema.ajuda': {
      pt: 'Posso ajudar com emails, tarefas, projetos, clientes, financeiro, WhatsApp, orçamentos, leads, ideias e administração do sistema. O que você precisa?',
      es: 'Puedo ayudar con emails, tareas, proyectos, clientes, finanzas, WhatsApp, presupuestos, leads, ideas y administración del sistema. ¿Qué necesitas?',
      ca: 'Puc ajudar amb emails, tasques, projectes, clients, finances, WhatsApp, pressupostos, leads, idees i administració del sistema. Què necessites?',
    },
    // Respostas de sistema removidas (foco no Dashboard)
    'confirmacao.sim': {
      pt: 'OK, executando! ✅',
      es: '¡OK, ejecutando! ✅',
      ca: 'D\'acord, executant! ✅',
    },
    'confirmacao.nao': {
      pt: 'Entendido, cancelando.',
      es: 'Entendido, cancelando.',
      ca: 'Entesos, cancel·lant.',
    },
    'desfazer': {
      pt: 'Desfazendo a última ação... 🔄',
      es: 'Deshaciendo la última acción... 🔄',
      ca: 'Desfent l\'última acció... 🔄',
    },
    'refazer': {
      pt: 'Refazendo a última ação... 🔄',
      es: 'Rehaciendo la última acción... 🔄',
      ca: 'Refent l\'última acció... 🔄',
    },
  };

  for (const [intent, translations] of Object.entries(DEFAULT_ANSWERS)) {
    for (const [lang, answer] of Object.entries(translations)) {
      manager.addAnswer(lang, intent, answer);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  // REGISTRAR ENTITIES (NER)
  // ══════════════════════════════════════════════════════════════════════════
  for (const [entityName, translations] of Object.entries(ENTITIES)) {
    for (const [lang, values] of Object.entries(translations)) {
      for (const value of values) {
        manager.addNamedEntityText(entityName, value, [lang], [value]);
      }
    }
  }

  // Exemplos adicionais do PostgreSQL (active learning)
  const pgExamples = await loadTrainingExamplesFromPG();
  for (const ex of pgExamples) {
    manager.addDocument(ex.lang, ex.utterance, ex.intent);
  }

  console.log(`[LunaNLU] Corpus populado: ${Object.keys(TRAINING_CORPUS).length} intents em 3 idiomas + ${pgExamples.length} do PG.`);
  console.log(`[LunaNLU] Entities registradas: ${Object.keys(ENTITIES).join(', ')}.`);
}

/**
 * Treina o modelo e salva em disco.
 */
async function train() {
  if (isTrained) return;

  // Tenta carregar modelo existente
  if (fs.existsSync(MODEL_PATH)) {
    try {
      console.log('[LunaNLU] Carregando modelo existente...');
      await manager.load(MODEL_PATH);
      isTrained = true;
      console.log('[LunaNLU] ✅ Modelo carregado de', MODEL_PATH);
      // Warmup: primeira classificação do node-nlp é lenta devido a lazy init interno
      const tWarmup = Date.now();
      await manager.process('pt', 'warmup');
      console.log(`[LunaNLU] 🏃 Warmup completo (${Date.now() - tWarmup}ms) — NLU pronto para uso`);
      return;
    } catch (e) {
      console.warn('[LunaNLU] Falha ao carregar modelo existente, treinando novo...');
    }
  }

  await populateCorpus();
  console.log('[LunaNLU] Treinando modelo (isso pode levar alguns segundos)...');
  await manager.train();

  // Salva modelo
  const dir = path.dirname(MODEL_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  manager.save(MODEL_PATH);

  isTrained = true;
  console.log('[LunaNLU] ✅ Modelo treinado e salvo em', MODEL_PATH);
}

/**
 * Processa uma mensagem do usuário e retorna intent, entities, confidence.
 *
 * @param {string} text - Texto do usuário
 * @param {string} lang - Idioma preferencial ('pt', 'es', 'ca', ou null para auto-detect)
 * @returns {Promise<Object>} - Resultado do processamento
 */
async function process(text, lang = null) {
  if (!isTrained) await train();
  if (!text || !text.trim()) {
    return { intent: 'None', score: 0, entities: [], answer: '', language: null };
  }

  const result = await manager.process(lang, text.trim());

  // Normaliza resultado
  const normalized = {
    intent: result.intent || 'None',
    score: result.score || 0,
    entities: (result.entities || []).map((e) => ({
      type: e.entity,
      value: e.option || e.sourceText || e.utteranceText,
      start: e.start,
      end: e.end,
      accuracy: e.accuracy,
    })),
    answer: result.answer || '',
    language: result.locale || lang || 'auto',
    domain: (result.intent || 'None').split('.')[0] || 'unknown',
    sentiment: result.sentiment || null,
    raw: result,
  };

  // Determina ação baseada no confidence
  if (normalized.score >= 0.85) {
    normalized.action = 'execute';
  } else if (normalized.score >= 0.50) {
    normalized.action = 'confirm';
  } else if (normalized.score >= 0.20) {
    normalized.action = 'suggest';
    normalized.suggestions = await getTopIntents(text, 3);
  } else {
    normalized.action = 'fallback';
  }

  return normalized;
}

/**
 * Retorna os top-N intents mais prováveis para uma frase.
 */
async function getTopIntents(text, n = 3) {
  if (!isTrained) await train();

  const classifications = await manager.classify(text);
  if (!classifications || !classifications.classifications) return [];

  return classifications.classifications
    .sort((a, b) => b.score - a.score)
    .slice(0, n)
    .map((c) => ({
      intent: c.intent,
      score: c.score,
      domain: c.intent.split('.')[0] || 'unknown',
    }));
}

/**
 * Lista todos os intents e domínios disponíveis.
 */
function getIntents() {
  const intents = [];
  for (const [domain, info] of Object.entries(DOMAINS)) {
    for (const intent of info.intents) {
      intents.push({ domain, intent, description: info.description });
    }
  }
  return intents;
}

/**
 * Adiciona novos exemplos de treinamento em runtime e re-treina.
 * Útil para active learning — quando o usuário corrige uma classificação.
 */
async function addTrainingExample(lang, utterance, intent) {
  manager.addDocument(lang, utterance, intent);
  console.log(`[LunaNLU] Novo exemplo adicionado: [${lang}] "${utterance}" → ${intent}`);

  // Persiste no PostgreSQL (se disponível)
  if (db && global.process.env.DATABASE_URL) {
    try {
      await db.run(
        `INSERT INTO luna_training_examples (lang, utterance, intent, source)
         VALUES ($1, $2, $3, 'active_learning')
         ON CONFLICT (lang, utterance, intent) DO NOTHING`,
        [lang, utterance, intent]
      );
      console.log('[LunaNLU] 💾 Exemplo persistido no PostgreSQL.');
    } catch (e) {
      console.warn('[LunaNLU] Falha ao persistir exemplo no PG:', e.message);
    }
  }

  // Re-treina incrementalmente
  await manager.train();
  manager.save(MODEL_PATH);
  console.log('[LunaNLU] Modelo re-treinado e salvo.');
}

module.exports = {
  train,
  process,
  getTopIntents,
  getIntents,
  addTrainingExample,
  DOMAINS,
  ENTITIES,
  TRAINING_CORPUS,
};
