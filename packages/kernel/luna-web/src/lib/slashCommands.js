/**
 * Slash Commands Registry for Luna Web
 * All commands starting with / are executed locally via luna-tools.cjs
 * without going through the Kimi Bridge.
 */

// v12.5: Lucide premium icons (0 emojis)
import {
  RefreshCcw, Bot, Monitor, Ghost, BarChart3, Octagon, Play, HeartPulse,
  ScrollText, Trash2, Package, Sparkles, Moon, HelpCircle, Zap,
  BookOpen, PenSquare, Paperclip, Wrench, ClipboardList, FolderOpen, Folder,
  Search, SearchCode, Terminal, FlaskConical, GitBranch, Save, Globe, Radio,
  Download, FilePenLine, CheckCircle2, User, Users, DollarSign, Banknote,
  TrendingDown, TrendingUp, CreditCard, Vote, Plus, Lightbulb, Link, Mail, MessageSquare,
  Bell, Settings, Brain,
} from 'lucide-svelte';

export const SLASH_COMMANDS = [
  // ── System ──
  { cmd: '/reiniciar',   desc: 'Reiniciar todos os servicos',        lucide: RefreshCcw, category: 'System', handler: 'systemRestart' },
  { cmd: '/agent',       desc: 'Status do agente Luna',              lucide: Bot, category: 'System', handler: 'agentStatus' },
  { cmd: '/visible',     desc: 'Modo visivel — cmds abrem terminal', lucide: Monitor, category: 'System', handler: 'setVisibleMode' },
  { cmd: '/invisible',   desc: 'Modo invisivel — cmds em background', lucide: Ghost, category: 'System', handler: 'setInvisibleMode' },
  { cmd: '/status',      desc: 'Status dos servicos',                lucide: BarChart3, category: 'System', handler: 'systemStatus' },
  { cmd: '/parar',       desc: 'Parar todos os servicos',            lucide: Octagon, category: 'System', handler: 'systemStop' },
  { cmd: '/ligar',       desc: 'Iniciar todos os servicos',          lucide: Play, category: 'System', handler: 'systemStart' },
  { cmd: '/health',      desc: 'Verificar saude do sistema',         lucide: HeartPulse, category: 'System', handler: 'systemHealth' },
  { cmd: '/logs',        desc: 'Ver ultimos logs',                   lucide: ScrollText, category: 'System', handler: 'systemLogs' },
  { cmd: '/limpar',      desc: 'Limpar chat',                        lucide: Trash2, category: 'System', handler: 'clearChat' },
  { cmd: '/compactar',   desc: 'Compactar contexto (nova thread + checkpoint)', lucide: Package, category: 'System', handler: 'compactContext' },
  { cmd: '/nova',        desc: 'Nova sessao',                        lucide: Sparkles, category: 'System', handler: 'newSession' },
  { cmd: '/turnoff',     desc: 'Desligar agente (fecha Chrome)',     lucide: Moon, category: 'System', handler: 'turnOffAgent' },
  { cmd: '/ajuda',       desc: 'Mostrar ajuda',                      lucide: HelpCircle, category: 'System', handler: 'help' },
  { cmd: '/modo',        desc: 'Trocar modo (instant/thinking)', lucide: Zap, category: 'System', handler: 'changeMode' },
  { cmd: '/refresh',     desc: 'Diagnosticar e reparar conexoes (Soul, Bridge, SSE)', lucide: RefreshCcw, category: 'System', handler: 'refreshAgent' },
  { cmd: '/fullrefresh', desc: 'Refresh completo + continuar ultima acao',     lucide: RefreshCcw, category: 'System', handler: 'fullRefreshAgent' },

  // ── File Ops ──
  { cmd: '/read',        desc: 'Ler arquivo — /read path/to/file',   lucide: BookOpen, category: 'File', handler: 'readFile' },
  { cmd: '/write',       desc: 'Escrever arquivo — /write path "conteudo"', lucide: PenSquare, category: 'File', handler: 'writeFile' },
  { cmd: '/append',      desc: 'Adicionar ao arquivo',               lucide: Paperclip, category: 'File', handler: 'appendFile' },
  { cmd: '/replace',     desc: 'Substituir no arquivo',              lucide: Wrench, category: 'File', handler: 'replaceInFile' },
  { cmd: '/delete',      desc: 'Deletar arquivo',                    lucide: Trash2, category: 'File', handler: 'deleteFile' },
  { cmd: '/move',        desc: 'Mover arquivo',                      lucide: Package, category: 'File', handler: 'moveFile' },
  { cmd: '/copy',        desc: 'Copiar arquivo',                     lucide: ClipboardList, category: 'File', handler: 'copyFile' },
  { cmd: '/ls',          desc: 'Listar diretorio',                   lucide: FolderOpen, category: 'File', handler: 'listFiles' },
  { cmd: '/mkdir',       desc: 'Criar diretorio',                    lucide: Folder, category: 'File', handler: 'createDirectory' },
  { cmd: '/rmdir',       desc: 'Remover diretorio',                  lucide: Trash2, category: 'File', handler: 'removeDirectory' },
  { cmd: '/search',      desc: 'Buscar arquivos',                    lucide: Search, category: 'File', handler: 'searchFiles' },
  { cmd: '/grep',        desc: 'Grep em arquivos',                   lucide: SearchCode, category: 'File', handler: 'grep' },

  // ── Shell ──
  { cmd: '/run',         desc: 'Executar comando shell',             lucide: Terminal, category: 'Shell', handler: 'executeShell' },
  { cmd: '/test',        desc: 'Rodar testes',                       lucide: FlaskConical, category: 'Shell', handler: 'runTests' },
  { cmd: '/lint',        desc: 'Verificar sintaxe',                  lucide: Search, category: 'Shell', handler: 'checkSyntax' },
  { cmd: '/install',     desc: 'Instalar pacotes',                   lucide: Package, category: 'Shell', handler: 'installPackages' },

  // ── Git ──
  { cmd: '/git-status',  desc: 'Git status',                         lucide: GitBranch, category: 'Git', handler: 'gitStatus' },
  { cmd: '/git-diff',    desc: 'Git diff',                           lucide: BarChart3, category: 'Git', handler: 'gitDiff' },
  { cmd: '/git-log',     desc: 'Git log',                            lucide: ScrollText, category: 'Git', handler: 'gitLog' },
  { cmd: '/git-commit',  desc: 'Git commit',                         lucide: Save, category: 'Git', handler: 'gitCommit' },

  // ── Web ──
  { cmd: '/web',         desc: 'Buscar na web',                      lucide: Globe, category: 'Web', handler: 'searchWeb' },
  { cmd: '/fetch',       desc: 'Fetch URL',                          lucide: Radio, category: 'Web', handler: 'fetchURL' },
  { cmd: '/download',    desc: 'Download arquivo',                   lucide: Download, category: 'Web', handler: 'downloadFile' },

  // ── Dashboard — Tarefas ──
  { cmd: '/tarefa',      desc: 'Criar tarefa',                       lucide: ClipboardList, category: 'Dashboard', handler: 'dashboardCreateTask', modal: 'tasks' },
  { cmd: '/tarefas',     desc: 'Listar tarefas',                     lucide: ClipboardList, category: 'Dashboard', handler: 'dashboardListTasks', modal: 'tasks' },
  { cmd: '/tarefa-update', desc: 'Atualizar tarefa',                 lucide: FilePenLine, category: 'Dashboard', handler: 'dashboardUpdateTask', modal: 'tasks' },
  { cmd: '/tarefa-done', desc: 'Completar tarefa',                   lucide: CheckCircle2, category: 'Dashboard', handler: 'dashboardCompleteTask', modal: 'tasks' },

  // ── Dashboard — Leads ──
  { cmd: '/lead',        desc: 'Criar lead',                         lucide: User, category: 'Dashboard', handler: 'dashboardCreateLead', modal: 'leads' },
  { cmd: '/leads',       desc: 'Listar leads',                       lucide: Users, category: 'Dashboard', handler: 'dashboardListLeads', modal: 'leads' },

  // ── Dashboard — Financeiro ──
  { cmd: '/caixa',       desc: 'Consultar caixa',                    lucide: DollarSign, category: 'Dashboard', handler: 'dashboardGetCashBox', modal: 'finance' },
  { cmd: '/caixa-add',   desc: 'Adicionar entrada caixa',            lucide: Banknote, category: 'Dashboard', handler: 'dashboardAddCashEntry', modal: 'finance' },
  { cmd: '/caixa-hist',  desc: 'Historico caixa',                    lucide: ScrollText, category: 'Dashboard', handler: 'dashboardListCashHistory', modal: 'finance' },
  { cmd: '/despesa',     desc: 'Criar despesa',                      lucide: TrendingDown, category: 'Dashboard', handler: 'dashboardCreateExpense', modal: 'finance' },
  { cmd: '/despesas',    desc: 'Listar despesas',                    lucide: BarChart3, category: 'Dashboard', handler: 'dashboardListExpenses', modal: 'finance' },
  { cmd: '/pagamento',   desc: 'Criar pagamento',                    lucide: CreditCard, category: 'Dashboard', handler: 'dashboardCreatePayment', modal: 'finance' },
  { cmd: '/pagamentos',  desc: 'Listar pagamentos',                  lucide: ClipboardList, category: 'Dashboard', handler: 'dashboardListPayments', modal: 'finance' },

  // ── Dashboard — Votacao ──
  { cmd: '/votacao',     desc: 'Listar votacoes',                    lucide: Vote, category: 'Dashboard', handler: 'dashboardListVotingSessions', modal: 'voting' },
  { cmd: '/votacao-criar', desc: 'Criar votacao',                    lucide: Plus, category: 'Dashboard', handler: 'dashboardCreateVotingSession', modal: 'voting' },

  // ── Dashboard — Ideias ──
  { cmd: '/ideia',       desc: 'Criar ideia',                        lucide: Lightbulb, category: 'Dashboard', handler: 'dashboardCreateIdea' },
  { cmd: '/ideias',      desc: 'Listar ideias',                      lucide: Lightbulb, category: 'Dashboard', handler: 'dashboardListIdeas' },

  // ── Dashboard — Links ──
  { cmd: '/link',        desc: 'Adicionar link',                     lucide: Link, category: 'Dashboard', handler: 'dashboardAddLink' },
  { cmd: '/links',       desc: 'Listar links',                       lucide: Link, category: 'Dashboard', handler: 'dashboardListLinks' },

  // ── Dashboard — Email ──
  { cmd: '/email',       desc: 'Enviar email',                       lucide: Mail, category: 'Dashboard', handler: 'dashboardSendEmail' },
  { cmd: '/emails',      desc: 'Listar emails',                      lucide: Mail, category: 'Dashboard', handler: 'dashboardListEmails' },

  // ── Dashboard — WhatsApp ──
  { cmd: '/whatsapp',    desc: 'Enviar WhatsApp',                    lucide: MessageSquare, category: 'Dashboard', handler: 'dashboardSendWhatsApp' },
  { cmd: '/whatsapp-status', desc: 'Status WhatsApp',                lucide: MessageSquare, category: 'Dashboard', handler: 'dashboardGetWhatsAppStatus' },

  // ── Dashboard — Sistema ──
  { cmd: '/notificacoes', desc: 'Listar notificacoes',               lucide: Bell, category: 'Dashboard', handler: 'dashboardListNotifications' },
  { cmd: '/usuarios',    desc: 'Listar usuarios',                    lucide: Users, category: 'Dashboard', handler: 'dashboardListUsers' },
  { cmd: '/projetos',    desc: 'Listar projetos',                    lucide: Folder, category: 'Dashboard', handler: 'dashboardListProjects' },
  { cmd: '/clientes',    desc: 'Listar clientes',                    lucide: User, category: 'Dashboard', handler: 'dashboardListClients' },
  { cmd: '/financeiro',  desc: 'Resumo financeiro',                  lucide: TrendingUp, category: 'Dashboard', handler: 'dashboardGetFinanceSummary', modal: 'finance' },
  { cmd: '/config',      desc: 'Configuracoes dashboard',            lucide: Settings, category: 'Dashboard', handler: 'dashboardGetConfig' },

  // ── Agent Tools ──
  { cmd: '/plan',        desc: 'Modo Detetive — planejar antes de executar', lucide: Search, category: 'Agent', handler: 'planMode' },
  { cmd: '/think',       desc: 'Modo raciocinio profundo',           lucide: Brain, category: 'Agent', handler: 'think' },
  { cmd: '/clipboard',   desc: 'Ler clipboard',                      lucide: ClipboardList, category: 'Agent', handler: 'clipboardRead' },
  { cmd: '/pwd',         desc: 'Diretorio atual',                    lucide: Folder, category: 'Agent', handler: 'getCurrentDirectory' },
];

/**
 * Parse a slash command message into { command, args }
 * e.g. "/read /path/to/file" → { command: '/read', args: ['/path/to/file'] }
 * e.g. "/write file.txt hello world" → { command: '/write', args: ['file.txt', 'hello world'] }
 */
export function parseSlashCommand(text) {
  const trimmed = text.trim();
  if (!trimmed.startsWith('/')) return null;
  const parts = trimmed.split(/\s+/);
  const command = parts[0];
  const args = parts.slice(1);
  return { command, args, raw: trimmed };
}

/**
 * Check if text is a slash command
 */
export function isSlashCommand(text) {
  return typeof text === 'string' && text.trim().startsWith('/');
}
