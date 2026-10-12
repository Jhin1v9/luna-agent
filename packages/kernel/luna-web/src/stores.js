import { writable, derived } from 'svelte/store';

export const sessions = writable([]);
export const selectedSessionIds = writable(new Set());
export const selectionMode = writable(false);


// v10.27-fix: session is NOT persisted. Opening / always lands on the home screen.
export const currentSessionId = writable(null);
export const isStreaming = writable(false);
export const currentMode = writable('instant');
// v10.33-fix: sanitize provider from localStorage in case it was corrupted to [object Object]
function getStoredProvider() {
  const raw = localStorage.getItem('luna_provider');
  if (typeof raw === 'string' && raw && raw !== '[object Object]') return raw;
  return 'kimi';
}
export const currentProvider = writable(getStoredProvider());
export const messages = writable([]);
export const lunaConfig = writable({});
export const connectionStatus = writable('connected');
export const user = writable(null);
export const authToken = writable(localStorage.getItem('luna_token') || null);

// Persist provider selection across reloads
currentProvider.subscribe(provider => {
  try {
    if (typeof provider === 'string' && provider && provider !== '[object Object]') {
      localStorage.setItem('luna_provider', provider);
    }
  } catch (e) {
    console.warn('Provider persist error:', e);
  }
});

// v9.1-fix: lunaStore for ChatHeader status indicators
export const lunaStore = derived(
  [connectionStatus, isStreaming],
  ([$connectionStatus, $isStreaming]) => ({
    isLoading: $isStreaming,
    isOnline: $connectionStatus === 'connected'
  })
);

export const currentSession = derived(
  [sessions, currentSessionId],
  ([$sessions, $id]) => $sessions.find(s => s.id === $id)
);

// Theme system: dynamic accent colors per mode
export const MODE_COLORS = {
  instant:  { primary: '#06b6d4', glow: 'rgba(6,182,212,0.3)',  border: 'rgba(6,182,212,0.15)',  name: 'Instant' },
  thinking: { primary: '#a855f7', glow: 'rgba(168,85,247,0.3)', border: 'rgba(168,85,247,0.15)', name: 'Thinking' },
};

// ── Mascote Luna ──
export const mascotState = writable('sleep'); // sleep | idle | thinking | working
export const mascotMessage = writable(null); // Mensagem contextual temporária

export const PLAN_MODE_COLORS = {
  primary: '#c9a227',
  glow: 'rgba(201,162,39,0.3)',
  border: 'rgba(201,162,39,0.15)',
  bg: '#1a1a2e',
  surface: '#12121f',
  text: '#e2e8f0',
  accent: '#ffd700',
};

export const planModeState = writable({
  active: false,
  plan: null,
  planPath: null,
  status: 'idle',
  sessionId: null,
});

export const themeColors = derived(
  currentMode,
  ($mode) => MODE_COLORS[$mode] || MODE_COLORS.thinking
);

// Action event store for triggering starfield effects when tools/actions execute
export const actionEvent = writable(null);

// Voice state store
export const voiceState = writable({
  active: false,
  status: 'idle', // 'idle' | 'listening' | 'processing'
});

// Real-time audio frequency data (Uint8Array, 64 bins)
export const voiceAudioData = writable(new Uint8Array(64));

// v9.3: Active modal for rich slash command responses
export const activeModal = writable(null); // null | 'tasks' | 'leads' | 'finance' | 'voting' | 'ideas' | 'links' | 'emails' | 'whatsapp' | 'config'

// v10.12: Compact animation state — moon phases while context is compacting
export const compactState = writable({
  active: false,
  phase: 0, // 0-7 moon phase index
  message: '',
  steps: [],
});

// v10.17: Changelog modal state
export const changelogModalOpen = writable(false);
export const changelogData = writable({
  version: '',
  date: '',
  updates: []
});
