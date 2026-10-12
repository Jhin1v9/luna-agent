/**
 * brain-loader.cjs
 * Carrega o conteúdo do .brain-luna como contexto para o system prompt.
 * Path padrão: ${HOME}/Documentos/.brain-luna-v10.16
 * Pode ser sobrescrito via env BRAIN_PATH.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

const DEFAULT_BRAIN_PATH = process.env.BRAIN_PATH || path.join(os.homedir(), 'Documentos', '.brain-luna-v10.16');

function exists(p) {
  try { return fs.existsSync(p); } catch { return false; }
}

function readFile(p, maxBytes = 50000) {
  try {
    if (!fs.existsSync(p)) return '';
    const content = fs.readFileSync(p, 'utf8');
    if (Buffer.byteLength(content, 'utf8') > maxBytes) {
      return content.slice(0, maxBytes) + '\n\n...[truncated]...';
    }
    return content;
  } catch (e) {
    return '';
  }
}

function listFiles(dir, pattern = /\.md$/) {
  try {
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
      .filter(f => pattern.test(f))
      .map(f => path.join(dir, f))
      .sort();
  } catch { return []; }
}

function loadBrainContext(customPath) {
  const brainPath = customPath || process.env.BRAIN_PATH || DEFAULT_BRAIN_PATH;

  if (!exists(brainPath)) {
    return `[BRAIN] Nenhum brain encontrado em ${brainPath}. Execute sem contexto de brain.`;
  }

  const sections = [];
  sections.push(`[BRAIN ROOT: ${brainPath}]`);

  // Root docs
  const readme = readFile(path.join(brainPath, 'README.md'), 30000);
  if (readme) sections.push('=== README ===\n' + readme);

  const index = readFile(path.join(brainPath, 'index.md'), 30000);
  if (index) sections.push('=== INDEX ===\n' + index);

  // Guides
  const guidesDir = path.join(brainPath, 'guides');
  if (exists(guidesDir)) {
    const guides = listFiles(guidesDir);
    if (guides.length) {
      sections.push('=== GUIAS OPERACIONAIS ===');
      for (const g of guides) {
        sections.push(`--- ${path.basename(g)} ---\n` + readFile(g, 25000));
      }
    }
  }

  // Personalities
  const personalitiesDir = path.join(brainPath, 'personalities');
  if (exists(personalitiesDir)) {
    const pers = listFiles(personalitiesDir);
    if (pers.length) {
      sections.push('=== PERSONALIDADES ===');
      for (const p of pers) {
        sections.push(`--- ${path.basename(p)} ---\n` + readFile(p, 20000));
      }
    }
  }

  // Standards
  const standardsDir = path.join(brainPath, 'standards');
  if (exists(standardsDir)) {
    const stds = listFiles(standardsDir);
    if (stds.length) {
      sections.push('=== PADRÕES ===');
      for (const s of stds) {
        sections.push(`--- ${path.basename(s)} ---\n` + readFile(s, 20000));
      }
    }
  }

  // Runbooks
  const runbooksDir = path.join(brainPath, 'runbooks');
  if (exists(runbooksDir)) {
    const rbs = listFiles(runbooksDir);
    if (rbs.length) {
      sections.push('=== RUNBOOKS ===');
      for (const r of rbs) {
        sections.push(`--- ${path.basename(r)} ---\n` + readFile(r, 15000));
      }
    }
  }

  // Knowledge
  const knowledgeDir = path.join(brainPath, 'knowledge');
  if (exists(knowledgeDir)) {
    const kbs = listFiles(knowledgeDir);
    if (kbs.length) {
      sections.push('=== CONHECIMENTO ===');
      for (const k of kbs) {
        sections.push(`--- ${path.basename(k)} ---\n` + readFile(k, 15000));
      }
    }
  }

  return sections.join('\n\n');
}

module.exports = { loadBrainContext, DEFAULT_BRAIN_PATH };
