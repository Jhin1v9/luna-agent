#!/usr/bin/env node
/**
 * Luna CLI v3.0 — Interface Primária
 * Terminal-native AI assistant powered by Kimi Web
 * Interface inspirada em Kimi CLI / Claude Code
 */

const fs = require('fs');
const path = require('path');
const readline = require('readline');
const os = require('os');

// Try chalk, fallback to ANSI
let chalk;
try { chalk = require('chalk'); } catch {
  chalk = {
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    blue: (s) => `\x1b[34m${s}\x1b[0m`,
    cyan: (s) => `\x1b[36m${s}\x1b[0m`,
    gray: (s) => `\x1b[90m${s}\x1b[0m`,
    magenta: (s) => `\x1b[35m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
    white: (s) => s,
    dim: (s) => `\x1b[2m${s}\x1b[0m`,
  };
}

const { LunaSoul } = require('./luna-soul.cjs');
const { SessionManager } = require('./session-manager.cjs');
const lunaConfig = require('./config/luna-config');

const VERSION = '3.0.0';
const LUNA_DIR = lunaConfig.LUNA_DIR;

// ──── UI RENDERING ────

function clearScreen() {
  process.stdout.write('\x1Bc');
}

function printHeader(session) {
  const id = session?.id?.slice(0, 8) || '????';
  const title = session?.title || 'Nova sessão';
  const mode = session?.mode || 'thinking';
  const persona = session?.persona || 'default';
  const msgs = session?.messageCount || 0;

  console.log(chalk.cyan(`┌────────────────────────────────────────────────────────────┐`));
  console.log(chalk.cyan(`│`) + `  🌙 ${chalk.bold('Luna')} v${VERSION}  ${chalk.gray('│')}  ${chalk.bold(title)}`);
  console.log(chalk.cyan(`│`) + `  ${chalk.gray(`Sessão: ${id} │ ${msgs} msgs │ ${persona} │ ${mode}`)}`);
  console.log(chalk.cyan(`└────────────────────────────────────────────────────────────┘`));
  console.log();
}

function printInputBar() {
  console.log(chalk.gray('──────────────────────── INPUT ──────────────────────────────'));
  process.stdout.write(chalk.cyan('❯ ') + chalk.white(''));
}

function renderMessage(ev, isLast = false) {
  if (ev.type === 'user') {
    const content = ev.content || '';
    // Wrap content to fit terminal
    const lines = wrapText(content, 56);
    console.log(chalk.blue('┌─── ' + chalk.bold('Você')));
    lines.forEach(l => console.log(chalk.blue('│ ') + l));
    console.log(chalk.blue('└────────────────────────────────────────────────────────────'));
  } else if (ev.type === 'assistant') {
    const content = ev.response || ev.content || '';
    const lines = wrapText(content, 56);
    console.log(chalk.magenta('┌─── ') + chalk.bold('Luna') + (ev.mode ? chalk.gray(` [${ev.mode}]`) : ''));
    lines.forEach(l => console.log(chalk.magenta('│ ') + l));
    console.log(chalk.magenta('└────────────────────────────────────────────────────────────'));
  } else if (ev.type === 'tool_call') {
    const tool = ev.tool || ev.action?.type || 'tool';
    const params = JSON.stringify(ev.params || ev.action?.params || {});
    console.log(chalk.yellow('┌─── ') + chalk.bold(`🔧 ${tool}`));
    console.log(chalk.yellow('│ ') + chalk.dim(params.slice(0, 120)));
    console.log(chalk.yellow('└────────────────────────────────────────────────────────────'));
  } else if (ev.type === 'tool_result') {
    const ok = ev.success !== false;
    const output = (ev.output || ev.stdout || '').slice(0, 200);
    const icon = ok ? chalk.green('✅') : chalk.red('❌');
    console.log(chalk.gray(`  ${icon} ${output}`));
  }
}

function wrapText(text, width) {
  const words = String(text).split(' ');
  const lines = [];
  let current = '';
  for (const word of words) {
    if ((current + word).length > width) {
      lines.push(current.trim());
      current = word + ' ';
    } else {
      current += word + ' ';
    }
  }
  if (current.trim()) lines.push(current.trim());
  return lines.length ? lines : [''];
}

function renderStatus(msg) {
  process.stdout.write('\r' + chalk.gray('  ' + msg) + '\n');
}

// ──── INTERACTIVE CHAT MODE ────

async function chatMode(luna, sessionManager, session) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: true,
  });

  let currentSession = session;
  let isProcessing = false;

  function refreshUI() {
    clearScreen();
    printHeader(currentSession);

    // Render chat history
    const events = sessionManager.readContext(currentSession.id);
    for (let i = 0; i < events.length; i++) {
      renderMessage(events[i], i === events.length - 1);
    }

    console.log();
    printInputBar();
  }

  // Initial render
  refreshUI();

  // Handle events from LunaSoul
  luna.on('progress', (ev) => {
    if (ev.type === 'response') return;
    if (ev.type === 'thinking') {
      process.stdout.write('\r' + chalk.yellow('🧠 ') + chalk.gray(ev.message));
    } else if (ev.type === 'action') {
      process.stdout.write('\n');
      console.log(chalk.yellow('🔧 ') + chalk.bold(ev.tool) + chalk.gray(` ${JSON.stringify(ev.params || {}).slice(0, 80)}`));
    } else if (ev.type === 'success') {
      console.log(chalk.green('✅ ') + chalk.gray(ev.message));
    } else if (ev.type === 'error') {
      console.log(chalk.red('❌ ') + ev.message);
    } else if (ev.type === 'plan') {
      console.log(chalk.cyan('📋 ') + chalk.bold(ev.message));
      if (ev.steps) {
        ev.steps.forEach((s, i) => {
          console.log(`  ${s.done ? chalk.green('☑') : chalk.gray('☐')} ${i+1}. ${s.tool}`);
        });
      }
    } else if (ev.type === 'meta') {
      console.log(chalk.magenta('🔮 ') + chalk.bold(ev.message));
    } else if (ev.type === 'meta_success') {
      console.log(chalk.green('🔮 ✅ ') + ev.message);
    } else if (ev.type === 'meta_error') {
      console.log(chalk.red('🔮 ❌ ') + ev.message);
    } else if (ev.type === 'suggest') {
      process.stdout.write('\n');
      const icon = ev.autoApproved ? chalk.green('⚡') : chalk.yellow('💡');
      const autoText = ev.autoApproved ? chalk.gray('(auto-aprovado)') : chalk.gray('(confirmação necessária)');
      console.log(`${icon} ${chalk.bold('Sugestão Luna:')} ${autoText}`);
      console.log(`  ${chalk.cyan('→')} Tipo: ${ev.suggestionType}`);
      console.log(`  ${chalk.cyan('→')} Alvo: ${chalk.bold(ev.target)}`);
      console.log(`  ${chalk.cyan('→')} Motivo: ${chalk.gray(ev.reason)}`);
      console.log(`  ${chalk.cyan('→')} Confiança: ${chalk.gray(Math.round((ev.confidence || 0) * 100) + '%')}`);
      if (!ev.autoApproved) {
        console.log(chalk.dim('  Digite /sim para confirmar ou /nao para rejeitar'));
      }
    } else if (ev.type === 'persona_switched') {
      console.log(chalk.green('🎭 ') + chalk.bold(ev.message));
      if (ev.reason) console.log(chalk.gray('  Motivo: ' + ev.reason));
    } else if (ev.type === 'skill_suggested') {
      console.log(chalk.blue('📚 ') + chalk.bold(ev.message));
      if (ev.reason) console.log(chalk.gray('  Motivo: ' + ev.reason));
    }
  });

  luna.on('response', (ev) => {
    if (!ev.content) return;
    // Show response
    process.stdout.write('\n');
    const lines = wrapText(ev.content, 56);
    console.log(chalk.magenta('┌─── ') + chalk.bold('Luna'));
    lines.forEach(l => console.log(chalk.magenta('│ ') + l));
    console.log(chalk.magenta('└────────────────────────────────────────────────────────────'));
    isProcessing = false;
    printInputBar();
  });

  const ask = () => {
    if (isProcessing) return;
    rl.question('', async (input) => {
      const trimmed = input.trim();
      if (!trimmed) { printInputBar(); ask(); return; }

      // Inline commands
      if (trimmed === '/sair' || trimmed === '/exit') {
        console.log(chalk.gray(`\n💾 Sessão ${currentSession.id.slice(0,8)} salva.`));
        console.log(chalk.cyan('👋 Até logo, Abner.\n'));
        rl.close();
        await luna.disconnect();
        process.exit(0);
      }

      if (trimmed === '/help') {
        console.log(chalk.bold('\nComandos:'));
        console.log('  /sair    Encerra');
        console.log('  /novo    Nova sessão');
        console.log('  /limpar  Limpa contexto');
        console.log('  /modo    Muda modo/persona');
        console.log('  /skills  Lista skills carregáveis');
        console.log('  /auto    Toggle auto-switch persona/skill');
        console.log('  /sim     Confirma sugestão pendente');
        console.log('  /nao     Rejeita sugestão pendente');
        console.log('  /status  Status');
        console.log('  /yolo    Toggle YOLO');
        console.log('');
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/skills') {
        const skillDir = path.join(LUNA_DIR, 'skills');
        const skills = fs.existsSync(skillDir) ? fs.readdirSync(skillDir).filter(d => {
          const p = path.join(skillDir, d, 'SKILL.md');
          return fs.existsSync(p);
        }) : [];
        console.log(chalk.bold('\n📚 Skills disponíveis:'));
        console.log(chalk.gray('─'.repeat(60)));
        skills.forEach((s, i) => console.log(`  ${chalk.cyan(i + 1 + '.')} ${s}`));
        console.log();
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/novo') {
        currentSession = sessionManager.createSession({ title: 'Nova sessão' });
        refreshUI();
        ask();
        return;
      }

      if (trimmed === '/limpar') {
        sessionManager.clearContext(currentSession.id);
        refreshUI();
        ask();
        return;
      }

      if (trimmed.startsWith('/modo ')) {
        const m = trimmed.split(' ')[1];
        if (m === 'instant' || m === 'thinking') {
          currentSession.mode = m;
          const statePath = path.join(LUNA_DIR, 'sessions', currentSession.id, 'state.json');
          try {
            const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
            s.mode = m;
            fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
          } catch {}
          console.log(chalk.gray(`Modo: ${currentSession.mode}\n`));
        } else {
          // Change persona
          const personaPath = path.join(LUNA_DIR, 'personas', `${m}.md`);
          if (fs.existsSync(personaPath)) {
            currentSession.persona = m;
            const statePath = path.join(LUNA_DIR, 'sessions', currentSession.id, 'state.json');
            try {
              const s = JSON.parse(fs.readFileSync(statePath, 'utf8'));
              s.persona = m;
              fs.writeFileSync(statePath, JSON.stringify(s, null, 2));
            } catch {}
            console.log(chalk.gray(`Persona: ${m}\n`));
          } else {
            console.log(chalk.red(`Persona "${m}" não encontrada.\n`));
          }
        }
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/modo') {
        // List available personas and modes
        const personaDir = path.join(LUNA_DIR, 'personas');
        const personas = fs.existsSync(personaDir)
          ? fs.readdirSync(personaDir).filter(f => f.endsWith('.md')).map(f => f.replace('.md', ''))
          : [];
        console.log(chalk.bold('\n🎭 Personas disponíveis:'));
        console.log(chalk.gray('─'.repeat(60)));
        personas.forEach((p, i) => {
          const active = p === (currentSession.persona || 'default') ? chalk.green(' ★') : '';
          console.log(`  ${chalk.cyan(i + 1 + '.')} ${p}${active}`);
        });
        console.log(chalk.gray('─'.repeat(60)));
        console.log(chalk.bold('Modos:') + ` instant | thinking  (${chalk.gray('atual: ' + (currentSession.mode || 'thinking'))})`);
        console.log(chalk.gray('Use: /modo <persona>  ou  /modo instant/thinking'));
        console.log();
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/status') {
        try {
          const st = await luna.kimiBridge?.getStatus?.('luna-cli') || { active: false };
          console.log(chalk.gray(`Kimi: ${st.active ? chalk.green('✅') : chalk.red('❌')} │ Sessão: ${currentSession.id.slice(0,8)} │ Msgs: ${currentSession.messageCount || 0}`));
        } catch {
          console.log(chalk.gray('Status indisponível'));
        }
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/yolo') {
        currentSession.yoloMode = !currentSession.yoloMode;
        console.log(chalk.yellow(`YOLO: ${currentSession.yoloMode ? 'ON' : 'OFF'}\n`));
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/auto') {
        luna.autoSwitchEnabled = !luna.autoSwitchEnabled;
        console.log(chalk.cyan(`🤖 Auto-switch: ${luna.autoSwitchEnabled ? chalk.green('ON') : chalk.red('OFF')}\n`));
        printInputBar(); ask();
        return;
      }

      // Handle suggestion confirmations
      if (trimmed === '/sim' || trimmed === '/yes') {
        if (currentSession.pendingSuggestion) {
          const s = currentSession.pendingSuggestion;
          const result = await luna.applySuggestion(currentSession.id, s.type, s.target);
          if (result.success) {
            console.log(chalk.green(`✅ ${s.type === 'persona' ? 'Persona' : 'Skill'} "${s.target}" ativada.`));
          } else {
            console.log(chalk.red(`❌ ${result.error}`));
          }
          currentSession.pendingSuggestion = null;
        } else {
          console.log(chalk.gray('Nenhuma sugestão pendente.\n'));
        }
        printInputBar(); ask();
        return;
      }

      if (trimmed === '/nao' || trimmed === '/no') {
        if (currentSession.pendingSuggestion) {
          console.log(chalk.gray(`❌ Sugestão rejeitada: ${currentSession.pendingSuggestion.target}\n`));
          currentSession.pendingSuggestion = null;
        } else {
          console.log(chalk.gray('Nenhuma sugestão pendente.\n'));
        }
        printInputBar(); ask();
        return;
      }

      // Show user message inline
      process.stdout.write('\n');
      const userLines = wrapText(trimmed, 56);
      console.log(chalk.blue('┌─── ' + chalk.bold('Você')));
      userLines.forEach(l => console.log(chalk.blue('│ ') + l));
      console.log(chalk.blue('└────────────────────────────────────────────────────────────'));
      console.log();
      isProcessing = true;
      process.stdout.write(chalk.yellow('🧠 ') + chalk.gray('Pensando...'));

      try {
        const result = await luna.processMessage(trimmed, {
          sessionId: currentSession.id,
          mode: currentSession.mode,
          persona: currentSession.persona,
          userId: 'luna-cli',
        });

        // If ACTION needs continue, handle it
        if (result.needsContinue) {
          let cont = result;
          let safety = 0;
          while (cont.needsContinue && safety < 15) {
            safety++;
            cont = await luna.continueLoop(currentSession.id, {
              mode: currentSession.mode,
              userId: 'luna-cli',
            });
            if (cont.mode === 'CHAT' || cont.mode === 'DONE') {
              if (cont.response || cont.message) {
                process.stdout.write('\n');
                const lines = wrapText(cont.response || cont.message, 56);
                console.log(chalk.magenta('┌─── ') + chalk.bold('Luna'));
                lines.forEach(l => console.log(chalk.magenta('│ ') + l));
                console.log(chalk.magenta('└────────────────────────────────────────────────────────────'));
              }
              break;
            }
            if (!cont.success) {
              console.log(chalk.red('\n❌ ') + (cont.error || 'Erro'));
              break;
            }
          }
        }

        // For non-chat modes that don't emit response event
        if (result.mode === 'ACTION' && !result.needsContinue && result.result) {
          process.stdout.write('\n');
          console.log(chalk.gray('  ✅ Ação concluída'));
        }

        // Handle SUGGEST mode
        if (result.mode === 'SUGGEST') {
          if (result.needsConfirmation) {
            currentSession.pendingSuggestion = {
              type: result.type,
              target: result.target,
              reason: result.reason,
            };
          }
          if (result.applied) {
            // Auto-applied, refresh session
            currentSession = sessionManager.loadSession(currentSession.id) || currentSession;
          }
        }

        isProcessing = false;
        currentSession = sessionManager.loadSession(currentSession.id) || currentSession;
      } catch (err) {
        process.stdout.write('\n');
        console.log(chalk.red('❌ Erro: ') + err.message);
        isProcessing = false;
      }

      printInputBar();
      ask();
    });
  };

  ask();
}

// ──── SESSION PICKER ────

async function sessionPicker(sessionManager) {
  const sessions = sessionManager.listSessions();
  if (!sessions.length) {
    console.log(chalk.gray('Nenhuma sessão. Criando nova...\n'));
    return sessionManager.createSession({ title: 'Nova sessão' });
  }

  console.log(chalk.bold('\n📁 Sessões disponíveis:'));
  console.log(chalk.gray('─'.repeat(60)));
  sessions.forEach((s, i) => {
    const date = s.lastAccessedAt ? new Date(s.lastAccessedAt).toLocaleString('pt-BR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : 'N/A';
    const msgCount = s.messageCount || 0;
    console.log(`  ${chalk.cyan(i + 1 + '.')} ${chalk.white(s.title || 'Sem título')} ${chalk.gray(`(${msgCount} msgs · ${date})`)}`);
  });
  console.log(chalk.gray('─'.repeat(60)));
  console.log(chalk.gray('  0. Nova sessão'));
  console.log();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choice = await new Promise(resolve => {
    rl.question(chalk.cyan('Escolha uma sessão (número): '), ans => {
      resolve(ans.trim());
    });
  });
  rl.close();

  const num = parseInt(choice, 10);
  if (num === 0 || isNaN(num)) {
    return sessionManager.createSession({ title: 'Nova sessão' });
  }

  const selected = sessions[num - 1];
  if (!selected) {
    console.log(chalk.red('Sessão inválida. Criando nova...'));
    return sessionManager.createSession({ title: 'Nova sessão' });
  }

  return sessionManager.loadSession(selected.id);
}

// ──── MAIN ────

async function main() {
  const args = process.argv.slice(2);

  // Flags
  const hasFlag = (f) => args.includes(f);
  const getFlagValue = (f) => {
    const i = args.indexOf(f);
    return i >= 0 ? args[i + 1] : undefined;
  };

  if (hasFlag('--version') || hasFlag('-v')) {
    console.log(VERSION); process.exit(0);
  }

  if (hasFlag('--help') || hasFlag('-h')) {
    console.log(`
${chalk.bold('🌙 Luna CLI')} — Assistente pessoal via terminal

${chalk.bold('Uso:')}
  luna                    Inicia sessão interativa (nova ou atual)
  luna --sessions         Escolhe sessão existente
  luna --new, -n          Nova sessão
  luna --list, -l         Lista sessões
  luna --resume {id}      Resume sessão
  luna --export {id}      Exporta para markdown
  luna --delete {id}      Deleta sessão
  luna "pergunta"         One-shot
  luna -f img.png "..."   Com imagem
  luna --pc "tarefa"      Computer use

${chalk.bold('Comandos inline:')}
  /sair, /exit    Encerra
  /novo           Nova sessão
  /limpar         Limpa contexto
  /modo           Lista personas/modos
  /modo <nome>    Muda persona
  /modo instant   Modo instant
  /modo thinking  Modo thinking
  /skills         Lista skills
  /auto           Toggle auto-switch persona/skill
  /sim            Confirma sugestão pendente
  /nao            Rejeita sugestão pendente
  /status         Status
  /yolo           Toggle YOLO
  /help           Ajuda
`);
    process.exit(0);
  }

  const sessionManager = new SessionManager();

  if (hasFlag('--list') || hasFlag('-l')) {
    const sessions = sessionManager.listSessions();
    if (!sessions.length) {
      console.log(chalk.gray('Nenhuma sessão encontrada.'));
    } else {
      console.log(chalk.bold('\n📁 Sessões:'));
      console.log(chalk.gray('─'.repeat(60)));
      sessions.forEach((s, i) => {
        const date = s.lastAccessedAt ? new Date(s.lastAccessedAt).toLocaleString('pt-BR') : 'N/A';
        console.log(`  ${chalk.cyan(i + 1 + '.')} ${chalk.white(s.title)} ${chalk.gray(`(${s.messageCount || 0} msgs · ${date})`)}`);
      });
      console.log();
    }
    process.exit(0);
  }

  if (hasFlag('--delete') || hasFlag('-d')) {
    const id = getFlagValue('--delete') || getFlagValue('-d');
    if (id) { sessionManager.deleteSession(id); console.log(chalk.green('✅ Deletado.')); }
    process.exit(0);
  }

  if (hasFlag('--export') || hasFlag('-e')) {
    const id = getFlagValue('--export') || getFlagValue('-e');
    if (id) { const out = sessionManager.exportToMarkdown(id); console.log(chalk.green(`✅ Exportado: ${out}`)); }
    process.exit(0);
  }

  if (hasFlag('--rename')) {
    const id = getFlagValue('--rename');
    const titleIdx = args.indexOf('--rename') + 2;
    const title = args[titleIdx];
    if (id && title) { sessionManager.renameSession(id, title); console.log(chalk.green('✅ Renomeado.')); }
    process.exit(0);
  }

  // Determine session
  let session;
  if (hasFlag('--new') || hasFlag('-n')) {
    session = sessionManager.createSession({ title: 'Nova sessão' });
  } else if (hasFlag('--resume') || hasFlag('-r')) {
    const id = getFlagValue('--resume') || getFlagValue('-r');
    session = sessionManager.loadSession(id);
    if (!session) { console.log(chalk.red('Sessão não encontrada.')); process.exit(1); }
  } else if (hasFlag('--sessions')) {
    session = await sessionPicker(sessionManager);
  } else {
    // Default: get or create current session
    session = sessionManager.getOrCreateCurrentSession();
  }

  // Override mode
  if (hasFlag('--mode') || hasFlag('-m')) {
    const m = getFlagValue('--mode') || getFlagValue('-m');
    if (m) session.mode = m;
  }
  if (hasFlag('--thinking')) session.mode = 'thinking';
  if (hasFlag('--instant')) session.mode = 'instant';

  const luna = new LunaSoul({ defaultMode: session.mode });

  // Print banner only for non-interactive or on startup
  if (!hasFlag('--sessions')) {
    // Will be cleared by chatMode anyway
  }

  // Init Kimi Bridge
  try {
    await luna.init({ userId: 'luna-cli' });
  } catch (err) {
    console.log(chalk.red('❌ Kimi Web: ') + err.message);
    console.log(chalk.gray('Verifique se Chrome está rodando com --remote-debugging-port=9222\n'));
  }

  // One-shot
  const oneShot = args.find(a => !a.startsWith('-') && !['instant', 'thinking'].includes(a));
  if (oneShot) {
    console.log(chalk.gray(`One-shot: ${oneShot}\n`));
    try {
      await luna.processMessage(oneShot, {
        sessionId: session.id, mode: session.mode, userId: 'luna-cli',
      });
    } catch (err) {
      console.log(chalk.red('❌ ') + err.message);
    }
    await luna.disconnect();
    process.exit(0);
  }

  // Screenshot
  if (hasFlag('--screenshot')) {
    try {
      const r = await luna.engine.executeSingle({ type: 'screenshot' });
      console.log(r.success ? chalk.green('📸 ' + r.screenshot) : chalk.red('❌ Falha'));
    } catch (err) { console.log(chalk.red('❌ ') + err.message); }
    await luna.disconnect();
    process.exit(0);
  }

  // Interactive chat mode
  await chatMode(luna, sessionManager, session);
}

main().catch(err => {
  console.error(chalk.red('Erro fatal:'), err.message);
  process.exit(1);
});
