// Luna Premium Icon Map — v12.5
// Maps semantic names to Lucide Svelte components.
// Fallback: CircleDot (neutral premium) when no specific icon exists.

import {
  // Status / feedback
  CheckCircle2, XCircle, AlertTriangle, Info, Bell, Megaphone,
  // Actions
  Trash2, Copy, Download, Save, RefreshCcw, RotateCcw, Square,
  // Files
  BookOpen, PenSquare, FilePlus, FilePenLine, File, Folder, Move,
  // Search / web
  Search, Globe, FileSearch,
  // Shell / system
  Terminal, Cpu, Radio, Activity, Power, PowerOff, Shield, Lock,
  // Git
  GitBranch, GitCommit, GitPullRequest, Save as GitSave, ScrollText,
  // Thinking / persona
  Brain, BrainCircuit, Drama, Lightbulb,
  // Modes
  Zap, Target, Eye, EyeOff,
  // Misc
  Mic, MicOff, Paperclip, Camera, FlaskConical, Palette, Wrench, Settings,
  Gem, Trophy, Sparkles, Star, Flame, Rocket, CircleDot,
  ThumbsUp, ThumbsDown, Send, Plus, History, User, Moon,
  ChevronDown, ChevronUp, ChevronLeft, ChevronRight, X, Check,
  Loader2, Clock, Hourglass, Calendar, Tag, Hash,
} from 'lucide-svelte';

// Semantic map: name -> component
export const LUNA_ICONS = {
  // Status
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
  notification: Bell,
  system: Megaphone,

  // Actions
  delete: Trash2,
  copy: Copy,
  download: Download,
  save: Save,
  refresh: RefreshCcw,
  undo: RotateCcw,
  stop: Square,

  // Files
  read: BookOpen,
  write: PenSquare,
  append: FilePlus,
  replace: FilePenLine,
  file: File,
  folder: Folder,
  move: Move,

  // Search / web
  search: Search,
  web: Globe,
  fileSearch: FileSearch,

  // Shell / system
  terminal: Terminal,
  cpu: Cpu,
  liveOutput: Radio,
  activity: Activity,
  power: Power,
  powerOff: PowerOff,
  shield: Shield,
  lock: Lock,

  // Git
  git: GitBranch,
  gitCommit: GitCommit,
  gitPullRequest: GitPullRequest,
  gitLog: ScrollText,

  // Thinking / persona
  think: Brain,
  thinking: BrainCircuit,
  persona: Drama,
  idea: Lightbulb,

  // Modes
  instant: Zap,
  target: Target,
  eye: Eye,
  eyeOff: EyeOff,

  // Misc
  mic: Mic,
  micOff: MicOff,
  attach: Paperclip,
  camera: Camera,
  test: FlaskConical,
  palette: Palette,
  wrench: Wrench,
  settings: Settings,
  gem: Gem,
  trophy: Trophy,
  sparkles: Sparkles,
  star: Star,
  flame: Flame,
  send: Rocket,
  like: ThumbsUp,
  dislike: ThumbsDown,
  sendMessage: Send,
  plus: Plus,
  history: History,
  user: User,
  moon: Moon,

  // Chevrons / UI
  chevronDown: ChevronDown,
  chevronUp: ChevronUp,
  chevronLeft: ChevronLeft,
  chevronRight: ChevronRight,
  close: X,
  check: Check,
  loading: Loader2,
  clock: Clock,
  hourglass: Hourglass,
  calendar: Calendar,
  tag: Tag,
  hash: Hash,

  // Fallback
  fallback: CircleDot,
};

// Tool name -> icon mapping (matches tool-registry.cjs meta.icon replacement)
export const TOOL_ICONS_LUCIDE = {
  web_search: 'web',
  readFile: 'read',
  writeFile: 'write',
  appendFile: 'append',
  replaceInFile: 'replace',
  deleteFile: 'delete',
  moveFile: 'move',
  copyFile: 'copy',
  getFileInfo: 'file',
  listFiles: 'folder',
  viewDirectory: 'folder',
  createDirectory: 'folder',
  removeDirectory: 'delete',
  searchFiles: 'fileSearch',
  grep: 'search',
  glob: 'fileSearch',
  executeShell: 'terminal',
  executeScript: 'terminal',
  runBuildCheck: 'test',
  runTests: 'test',
  checkSyntax: 'check',
  gitStatus: 'git',
  gitDiff: 'git',
  gitLog: 'gitLog',
  gitCommit: 'gitCommit',
  gitPush: 'gitPullRequest',
  gitPull: 'gitPullRequest',
  applyPatch: 'save',
  downloadFile: 'download',
  fetchURL: 'web',
  searchWeb: 'web',
  browser: 'web',
  ipython: 'cpu',
  python: 'cpu',
  code: 'cpu',
  executePython: 'cpu',
  think: 'think',
  getCurrentDirectory: 'folder',
  setVisibleMode: 'eye',
  getVisibleMode: 'eyeOff',
  screenshot: 'camera',
  clipboardRead: 'copy',
  clipboardWrite: 'copy',
  open_app: 'sendMessage',
  dashboardCreateTask: 'plus',
  dashboardListTasks: 'file',
  dashboardCreateLead: 'user',
  dashboardListLeads: 'user',
  dashboardGetFinanceSummary: 'gem',
  dashboardListIdeas: 'idea',
  dashboardCreateIdea: 'idea',
  dashboardListVotingSessions: 'trophy',
  dashboardCreateVotingSession: 'trophy',
  dashboardVoteInSession: 'trophy',
  dashboardDeleteVotingSession: 'delete',
  dashboardGetSystemStatus: 'activity',
  dashboardGetSystemLogs: 'file',
  dashboardListNotifications: 'notification',
  dashboardListUsers: 'user',
  dashboardListGitHubRepos: 'git',
  dashboardListVercelProjects: 'rocket',
  dashboardListBugReports: 'warning',
  dashboardListEmails: 'sendMessage',
  dashboardListLinks: 'web',
};

// Emoji -> semantic icon name (for legacy backend messages)
export const EMOJI_TO_ICON = {
  '✅': 'success',
  '❌': 'error',
  '⚠️': 'warning',
  'ℹ️': 'info',
  '🔔': 'notification',
  '📢': 'system',
  '🗑️': 'delete',
  '📋': 'copy',
  '⬇️': 'download',
  '💾': 'save',
  '🔄': 'refresh',
  '⏹️': 'stop',
  '📖': 'read',
  '✍️': 'write',
  '📝': 'append',
  '✏️': 'replace',
  '📄': 'file',
  '📁': 'folder',
  '📦': 'move',
  '🔍': 'search',
  '🌐': 'web',
  '🖥️': 'terminal',
  '📡': 'liveOutput',
  '⚡': 'instant',
  '🧠': 'think',
  '🤔': 'thinking',
  '🎭': 'persona',
  '💡': 'idea',
  '🎯': 'target',
  '👁': 'eye',
  '🙈': 'eyeOff',
  '🎙️': 'mic',
  '📎': 'attach',
  '📸': 'camera',
  '🧪': 'test',
  '🎨': 'palette',
  '🔧': 'wrench',
  '⚙️': 'settings',
  '💎': 'gem',
  '🏆': 'trophy',
  '✨': 'sparkles',
  '⭐': 'star',
  '🔥': 'flame',
  '🚀': 'send',
  '👍': 'like',
  '👎': 'dislike',
  '🕐': 'clock',
  '⏳': 'hourglass',
  '📅': 'calendar',
  '🏷️': 'tag',
  '#️⃣': 'hash',
};

export function getIconComponent(name) {
  return LUNA_ICONS[name] || LUNA_ICONS.fallback;
}

export function getToolIcon(toolName) {
  const semantic = TOOL_ICONS_LUCIDE[toolName];
  return getIconComponent(semantic);
}

export function emojiToIconComponent(emoji) {
  const semantic = EMOJI_TO_ICON[emoji];
  return getIconComponent(semantic);
}
