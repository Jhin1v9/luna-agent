<script>
  import { onMount, onDestroy } from 'svelte';
  import { Moon } from 'lucide-svelte';
  import { sessions, currentSessionId, isStreaming, messages, lunaConfig, connectionStatus, currentMode, user, MODE_COLORS, planModeState, PLAN_MODE_COLORS, mascotState, changelogModalOpen, changelogData, currentProvider } from './stores.js';

  // Update CSS theme variables when mode changes
  $: {
    const root = document.documentElement;
    console.log(`[PLAN UI] tema planModeState.active=`, $planModeState.active);
    if ($planModeState.active) {
      root.style.setProperty('--luna-accent', PLAN_MODE_COLORS.primary);
      root.style.setProperty('--luna-accent-glow', PLAN_MODE_COLORS.glow);
      root.style.setProperty('--luna-accent-border', PLAN_MODE_COLORS.border);
      document.body.classList.add('plan-mode-active');
    } else {
      const theme = MODE_COLORS[$currentMode] || MODE_COLORS.thinking;
      root.style.setProperty('--luna-accent', theme.primary);
      root.style.setProperty('--luna-accent-glow', theme.glow);
      root.style.setProperty('--luna-accent-border', theme.border);
      document.body.classList.remove('plan-mode-active');
    }
  }
  import { fetchSessions, fetchConfig, sessionAction, SSEManager, fetchMe, agentStatus } from './api.js';
  import Sidebar from './components/Sidebar.svelte';
  import ChatArea from './components/ChatArea.svelte';
  import LoginPage from './components/LoginPage.svelte';
  import ConfigDrawer from './components/ConfigDrawer.svelte';

  import ParticleBackground from './components/ParticleBackground.svelte';
  import WelcomeScreen from './components/WelcomeScreen.svelte';
  import ChangelogModal from './components/ChangelogModal.svelte';


  let configOpen = false;
  let mobileSidebarOpen = false;
  let authChecked = false;
  let sidebarCollapsed = false;
  let sessionsLoading = false;

  // Quando não há sessão ativa, Luna vai dormir Zzz
  $: if (!$currentSessionId) mascotState.set('sleep');

  async function handleNewSession(selectedProvider = null) {
    const provider = (typeof selectedProvider === 'string' ? selectedProvider : null)
      || (typeof $currentProvider === 'string' ? $currentProvider : null)
      || 'kimi';
    const res = await sessionAction('create', null, 'Nova Sessão', provider);
    if (res.ok && res.session) {
      const newSession = { ...res.session, updatedAt: new Date().toISOString() };
      sessions.update(s => [newSession, ...s]);
      currentSessionId.set(res.session.id);
      // v10.18-fix: reset stale plan-mode state so a new session can start a fresh plan
      planModeState.set({ active: false, status: 'idle', plan: null, planPath: null, sessionId: null });
    }
  }

  async function handleRename(id, title) {
    await sessionAction('rename', id, title);
    sessions.update(s => s.map(sess => sess.id === id ? { ...sess, title } : sess));
  }

  async function handleDelete(id) {
    await sessionAction('delete', id);
    sessions.update(s => s.filter(sess => sess.id !== id));
    currentSessionId.update(current => current === id ? null : current);
  }

  async function handleSaveConfig(cfg) {
    // v5.0-fix: send env and systemPrompt separately as backend expects
    const env = {};
    const systemPrompt = cfg.SYSTEM_PROMPT;
    for (const [key, value] of Object.entries(cfg)) {
      if (key === 'SYSTEM_PROMPT') continue;
      if (value !== undefined && value !== '') env[key] = value;
    }
    await fetch('api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ env, systemPrompt })
    });
    lunaConfig.set(cfg);
  }

  async function handleRestartLuna() {
    try {
      const res = await fetch('api/system/restart', { method: 'POST' });
      const data = await res.json();
      alert(data.message || 'Reiniciando...');
    } catch (e) {
      alert('Erro ao reiniciar: ' + e.message);
    }
  }

  // Sync sessionId with URL query param — enables copy-paste URL to continue chat
  function getSessionFromURL() {
    const params = new URLSearchParams(window.location.search);
    return params.get('session');
  }
  function setSessionInURL(sessionId) {
    const url = new URL(window.location);
    if (sessionId) {
      url.searchParams.set('session', sessionId);
    } else {
      url.searchParams.delete('session');
    }
    window.history.replaceState({}, '', url);
  }

  // Subscribe to currentSessionId changes and sync to URL
  const unsubSession = currentSessionId.subscribe(id => {
    setSessionInURL(id);
  });

  // v10.2: Agent status polling — updates mascotState based on real backend status
  let agentStatusInterval = null;

  async function updateAgentStatus() {
    try {
      const res = await agentStatus();
      if (res.ok && res.agent) {
        const state = res.agent.state;
        // Only update if not currently streaming (streaming has its own states)
        if (!$isStreaming) {
          if (state === 'online') mascotState.set('idle');
          else if (state === 'degraded') mascotState.set('error');
          else if (state === 'starting') mascotState.set('thinking');
          else mascotState.set('sleep');
        }
      }
    } catch (e) {
      if (!$isStreaming) mascotState.set('sleep');
    }
  }

  onMount(async () => {
    // v10.27-fix: on root URL (/), always start at home and ignore persisted session.
    // Only restore a session if the URL explicitly requests it via ?session=xxx.
    if (!getSessionFromURL()) {
      currentSessionId.set(null);
    }

    // Auto-login: validate existing token
    try {
      const me = await fetchMe();
      if (me) {
        user.set(me);
      }
    } catch (e) {
      console.error('Auth check error:', e);
    }
    authChecked = true;

    // v10.20-fix: load sessions in the background so UI renders immediately
    sessionsLoading = true;
    fetchSessions()
      .then(res => {
        if (res.ok && res.sessions) {
          sessions.set(res.sessions);
        }

        // v5.3: Check URL first, then localStorage, then fallback
        const urlSessionId = getSessionFromURL();
        if (urlSessionId) {
          currentSessionId.set(urlSessionId);
        } else if (res.ok && res.sessions) {
          const storedId = $currentSessionId;
          if (storedId && !res.sessions.find(s => s.id === storedId)) {
            currentSessionId.set(null);
          }
        }
      })
      .catch(e => {
        console.error('Sessions load error:', e);
      })
      .finally(() => {
        sessionsLoading = false;
      });

    try {
      const cfg = await fetchConfig();
      if (cfg) lunaConfig.set(cfg);
    } catch (e) {
      console.error('Init error:', e);
    }

    // v10.18: Load changelog independently (newest release first) and show if new version
    try {
      const changelogRes = await fetch('/CHANGELOG.json');
      if (changelogRes.ok) {
        const data = await changelogRes.json();
        changelogData.set(data);
        const latestVersion = data.releases && data.releases[0] ? data.releases[0].version : data.version;
        const seenVersion = localStorage.getItem('luna_changelog_seen');
        if (latestVersion && latestVersion !== seenVersion) {
          // Show changelog after a short delay for UX
          setTimeout(() => changelogModalOpen.set(true), 1500);
        }
      }
    } catch (e) {
      console.warn('Changelog load error:', e);
    }

    // Start agent status polling
    updateAgentStatus();
    agentStatusInterval = setInterval(updateAgentStatus, 5000);

    return () => {
      unsubSession();
      if (agentStatusInterval) clearInterval(agentStatusInterval);
    };
  });
</script>

<svelte:window on:keydown={(e) => {
  if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    handleNewSession();
  }
}}/>

{#if $user}
  <ParticleBackground />
  <div class="app-layout">
    <div class="app-body">
      <Sidebar
        sessions={$sessions}
        currentId={$currentSessionId}
        loading={sessionsLoading}
        onSelect={(id) => {
          const sess = $sessions.find(s => s.id === id);
          if (sess?.mode) currentMode.set(sess.mode);
          currentSessionId.set(id);
          // v10.18-fix: sync plan-mode state with selected session
          if (sess?.planMode) {
            planModeState.set({ active: true, status: sess.planStatus || 'idle', plan: null, planPath: null, sessionId: id });
          } else {
            planModeState.set({ active: false, status: 'idle', plan: null, planPath: null, sessionId: null });
          }
        }}
        onNew={handleNewSession}
        onRename={handleRename}
        onDelete={handleDelete}
        onOpenConfig={() => configOpen = true}
        bind:mobileOpen={mobileSidebarOpen}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => sidebarCollapsed = !sidebarCollapsed}
      />

      <main class="main-content">
        {#if $currentSessionId}
          <ChatArea
            sessionId={$currentSessionId}
            on:openConfig={() => configOpen = true}
            on:newChat={handleNewSession}
            on:editTitle={() => {
              const currentSession = $sessions.find(s => s.id === $currentSessionId);
              const newTitle = prompt('Editar nome da conversa:', currentSession?.title || '');
              if (newTitle && newTitle.trim()) {
                handleRename($currentSessionId, newTitle.trim());
              }
            }}
          />
        {:else}
          <WelcomeScreen
            sessions={$sessions}
            onNewSession={handleNewSession}
            onSelectSession={(id) => {
              const sess = $sessions.find(s => s.id === id);
              if (sess?.mode) currentMode.set(sess.mode);
              currentSessionId.set(id);
              // v10.18-fix: sync plan-mode state with selected session
              if (sess?.planMode) {
                planModeState.set({ active: true, status: sess.planStatus || 'idle', plan: null, planPath: null, sessionId: id });
              } else {
                planModeState.set({ active: false, status: 'idle', plan: null, planPath: null, sessionId: null });
              }
            }}
          />
        {/if}
      </main>

      <ConfigDrawer
        open={configOpen}
        config={$lunaConfig}
        onSave={handleSaveConfig}
        onClose={() => configOpen = false}
        onRestart={handleRestartLuna}
      />
    </div>

    <!-- StatusBar removido — mais espaço para o chat -->

    <!-- v10.17: Changelog modal -->
    <ChangelogModal />
  </div>
{:else if authChecked}
  <LoginPage />
{:else}
  <!-- Auth checking loader -->
  <div class="auth-loader">
    <div class="auth-loader-icon"><Moon size={24} /></div>
    <div class="auth-loader-text">Conectando...</div>
  </div>
{/if}

<style>
  .app-layout {
    display: flex;
    flex-direction: column;
    height: 100vh;
    height: 100dvh;
    background: transparent;
    overflow: hidden;
  }
  .app-body {
    display: flex;
    flex: 1;
    min-height: 0;
    overflow: hidden;
  }
  .main-content {
    flex: 1;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    min-width: 0;
  }
  @media (max-width: 768px) {
    .main-content {
      padding-top: 52px; /* espaço pro hamburger button */
    }
  }
  .auth-loader {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100vh;
    height: 100dvh;
    background: var(--luna-bg);
    color: var(--luna-text);
    gap: 16px;
  }
  .auth-loader-icon {
    font-size: 48px;
    animation: pulse 2s ease-in-out infinite;
  }
  .auth-loader-text {
    font-size: 14px;
    color: var(--luna-text-secondary);
    font-family: 'JetBrains Mono', monospace;
  }
  @keyframes pulse {
    0%, 100% { opacity: 0.6; transform: scale(1); }
    50% { opacity: 1; transform: scale(1.1); }
  }
  @media (max-width: 768px) {
    .app-body {
      flex-direction: column;
    }
  }
</style>
