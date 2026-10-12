// ============================================================
// LUNA SEMANTIC MEMORY v18.0 — A Luna Lembra de Verdade
// Embeddings + busca semântica + fatos extraídos
// Fallback para keyword matching se Ollama não tiver embeddings
// ============================================================

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../dashboard/data/luna-semantic-memory.db');
const JSON_PATH = path.join(__dirname, '../../dashboard/data/luna-semantic-memory.json');

class LunaSemanticMemory {
  constructor(ollamaHost = 'http://localhost:11434') {
    this.ollamaHost = ollamaHost;
    this.useSQLite = false;
    this.db = null;
    this.embeddingsModel = 'nomic-embed-text';
    this.embeddingsAvailable = false;
    this.data = { messages: [], facts: [], embeddings: {} };
    this.init();
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(DB_PATH);
      this.createTables();
      this.useSQLite = true;
      console.log('[SM] ✅ Semantic Memory com SQLite ativo');
    } catch (e) {
      this.useSQLite = false;
      this.loadJson();
      console.log('[SM] ⚠️  SQLite indisponível, usando JSON fallback');
    }

    // Verificar se Ollama tem modelo de embeddings
    this.checkEmbeddingsAvailability();
  }

  async checkEmbeddingsAvailability() {
    try {
      const res = await fetch(`${this.ollamaHost}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (res.ok) {
        const data = await res.json();
        const models = (data.models || []).map(m => m.name || m.model || '');
        this.embeddingsAvailable = models.some(m => m.includes('embed') || m.includes('nomic'));
        if (this.embeddingsAvailable) {
          console.log('[SM] ✅ Modelo de embeddings disponível');
        }
      }
    } catch (e) {
      this.embeddingsAvailable = false;
      console.log('[SM] ℹ️  Embeddings não disponíveis, usando fallback semântico');
    }
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        author TEXT,
        author_name TEXT,
        body TEXT,
        category TEXT,
        timestamp TEXT,
        chat_id TEXT,
        embedding TEXT,
        keywords TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sm_author ON messages(author);
      CREATE INDEX IF NOT EXISTS idx_sm_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_sm_category ON messages(category);

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        attribute TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        timestamp TEXT,
        source TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS idx_sm_facts_entity ON facts(entity);

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        topic TEXT,
        summary TEXT,
        participants TEXT,
        message_count INTEGER DEFAULT 0,
        last_message TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);
  }

  loadJson() {
    try {
      if (fs.existsSync(JSON_PATH)) {
        this.data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      }
    } catch (e) {
      console.error('[SM] Erro ao carregar JSON:', e.message);
    }
  }

  saveJson() {
    if (!this.useSQLite) {
      try {
        fs.writeFileSync(JSON_PATH, JSON.stringify(this.data, null, 2));
      } catch (e) {
        console.error('[SM] Erro ao salvar JSON:', e.message);
      }
    }
  }

  // ── EMBEDDINGS ──

  async generateEmbedding(text) {
    if (!this.embeddingsAvailable) return null;
    try {
      const res = await fetch(`${this.ollamaHost}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.embeddingsModel, prompt: text.slice(0, 8000) }),
        signal: AbortSignal.timeout(10000)
      });
      if (res.ok) {
        const data = await res.json();
        return data.embedding || null;
      }
    } catch (e) {
      // fallback silencioso
    }
    return null;
  }

  cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // ── ARMAZENAMENTO ──

  async storeMessage(msg) {
    const id = msg.id || `${msg.from}:${msg.timestamp}`;
    const body = msg.body || msg.text || '';
    const keywords = this.extractKeywords(body);
    const embedding = this.embeddingsAvailable ? await this.generateEmbedding(body) : null;

    if (this.useSQLite) {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO messages (id, author, author_name, body, category, timestamp, chat_id, embedding, keywords)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        msg.author || msg.from,
        msg.authorName || msg.pushname || 'Desconhecido',
        body,
        msg.category || 'unknown',
        msg.timestamp || new Date().toISOString(),
        msg.from || '',
        embedding ? JSON.stringify(embedding) : null,
        JSON.stringify(keywords)
      );
    } else {
      const existing = this.data.messages.findIndex(m => m.id === id);
      const entry = {
        id,
        author: msg.author || msg.from,
        authorName: msg.authorName || msg.pushname || 'Desconhecido',
        body,
        category: msg.category || 'unknown',
        timestamp: msg.timestamp || new Date().toISOString(),
        chatId: msg.from || '',
        keywords,
        embedding: embedding || null
      };
      if (existing >= 0) {
        this.data.messages[existing] = entry;
      } else {
        this.data.messages.push(entry);
        if (this.data.messages.length > 2000) {
          this.data.messages = this.data.messages.slice(-1500);
        }
      }
      this.saveJson();
    }
  }

  extractKeywords(text) {
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/).filter(w => w.length > 3);
    const keywords = [];
    const stopwords = new Set(['para', 'como', 'quando', 'onde', 'este', 'esta', 'esse', 'essa', 'aquele', 'aquela', 'isso', 'isto', 'aquilo', 'muito', 'mais', 'menos', 'tambem', 'agora', 'depois', 'antes', 'desde', 'entre', 'sobre', 'contra', 'perante']);
    for (const w of words) {
      const clean = w.replace(/[^a-z0-9áéíóúãõâêôç]/g, '');
      if (clean.length > 3 && !stopwords.has(clean)) {
        keywords.push(clean);
      }
    }
    return [...new Set(keywords)].slice(0, 20);
  }

  // ── BUSCA SEMÂNTICA ──

  async search(query, limit = 10) {
    const lower = query.toLowerCase();
    const queryKeywords = this.extractKeywords(query);

    // Se tem embeddings, usar busca por similaridade
    if (this.embeddingsAvailable) {
      const queryEmbedding = await this.generateEmbedding(query);
      if (queryEmbedding) {
        return this.searchByEmbedding(queryEmbedding, limit);
      }
    }

    // Fallback: busca por keywords + relevância
    return this.searchByKeywords(queryKeywords, lower, limit);
  }

  searchByKeywords(queryKeywords, lowerQuery, limit) {
    let messages = [];

    if (this.useSQLite) {
      const stmt = this.db.prepare(`
        SELECT * FROM messages 
        WHERE body LIKE ? OR keywords LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);
      messages = stmt.all(`%${lowerQuery}%`, `%${queryKeywords[0] || lowerQuery}%`, limit * 3);
      messages = messages.map(m => ({ ...m, keywords: JSON.parse(m.keywords || '[]') }));
    } else {
      messages = this.data.messages.slice();
    }

    // Score de relevância
    const scored = messages.map(m => {
      let score = 0;
      const body = (m.body || '').toLowerCase();

      // Match exato da query
      if (body.includes(lowerQuery)) score += 3;

      // Match de keywords
      const msgKeywords = m.keywords || [];
      for (const kw of queryKeywords) {
        if (msgKeywords.includes(kw)) score += 1;
        if (body.includes(kw)) score += 0.5;
      }

      // Boost para mensagens recentes
      const age = Date.now() - new Date(m.timestamp).getTime();
      const daysOld = age / (24 * 60 * 60 * 1000);
      score += Math.max(0, 1 - daysOld / 30); // +1 para mensagens de hoje, 0 para mensagens de 30+ dias

      return { ...m, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  searchByEmbedding(queryEmbedding, limit) {
    // Buscar todas as mensagens com embeddings e calcular similaridade
    let messages = [];
    if (this.useSQLite) {
      const stmt = this.db.prepare('SELECT * FROM messages WHERE embedding IS NOT NULL');
      messages = stmt.all().map(m => ({
        ...m,
        embedding: JSON.parse(m.embedding),
        keywords: JSON.parse(m.keywords || '[]')
      }));
    } else {
      messages = this.data.messages.filter(m => m.embedding);
    }

    const scored = messages.map(m => ({
      ...m,
      score: this.cosineSimilarity(queryEmbedding, m.embedding)
    }));

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit);
  }

  // ── FATOS ──

  addFact(entity, attribute, value, confidence = 1.0, timestamp = null, source = '') {
    const ts = timestamp || new Date().toISOString();
    if (this.useSQLite) {
      const stmt = this.db.prepare(`
        INSERT INTO facts (entity, attribute, value, confidence, timestamp, source)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      stmt.run(entity, attribute, value, confidence, ts, source);
    } else {
      this.data.facts.push({ entity, attribute, value, confidence, timestamp: ts, source });
      this.saveJson();
    }
  }

  getFacts(entity, attribute = null) {
    if (this.useSQLite) {
      let query = 'SELECT * FROM facts WHERE entity = ?';
      const params = [entity];
      if (attribute) { query += ' AND attribute = ?'; params.push(attribute); }
      query += ' ORDER BY timestamp DESC';
      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    }
    return this.data.facts
      .filter(f => f.entity === entity && (!attribute || f.attribute === attribute))
      .reverse();
  }

  getLatestFact(entity, attribute) {
    const facts = this.getFacts(entity, attribute);
    return facts.length > 0 ? facts[0] : null;
  }

  // ── CONTEXTO DE CONVERSA ──

  async getThreadContext(query, author = null, limit = 10) {
    const results = await this.search(query, limit * 2);

    // Filtrar por autor se especificado
    let filtered = results;
    if (author) {
      filtered = results.filter(r =>
        r.author === author || r.author_name === author ||
        (r.author || '').includes(author) || (r.authorName || '').includes(author)
      );
    }

    // Ordenar por timestamp para criar linha do tempo
    filtered.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

    return filtered.slice(-limit);
  }

  getStats() {
    if (this.useSQLite) {
      const m = this.db.prepare('SELECT COUNT(*) as count FROM messages').get();
      const f = this.db.prepare('SELECT COUNT(*) as count FROM facts').get();
      const withEmbeddings = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE embedding IS NOT NULL').get();
      return { messages: m.count, facts: f.count, withEmbeddings: withEmbeddings.count };
    }
    return {
      messages: this.data.messages.length,
      facts: this.data.facts.length,
      withEmbeddings: this.data.messages.filter(m => m.embedding).length
    };
  }
}

module.exports = { LunaSemanticMemory };
