/**
 * NEXO Workspace Manager v1.0
 * Gerencia filesystem real de clientes: pastas, arquivos, metadata, índice.
 */

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const WORKSPACE_DIR = path.join(__dirname, 'workspace');
const INDEX_FILE = path.join(DATA_DIR, 'workspace-index.json');

// PostgreSQL datastore para índice de clientes
let dataStore;
try { dataStore = require('./datastore-pg'); } catch { dataStore = null; }

const DEFAULT_FOLDERS = [
  '01_orcamentos',
  '02_contratos',
  '03_briefings',
  '04_design',
  '05_demos',
  '06_documentacao',
  '07_entregas'
];

const VALID_STATUSES = ['ativo', 'pausado', 'concluido', 'arquivado'];
const VALID_RESPONSAVEL = ['todos', 'abner', 'nonoke', 'elias'];

function nowISO() {
  return new Date().toISOString();
}

function sanitizeClientId(id) {
  if (!id || typeof id !== 'string') return null;
  const s = id.trim().toLowerCase();
  if (!/^[a-z0-9_-]+$/.test(s)) return null;
  return s;
}

function sanitizeSubPath(subPath) {
  if (!subPath || typeof subPath !== 'string') return '';
  const normalized = path.normalize(subPath).replace(/\\/g, '/');
  if (normalized.startsWith('..') || normalized.includes('/../')) {
    throw new Error('Invalid path');
  }
  return normalized.replace(/^\//, '');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function readJSON(filePath, defaultValue = {}) {
  try {
    if (!fs.existsSync(filePath)) return defaultValue;
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return defaultValue;
  }
}

function writeJSON(filePath, data) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

// ── INDEX ──

async function getIndex() {
  if (dataStore) {
    return await dataStore.getWorkspaceClients();
  }
  return readJSON(INDEX_FILE, { versao: '1.0', ultimaAtualizacao: nowISO(), clientes: [] });
}

async function saveIndex(index) {
  index.ultimaAtualizacao = nowISO();
  if (dataStore) {
    for (const c of (index.clientes || [])) {
      await dataStore.saveWorkspaceClient({
        id: c.id, nome: c.nome, caminho: c.caminho || c.id,
        status: c.status, cor: c.cor, responsavel: c.responsavel,
        tipo: c.tipo || 'cliente', dataInicio: c.dataInicio || nowISO().split('T')[0],
        orcamentoTotal: c.orcamentoTotal || 0, moeda: c.moeda || 'EUR',
        tags: c.tags || [], anotacoes: c.anotacoes || '',
        criadoEm: c.criadoEm || nowISO(), atualizadoEm: c.atualizadoEm || nowISO()
      });
    }
  }
  writeJSON(INDEX_FILE, index);
}

// ── CLIENT ──

async function createClient(rawId, metadata = {}) {
  const id = sanitizeClientId(rawId);
  if (!id) throw new Error('Invalid client id');

  const index = await getIndex();
  if (index.clientes.find(c => c.id === id)) {
    throw new Error('Client already exists');
  }

  const clientDir = path.join(WORKSPACE_DIR, id);
  ensureDir(clientDir);

  // Cria subpastas padrão
  for (const folder of DEFAULT_FOLDERS) {
    ensureDir(path.join(clientDir, folder));
  }

  const clienteJson = {
    id,
    nome: metadata.nome || id,
    tipo: 'cliente',
    status: VALID_STATUSES.includes(metadata.status) ? metadata.status : 'ativo',
    dataInicio: metadata.dataInicio || nowISO().split('T')[0],
    responsavel: VALID_RESPONSAVEL.includes(metadata.responsavel) ? metadata.responsavel : 'todos',
    orcamentoTotal: typeof metadata.orcamentoTotal === 'number' ? metadata.orcamentoTotal : 0,
    moeda: metadata.moeda || 'EUR',
    cor: metadata.cor || '#3b82f6',
    tags: Array.isArray(metadata.tags) ? metadata.tags : [],
    anotacoes: metadata.anotacoes || '',
    criadoEm: nowISO(),
    atualizadoEm: nowISO()
  };

  writeJSON(path.join(clientDir, 'cliente.json'), clienteJson);

  index.clientes.push({
    id: clienteJson.id,
    nome: clienteJson.nome,
    caminho: id,
    status: clienteJson.status,
    cor: clienteJson.cor,
    responsavel: clienteJson.responsavel
  });

  await saveIndex(index);
  return clienteJson;
}

async function getClient(id) {
  const sid = sanitizeClientId(id);
  if (!sid) return null;
  const file = path.join(WORKSPACE_DIR, sid, 'cliente.json');
  if (!fs.existsSync(file)) return null;
  return readJSON(file);
}

function clientExists(id) {
  const sid = sanitizeClientId(id);
  if (!sid) return false;
  return fs.existsSync(path.join(WORKSPACE_DIR, sid, 'cliente.json'));
}

async function updateClient(id, updates) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const file = path.join(WORKSPACE_DIR, sid, 'cliente.json');
  if (!fs.existsSync(file)) throw new Error('Client not found');

  const client = readJSON(file);
  const allowed = ['nome', 'status', 'dataInicio', 'responsavel', 'orcamentoTotal', 'moeda', 'cor', 'tags', 'anotacoes'];
  for (const key of allowed) {
    if (updates[key] !== undefined) {
      if (key === 'status' && !VALID_STATUSES.includes(updates[key])) continue;
      if (key === 'responsavel' && !VALID_RESPONSAVEL.includes(updates[key])) continue;
      if (key === 'tags' && !Array.isArray(updates[key])) continue;
      client[key] = updates[key];
    }
  }
  client.atualizadoEm = nowISO();
  writeJSON(file, client);

  // Atualiza índice
  const index = await getIndex();
  const idx = index.clientes.findIndex(c => c.id === sid);
  if (idx >= 0) {
    index.clientes[idx].nome = client.nome;
    index.clientes[idx].status = client.status;
    index.clientes[idx].cor = client.cor;
    index.clientes[idx].responsavel = client.responsavel;
    await saveIndex(index);
  }

  return client;
}

async function deleteClient(id) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const clientDir = path.join(WORKSPACE_DIR, sid);
  if (!fs.existsSync(clientDir)) throw new Error('Client not found');

  fs.rmSync(clientDir, { recursive: true, force: true });

  const index = await getIndex();
  index.clientes = index.clientes.filter(c => c.id !== sid);
  await saveIndex(index);
  if (dataStore) {
    await dataStore.deleteWorkspaceClient(sid);
  }
  return { deleted: sid };
}

// ── FILES & FOLDERS ──

function listFiles(id, subPath = '') {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const rel = sanitizeSubPath(subPath);
  const targetDir = path.join(WORKSPACE_DIR, sid, rel);

  if (!fs.existsSync(targetDir)) return [];
  const stat = fs.statSync(targetDir);
  if (!stat.isDirectory()) return [];

  const entries = fs.readdirSync(targetDir, { withFileTypes: true });
  return entries.map(entry => {
    const fullPath = path.join(targetDir, entry.name);
    const s = fs.statSync(fullPath);
    return {
      name: entry.name,
      type: entry.isDirectory() ? 'folder' : 'file',
      size: s.size,
      modifiedAt: s.mtime.toISOString(),
      path: rel ? `${rel}/${entry.name}` : entry.name
    };
  });
}

function createFolder(id, subPath, folderName) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');
  if (!folderName || typeof folderName !== 'string') throw new Error('Invalid folder name');

  const safeName = folderName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (!safeName) throw new Error('Invalid folder name');

  const rel = sanitizeSubPath(subPath || '');
  const targetDir = path.join(WORKSPACE_DIR, sid, rel, safeName);

  if (fs.existsSync(targetDir)) throw new Error('Folder already exists');
  ensureDir(targetDir);

  return { name: safeName, path: rel ? `${rel}/${safeName}` : safeName };
}

function deleteFileOrFolder(id, subPath) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const rel = sanitizeSubPath(subPath);
  if (!rel) throw new Error('Invalid path');

  const target = path.join(WORKSPACE_DIR, sid, rel);
  if (!fs.existsSync(target)) throw new Error('Not found');

  fs.rmSync(target, { recursive: true, force: true });
  return { deleted: rel };
}

function renameFileOrFolder(id, subPath, newName) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const rel = sanitizeSubPath(subPath);
  if (!rel) throw new Error('Invalid path');

  const safeName = newName.trim().replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
  if (!safeName) throw new Error('Invalid new name');

  const oldPath = path.join(WORKSPACE_DIR, sid, rel);
  if (!fs.existsSync(oldPath)) throw new Error('Not found');

  const parentDir = path.dirname(oldPath);
  const newPath = path.join(parentDir, safeName);

  if (fs.existsSync(newPath)) throw new Error('Name already exists');
  fs.renameSync(oldPath, newPath);

  const newRel = path.join(path.dirname(rel), safeName).replace(/\\/g, '/');
  return { oldPath: rel, newPath: newRel };
}

function getFileInfo(id, subPath) {
  const sid = sanitizeClientId(id);
  if (!sid) throw new Error('Invalid client id');

  const rel = sanitizeSubPath(subPath);
  if (!rel) throw new Error('Invalid path');

  const target = path.join(WORKSPACE_DIR, sid, rel);
  if (!fs.existsSync(target)) return null;

  const s = fs.statSync(target);
  return {
    path: rel,
    name: path.basename(rel),
    size: s.size,
    modifiedAt: s.mtime.toISOString(),
    isDirectory: s.isDirectory()
  };
}

// ── PROJECT TYPE DETECTION ──

function detectProjectType(id, demoPath) {
  const sid = sanitizeClientId(id);
  if (!sid) return 'unknown';

  const rel = sanitizeSubPath(demoPath || '');
  const folder = path.join(WORKSPACE_DIR, sid, rel);
  if (!fs.existsSync(folder)) return 'unknown';

  const files = fs.readdirSync(folder);

  if (files.includes('package.json')) {
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(folder, 'package.json'), 'utf8'));
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps['react-native'] || deps['expo']) return 'react-native';
      if (deps['next']) return 'nextjs';
      if (deps['electron']) return 'electron';
      if (deps['react-scripts']) return 'react-cra';
      if (deps['react'] && deps['vite']) return 'react-vite';
      if (deps['react']) return 'react';
      if (deps['vue']) return 'vue';
      if (deps['svelte']) return 'svelte';
      if (deps['angular'] || deps['@angular/core']) return 'angular';
      return 'node-generic';
    } catch {
      return 'node-generic';
    }
  }

  if (files.includes('index.html')) return 'static-html';
  if (files.some(f => f.endsWith('.php'))) return 'php';
  if (files.includes('wp-content') || files.includes('wordpress')) return 'wordpress';
  if (files.includes('composer.json')) return 'php-composer';
  if (files.some(f => f.endsWith('.py'))) return 'python';

  return 'unknown';
}

// ── INIT ──

function init() {
  ensureDir(WORKSPACE_DIR);
  ensureDir(DATA_DIR);
  if (!fs.existsSync(INDEX_FILE)) {
    saveIndex({ versao: '1.0', ultimaAtualizacao: nowISO(), clientes: [] });
  }
}

init();

module.exports = {
  getIndex,
  saveIndex,
  createClient,
  getClient,
  clientExists,
  updateClient,
  deleteClient,
  listFiles,
  createFolder,
  deleteFileOrFolder,
  renameFileOrFolder,
  getFileInfo,
  detectProjectType,
  sanitizeSubPath,
  sanitizeClientId,
  WORKSPACE_DIR
};
