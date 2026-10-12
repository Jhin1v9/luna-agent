<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { fly, fade } from 'svelte/transition';
  import {
    Settings, Bot, BarChart3, Brain, Zap, Dna, Terminal, BookOpen,
    Eye, EyeOff, Hourglass, Plug, CheckCircle2, XCircle, AlertTriangle,
    RefreshCcw, Save, Rocket, Download, Upload, Users, Star, Globe, Search, Bug,
  } from 'lucide-svelte';
  import { downloadFile, parseEnvFile, generateEnvFile } from '../utils.js';
  import { testConnection, downloadSelfHost, systemStatus } from '../api.js';

  export let open = false;
  export let config = {};
  export let onSave = () => {};
  export let onClose = () => {};
  export let onRestart = () => {};

  let localConfig = {};
  let activeSection = 'telegram';
  let importInputEl;
  let showPasswordToken = false;
  let showPasswordApi = false;
  let showPasswordJwt = false;
  let charCount = 0;
  let lineCount = 0;
  let showTutorial = false;
  let confirmDialog = null;
  let originalSystemPrompt = '';

  // Real-time status
  let serviceStatus = {};
  let statusLoading = false;
  let testResults = {};
  let testLoading = {};
  let downloadLoading = false;

  $: if (open) {
    localConfig = { ...config };
    updateCounts();
    document.body.style.overflow = 'hidden';
    fetchServiceStatus();
  } else {
    if (typeof document !== 'undefined') document.body.style.overflow = '';
  }

  $: systemPromptValue = localConfig.SYSTEM_PROMPT || '';

  function updateCounts() {
    const text = localConfig.SYSTEM_PROMPT || '';
    charCount = text.length;
    lineCount = text.split('\n').length;
  }

  function handleSystemPromptChange(e) {
    localConfig = { ...localConfig, SYSTEM_PROMPT: e.target.value };
    updateCounts();
  }

  function setSection(section) {
    activeSection = activeSection === section ? null : section;
  }

  function handleSave() {
    onSave({ ...localConfig });
  }

  function handleExportEnv() {
    const env = generateEnvFile(localConfig);
    downloadFile(env, '.env', 'text/plain');
  }

  function handleImportEnv() {
    importInputEl?.click();
  }

  function processImport(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const imported = parseEnvFile(ev.target.result);
      localConfig = { ...localConfig, ...imported };
      updateCounts();
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  function handleRestart() {
    confirmDialog = {
      title: 'Reiniciar Luna',
      message: 'Tem certeza que deseja reiniciar a Luna? Todas as sessoes ativas serao encerradas.',
      action: () => {
        onRestart();
        confirmDialog = null;
      }
    };
  }

  function handleResetPrompt() {
    confirmDialog = {
      title: 'Resetar System Prompt',
      message: 'Isso restaurara o system prompt para o original. Continuar?',
      action: () => {
        localConfig = { ...localConfig, SYSTEM_PROMPT: originalSystemPrompt };
        updateCounts();
        confirmDialog = null;
      }
    };
  }

  async function fetchServiceStatus() {
    statusLoading = true;
    try {
      const data = await systemStatus();
      if (data.ok) serviceStatus = data.status || {};
    } catch (e) {
      console.error('Status fetch error:', e);
    }
    statusLoading = false;
  }

  async function handleTestConnection(type) {
    testLoading[type] = true;
    testResults[type] = null;
    try {
      let token;
      if (type === 'telegram') token = localConfig.TELEGRAM_BOT_TOKEN;
      if (type === 'dashboard') token = localConfig.INTERNAL_API_TOKEN;
      const result = await testConnection(type, token);
      testResults[type] = result;
    } catch (e) {
      testResults[type] = { ok: false, error: e.message };
    }
    testLoading[type] = false;
  }

  async function handleDownloadSelfHost() {
    downloadLoading = true;
    try {
      await downloadSelfHost();
    } catch (e) {
      alert('Erro ao baixar: ' + e.message);
    }
    downloadLoading = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      if (confirmDialog) {
        confirmDialog = null;
      } else {
        onClose();
      }
    }
  }

  function handleBackdropClick(e) {
    if (e.target === e.currentTarget) onClose();
  }

  onMount(() => {
    originalSystemPrompt = localConfig.SYSTEM_PROMPT || '';
  });

  onDestroy(() => {
    if (typeof document !== 'undefined') document.body.style.overflow = '';
  });

  const sections = [
    { key: 'telegram', icon: Bot, title: 'Bot do Telegram' },
    { key: 'dashboard', icon: BarChart3, title: 'Dashboard NEXO PRO' },
    { key: 'kimi', icon: Brain, title: 'Kimi Bridge' },
    { key: 'advanced', icon: Zap, title: 'Avancado' },
    { key: 'prompt', icon: Dna, title: 'System Prompt' },
    { key: 'selfhost', icon: Terminal, title: 'Self-Host Local' },
    { key: 'tutorial', icon: BookOpen, title: 'Tutorial' },
  ];

  function statusBadge(status) {
    if (status === 'running' || status === 'connected') return { text: 'Online', class: 'badge-online' };
    if (status === 'stopped' || status === 'disconnected') return { text: 'Offline', class: 'badge-offline' };
    return { text: 'Desconhecido', class: 'badge-unknown' };
  }
</script>

<svelte:window on:keydown={handleKeydown} />

{#if open}
  <!-- Backdrop -->
  <div
    class="drawer-backdrop"
    on:click={handleBackdropClick}
    transition:fade={{ duration: 200 }}
  />

  <!-- Drawer -->
  <aside
    class="config-drawer"
    transition:fly={{ x: 400, duration: 300, opacity: 1 }}
    role="dialog"
    aria-modal="true"
    aria-label="Configuracoes"
  >
    <!-- Header -->
    <div class="drawer-header">
      <h2 class="drawer-title"><Settings size={20} strokeWidth={1.5} /> Configuracoes</h2>
      <button class="close-btn" on:click={onClose} aria-label="Fechar">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <!-- Content -->
    <div class="drawer-content">
      <!-- Telegram -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('telegram')}>
          <span><Bot size={16} strokeWidth={1.5} /> Bot do Telegram</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'telegram'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'telegram'}
          <div class="section-body" transition:slideExpand>
            <div class="field">
              <label class="field-label" for="telegram-token">TELEGRAM_BOT_TOKEN</label>
              <div class="password-field">
                {#if showPasswordToken}
                  <input id="telegram-token" type="text" class="field-input" bind:value={localConfig.TELEGRAM_BOT_TOKEN} placeholder="Seu token do BotFather" />
                {:else}
                  <input id="telegram-token" type="password" class="field-input" bind:value={localConfig.TELEGRAM_BOT_TOKEN} placeholder="Seu token do BotFather" />
                {/if}
                <button class="toggle-password" on:click={() => showPasswordToken = !showPasswordToken}>
                  {#if showPasswordToken}<EyeOff size={16} strokeWidth={1.5} />{:else}<Eye size={16} strokeWidth={1.5} />{/if}
                </button>
              </div>
            </div>
            <div class="field-row">
              {#if statusLoading}
                <span class="status-indicator"><Hourglass size={14} strokeWidth={1.5} /></span>
                <span class="status-text">Verificando...</span>
              {:else}
                {@const badge = statusBadge(serviceStatus['telegram-bot']?.status)}
                <span class="status-badge {badge.class}">{badge.text}</span>
                {#if serviceStatus['telegram-bot']?.pid}
                  <span class="status-detail">PID {serviceStatus['telegram-bot'].pid} · {serviceStatus['telegram-bot'].uptime}</span>
                {/if}
              {/if}
              <a href="https://t.me/BotFather" target="_blank" rel="noopener" class="field-link">@BotFather</a>
            </div>
            <button class="test-btn" on:click={() => handleTestConnection('telegram')} disabled={testLoading['telegram']}>
              {#if testLoading['telegram']}<Hourglass size={14} strokeWidth={1.5} /> Testando...{:else}<Plug size={14} strokeWidth={1.5} /> Testar Conexao{/if}
            </button>
            {#if testResults['telegram']}
              <div class="test-result {testResults['telegram'].ok ? 'test-success' : 'test-error'}">
                {#if testResults['telegram'].ok}<CheckCircle2 size={14} strokeWidth={1.5} /> {testResults['telegram'].bot?.username || 'Conectado'}{:else}<XCircle size={14} strokeWidth={1.5} /> {testResults['telegram'].error || 'Falha'}{/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Dashboard -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('dashboard')}>
          <span><BarChart3 size={16} strokeWidth={1.5} /> Dashboard NEXO PRO</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'dashboard'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'dashboard'}
          <div class="section-body" transition:slideExpand>
            <div class="field">
              <label class="field-label" for="api-token">INTERNAL_API_TOKEN</label>
              <div class="password-field">
                {#if showPasswordApi}
                  <input id="api-token" type="text" class="field-input" bind:value={localConfig.INTERNAL_API_TOKEN} placeholder="Token da API interna" />
                {:else}
                  <input id="api-token" type="password" class="field-input" bind:value={localConfig.INTERNAL_API_TOKEN} placeholder="Token da API interna" />
                {/if}
                <button class="toggle-password" on:click={() => showPasswordApi = !showPasswordApi}>
                  {#if showPasswordApi}<EyeOff size={16} strokeWidth={1.5} />{:else}<Eye size={16} strokeWidth={1.5} />{/if}
                </button>
              </div>
            </div>
            <div class="field-row">
              {#if statusLoading}
                <span class="status-indicator"><Hourglass size={14} strokeWidth={1.5} /></span>
                <span class="status-text">Verificando...</span>
              {:else}
                {@const badge = statusBadge(serviceStatus['nexo-dashboard']?.status)}
                <span class="status-badge {badge.class}">{badge.text}</span>
                {#if serviceStatus['nexo-dashboard']?.port}
                  <span class="status-detail">Porta {serviceStatus['nexo-dashboard'].port}</span>
                {/if}
              {/if}
            </div>
            <button class="test-btn" on:click={() => handleTestConnection('dashboard')} disabled={testLoading['dashboard']}>
              {#if testLoading['dashboard']}<Hourglass size={14} strokeWidth={1.5} /> Testando...{:else}<Plug size={14} strokeWidth={1.5} /> Testar Token{/if}
            </button>
            {#if testResults['dashboard']}
              <div class="test-result {testResults['dashboard'].ok ? 'test-success' : 'test-error'}">
                {#if testResults['dashboard'].ok}<CheckCircle2 size={14} strokeWidth={1.5} /> Token válido{:else}<XCircle size={14} strokeWidth={1.5} /> {testResults['dashboard'].error || 'Token inválido'}{/if}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Kimi Bridge -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('kimi')}>
          <span>Kimi Bridge</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'kimi'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'kimi'}
          <div class="section-body" transition:slideExpand>
            <div class="field">
              <label class="field-label" for="kimi-timeout">KIMI_TIMEOUT (ms)</label>
              <input id="kimi-timeout" type="number" class="field-input" bind:value={localConfig.KIMI_TIMEOUT} placeholder="120000" />
            </div>
            <div class="field">
              <label class="field-label" for="kimi-pages">KIMI_MAX_PAGES</label>
              <input id="kimi-pages" type="number" class="field-input" bind:value={localConfig.KIMI_MAX_PAGES} placeholder="5" />
            </div>
            <div class="field">
              <label class="field-label" for="kimi-idle">KIMI_IDLE_TIMEOUT (ms)</label>
              <input id="kimi-idle" type="number" class="field-input" bind:value={localConfig.KIMI_IDLE_TIMEOUT} placeholder="600000" />
            </div>
            <div class="field">
              <label class="field-label" for="kimi-cooldown">KIMI_COOLDOWN_MS (ms)</label>
              <input id="kimi-cooldown" type="number" class="field-input" bind:value={localConfig.KIMI_COOLDOWN_MS} placeholder="5000" />
            </div>
            <div class="field-row">
              {#if statusLoading}
                <span class="status-indicator"><Hourglass size={14} strokeWidth={1.5} /></span>
                <span class="status-text">Verificando...</span>
              {:else}
                {@const badge = statusBadge(serviceStatus['kimi-bridge']?.status)}
                <span class="status-badge {badge.class}">{badge.text}</span>
                {#if serviceStatus['kimi-bridge']?.pages !== undefined}
                  <span class="status-detail">{serviceStatus['kimi-bridge'].pages} paginas · {serviceStatus['kimi-bridge'].contexts} contexts</span>
                {/if}
              {/if}
            </div>
            <button class="test-btn" on:click={() => handleTestConnection('kimi')} disabled={testLoading['kimi']}>
              {testLoading['kimi'] ? 'Testando...' : 'Testar Chrome'}
            </button>
            {#if testResults['kimi']}
              <div class="test-result {testResults['kimi'].ok ? 'test-success' : 'test-error'}">
                {testResults['kimi'].ok ? 'Chrome conectado (' + (testResults['kimi'].pages || 0) + ' paginas)' : (testResults['kimi'].error || 'Desconectado')}
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <!-- Advanced -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('advanced')}>
          <span>Avancado</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'advanced'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'advanced'}
          <div class="section-body" transition:slideExpand>
            <div class="field">
              <label class="field-label" for="compact-threshold">LUNA_COMPACT_THRESHOLD</label>
              <input id="compact-threshold" type="number" class="field-input" bind:value={localConfig.LUNA_COMPACT_THRESHOLD} placeholder="24" />
            </div>
            <div class="field">
              <label class="field-label" for="chrome-path">LUNA_CHROME_PATH</label>
              <input id="chrome-path" type="text" class="field-input" bind:value={localConfig.LUNA_CHROME_PATH} placeholder="/usr/bin/google-chrome" />
            </div>
            <div class="field">
              <label class="field-label" for="jwt-secret">JWT_SECRET</label>
              <div class="password-field">
                {#if showPasswordJwt}
                  <input id="jwt-secret" type="text" class="field-input" bind:value={localConfig.JWT_SECRET} placeholder="Chave secreta para tokens JWT" />
                {:else}
                  <input id="jwt-secret" type="password" class="field-input" bind:value={localConfig.JWT_SECRET} placeholder="Chave secreta para tokens JWT" />
                {/if}
                <button class="toggle-password" on:click={() => showPasswordJwt = !showPasswordJwt}>
                  {#if showPasswordJwt}<EyeOff size={16} strokeWidth={1.5} />{:else}<Eye size={16} strokeWidth={1.5} />{/if}
                </button>
              </div>
            </div>
            <div class="field">
              <label class="field-label" for="config-port">LUNA_CONFIG_PORT</label>
              <input id="config-port" type="number" class="field-input" bind:value={localConfig.LUNA_CONFIG_PORT} placeholder="3458" />
            </div>
            <div class="field checkbox-field">
              <label class="checkbox-label">
                <input type="checkbox" bind:checked={localConfig.LUNA_DEBUG} />
                <span>Modo Debug</span>
              </label>
            </div>
          </div>
        {/if}
      </div>

      <!-- System Prompt -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('prompt')}>
          <span>System Prompt</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'prompt'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'prompt'}
          <div class="section-body" transition:slideExpand>
            <div class="prompt-warning">
              <span><AlertTriangle size={16} /></span>
              <span>Alterar o system prompt pode afetar o comportamento da Luna.</span>
            </div>
            <textarea class="prompt-textarea" rows="20" value={systemPromptValue} on:input={handleSystemPromptChange} placeholder="Digite o system prompt aqui..." />
            <div class="prompt-stats">
              {charCount.toLocaleString()} caracteres, {lineCount} linhas
            </div>
            <div class="prompt-actions">
              <button class="btn-secondary" on:click={handleResetPrompt}>Reset Original</button>
              <button class="btn-primary" on:click={handleSave}>Salvar</button>
            </div>
          </div>
        {/if}
      </div>

      <!-- Self-Host -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('selfhost')}>
          <span>Self-Host Local</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'selfhost'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'selfhost'}
          <div class="section-body" transition:slideExpand>
            <div class="selfhost-info">
              <p>Baixe a Luna completa para rodar no seu PC.</p>
              <p>O pacote inclui:</p>
              <ul>
                <li>Todos os arquivos do kernel (sem precisar de Git)</li>
                <li>.env pre-configurado com seus tokens</li>
                <li>Web interface + Telegram bot</li>
                <li>Kimi Bridge com Chrome</li>
                <li>README com tutorial completo</li>
              </ul>
              <p style="margin-top:12px; color: var(--luna-primary);">Compartilhe com a familia:</p>
              <p>Copie o <code>luna-selfhost.zip</code> para o PC do seu pai/mae/irmao. Ele so precisa descompactar, rodar <code>npm install</code> e <code>node luna-server.js</code>. Todos usam a mesma conta!</p>
            </div>
            <button class="btn-primary btn-wide" on:click={handleDownloadSelfHost} disabled={downloadLoading}>
              {downloadLoading ? 'Gerando pacote...' : 'Baixar Luna Local'}
            </button>
            <div class="selfhost-note">
              Requer: Node.js v20+, Google Chrome (Git opcional)
            </div>
          </div>
        {/if}
      </div>

      <!-- Tutorial -->
      <div class="section">
        <button class="section-header" on:click={() => setSection('tutorial')}>
          <span>Tutorial</span>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class:rotated={activeSection === 'tutorial'}>
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </button>
        {#if activeSection === 'tutorial'}
          <div class="section-body" transition:slideExpand>
            <div class="tutorial-content">
              <h4>Bem-vindo a Luna Web!</h4>
              <p>A Luna e um agente autonomo que pode:</p>
              <ul>
                <li>Criar e editar arquivos</li>
                <li>Executar comandos no terminal</li>
                <li>Pesquisar na web</li>
                <li>Gerenciar tarefas no dashboard</li>
                <li>Analisar repositorios Git</li>
              </ul>
              <h4>Atalhos do teclado</h4>
              <ul>
                <li><kbd>Ctrl+K</kbd> — Nova sessao</li>
                <li><kbd>Enter</kbd> — Enviar mensagem</li>
                <li><kbd>Shift+Enter</kbd> — Nova linha</li>
                <li><kbd>Esc</kbd> — Cancelar/Close</li>
              </ul>
              <h4>Modos de resposta</h4>
              <p><strong>thinking</strong> — A Luna pensa antes de responder (mais preciso)</p>
              <p><strong>instant</strong> — Resposta rapida sem thinking <span class="badge-recommended">Recomendado</span></p>
              <h4>Self-Host e Compartilhamento</h4>
              <p>Va em <strong>Configuracoes → Self-Host Local</strong> para baixar a Luna completa e rodar no seu PC.</p>
              <p><strong>Compartilhar com a familia:</strong> Baixe o pacote, copie o ZIP para outro PC, descompacte, rode <code>npm install</code> e <code>node luna-server.js</code>. Pronto — todos usam a mesma conta e tokens!</p>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Footer Actions -->
    <div class="drawer-footer">
      <input type="file" accept=".env" bind:this={importInputEl} on:change={processImport} class="hidden-input" />
      <div class="footer-row">
        <button class="btn-secondary btn-small" on:click={handleExportEnv}>Exportar .env</button>
        <button class="btn-secondary btn-small" on:click={handleImportEnv}>Importar .env</button>
      </div>
      <button class="btn-danger" on:click={handleRestart}>Reiniciar Luna</button>
    </div>
  </aside>
{/if}

<!-- Confirmation Dialog -->
{#if confirmDialog}
  <div class="confirm-overlay" transition:fade={{ duration: 150 }}>
    <div class="confirm-dialog" transition:fly={{ y: 20, duration: 200 }}>
      <h3 class="confirm-title">{confirmDialog.title}</h3>
      <p class="confirm-message">{confirmDialog.message}</p>
      <div class="confirm-actions">
        <button class="btn-secondary" on:click={() => confirmDialog = null}>Cancelar</button>
        <button class="btn-danger" on:click={confirmDialog.action}>Confirmar</button>
      </div>
    </div>
  </div>
{/if}

<script context="module">
  function slideExpand(node, params) {
    return {
      duration: 200,
      css: t => `max-height: ${t * 2000}px; opacity: ${t}; overflow: hidden;`
    };
  }
</script>

<style>
  .drawer-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 40;
  }
  .config-drawer {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    width: 460px;
    max-width: 100vw;
    background: var(--luna-elevated);
    border-left: 1px solid var(--luna-border);
    z-index: 50;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  .drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 16px 20px;
    border-bottom: 1px solid var(--luna-border);
    flex-shrink: 0;
  }
  .drawer-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--luna-text);
    margin: 0;
  }
  .close-btn {
    background: none;
    border: none;
    color: var(--luna-text-secondary);
    cursor: pointer;
    padding: 6px;
    border-radius: 8px;
    transition: all 0.15s;
    display: flex;
    align-items: center;
    justify-content: center;
    min-width: 36px;
    min-height: 36px;
  }
  .close-btn:hover {
    color: var(--luna-text);
    background: rgba(255,255,255,0.06);
  }
  .drawer-content {
    flex: 1;
    overflow-y: auto;
    padding: 8px 0;
  }
  .section {
    border-bottom: 1px solid var(--luna-border);
  }
  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 14px 20px;
    background: none;
    border: none;
    color: var(--luna-text);
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s;
    text-align: left;
  }
  .section-header:hover {
    background: rgba(255,255,255,0.02);
  }
  .section-header svg {
    transition: transform 0.2s;
    opacity: 0.5;
  }
  .section-header svg.rotated {
    transform: rotate(180deg);
  }
  .section-body {
    padding: 0 20px 16px;
  }
  .field {
    margin-bottom: 12px;
  }
  .field-label {
    display: block;
    font-size: 12px;
    color: var(--luna-text-secondary);
    margin-bottom: 4px;
    font-weight: 500;
  }
  .field-input {
    width: 100%;
    padding: 10px 12px;
    background: var(--luna-surface);
    border: 1px solid var(--luna-border);
    border-radius: 8px;
    color: var(--luna-text);
    font-size: 14px;
    font-family: 'JetBrains Mono', monospace;
    outline: none;
    transition: border-color 0.2s;
  }
  .field-input:focus {
    border-color: var(--luna-primary);
  }
  .field-input::placeholder {
    color: var(--luna-text-secondary);
    opacity: 0.4;
  }
  .password-field {
    position: relative;
    display: flex;
    align-items: center;
  }
  .password-field .field-input {
    padding-right: 40px;
  }
  .toggle-password {
    position: absolute;
    right: 8px;
    background: none;
    border: none;
    cursor: pointer;
    font-size: 16px;
    padding: 4px;
    opacity: 0.6;
    transition: opacity 0.15s;
  }
  .toggle-password:hover {
    opacity: 1;
  }
  .field-row {
    display: flex;
    align-items: center;
    gap: 8px;
    font-size: 13px;
    padding: 4px 0;
    flex-wrap: wrap;
  }
  .status-indicator {
    font-size: 14px;
  }
  .status-text {
    color: var(--luna-text-secondary);
  }
  .status-badge {
    padding: 2px 8px;
    border-radius: 10px;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge-online {
    background: rgba(34, 197, 94, 0.15);
    color: #4ade80;
  }
  .badge-offline {
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }
  .badge-unknown {
    background: rgba(156, 163, 175, 0.15);
    color: #9ca3af;
  }
  .status-detail {
    color: var(--luna-text-secondary);
    font-size: 12px;
    font-family: 'JetBrains Mono', monospace;
  }
  .field-link {
    color: var(--luna-primary);
    text-decoration: none;
    margin-left: auto;
    font-size: 12px;
  }
  .field-link:hover {
    text-decoration: underline;
  }
  .checkbox-field {
    padding: 4px 0;
  }
  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 10px;
    cursor: pointer;
    font-size: 14px;
    color: var(--luna-text);
  }
  .checkbox-label input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--luna-primary);
    cursor: pointer;
  }
  .test-btn {
    padding: 8px 16px;
    background: var(--luna-surface);
    border: 1px solid var(--luna-border);
    border-radius: 8px;
    color: var(--luna-text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    font-weight: 500;
    margin-top: 8px;
  }
  .test-btn:hover {
    background: var(--luna-elevated);
    border-color: rgba(255,255,255,0.1);
  }
  .test-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .test-result {
    margin-top: 8px;
    padding: 8px 12px;
    border-radius: 8px;
    font-size: 13px;
    font-weight: 500;
  }
  .test-success {
    background: rgba(34, 197, 94, 0.1);
    color: #4ade80;
    border: 1px solid rgba(34, 197, 94, 0.2);
  }
  .test-error {
    background: rgba(239, 68, 68, 0.1);
    color: #f87171;
    border: 1px solid rgba(239, 68, 68, 0.2);
  }
  .prompt-warning {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 10px 12px;
    background: rgba(234, 179, 8, 0.1);
    border: 1px solid rgba(234, 179, 8, 0.2);
    border-radius: 8px;
    font-size: 12px;
    color: #fde68a;
    margin-bottom: 12px;
  }
  .prompt-textarea {
    width: 100%;
    min-height: 300px;
    padding: 12px;
    background: var(--luna-surface);
    border: 1px solid var(--luna-border);
    border-radius: 8px;
    color: var(--luna-text);
    font-size: 13px;
    font-family: 'JetBrains Mono', monospace;
    line-height: 1.6;
    outline: none;
    resize: vertical;
    transition: border-color 0.2s;
  }
  .prompt-textarea:focus {
    border-color: var(--luna-primary);
  }
  .prompt-stats {
    font-size: 12px;
    color: var(--luna-text-secondary);
    margin-top: 8px;
    font-family: 'JetBrains Mono', monospace;
  }
  .prompt-actions {
    display: flex;
    gap: 8px;
    margin-top: 12px;
  }
  .selfhost-info {
    font-size: 13px;
    color: var(--luna-text);
    line-height: 1.7;
    margin-bottom: 16px;
  }
  .selfhost-info p {
    margin: 0 0 8px;
  }
  .selfhost-info ul {
    margin: 0 0 12px 20px;
    color: var(--luna-text-secondary);
  }
  .selfhost-info li {
    margin-bottom: 4px;
  }
  .selfhost-note {
    margin-top: 12px;
    font-size: 12px;
    color: var(--luna-text-secondary);
    text-align: center;
  }
  .tutorial-content {
    font-size: 13px;
    line-height: 1.7;
    color: var(--luna-text);
  }
  .tutorial-content h4 {
    font-size: 14px;
    font-weight: 600;
    margin: 16px 0 8px;
    color: var(--luna-primary);
  }
  .tutorial-content ul {
    margin: 8px 0 8px 20px;
  }
  .tutorial-content li {
    margin-bottom: 4px;
  }
  .tutorial-content kbd {
    background: var(--luna-surface);
    border: 1px solid var(--luna-border);
    border-radius: 4px;
    padding: 2px 6px;
    font-family: 'JetBrains Mono', monospace;
    font-size: 12px;
  }
  .drawer-footer {
    padding: 16px 20px;
    border-top: 1px solid var(--luna-border);
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .footer-row {
    display: flex;
    gap: 8px;
  }
  .hidden-input {
    position: absolute;
    width: 0;
    height: 0;
    opacity: 0;
    pointer-events: none;
  }
  .btn-primary {
    padding: 10px 20px;
    background: var(--luna-primary);
    border: none;
    border-radius: 8px;
    color: white;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
  }
  .btn-primary:hover {
    background: var(--luna-primary-hover);
  }
  .btn-primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .btn-primary.btn-wide {
    width: 100%;
    text-align: center;
  }
  .btn-secondary {
    padding: 10px 16px;
    background: var(--luna-surface);
    border: 1px solid var(--luna-border);
    border-radius: 8px;
    color: var(--luna-text);
    font-size: 13px;
    cursor: pointer;
    transition: all 0.15s;
    font-weight: 500;
  }
  .btn-secondary:hover {
    background: var(--luna-elevated);
    border-color: rgba(255,255,255,0.1);
  }
  .btn-secondary.btn-small {
    padding: 8px 12px;
    font-size: 12px;
    flex: 1;
  }
  .btn-danger {
    padding: 10px 16px;
    background: rgba(239, 68, 68, 0.15);
    border: 1px solid rgba(239, 68, 68, 0.3);
    border-radius: 8px;
    color: #fca5a5;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s;
    width: 100%;
  }
  .btn-danger:hover {
    background: rgba(239, 68, 68, 0.25);
  }
  .confirm-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    z-index: 60;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .confirm-dialog {
    background: var(--luna-elevated);
    border: 1px solid var(--luna-border);
    border-radius: 12px;
    padding: 24px;
    max-width: 400px;
    width: 100%;
  }
  .confirm-title {
    font-size: 16px;
    font-weight: 600;
    color: var(--luna-text);
    margin: 0 0 8px;
  }
  .confirm-message {
    font-size: 14px;
    color: var(--luna-text-secondary);
    margin: 0 0 20px;
    line-height: 1.5;
  }
  .confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
  }
  .badge-recommended {
    display: inline-flex;
    align-items: center;
    padding: 1px 6px;
    background: linear-gradient(135deg, #10b981, #059669);
    color: #fff;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    border-radius: 999px;
    white-space: nowrap;
    box-shadow: 0 0 8px rgba(16,185,129,0.35);
    animation: pulse-badge 2s ease-in-out infinite;
    margin-left: 4px;
    vertical-align: middle;
  }
  @keyframes pulse-badge {
    0%, 100% { box-shadow: 0 0 6px rgba(16,185,129,0.3); }
    50% { box-shadow: 0 0 12px rgba(16,185,129,0.6); }
  }
  @media (max-width: 768px) {
    .config-drawer {
      width: 100vw;
      left: 0;
    }
  }
</style>
