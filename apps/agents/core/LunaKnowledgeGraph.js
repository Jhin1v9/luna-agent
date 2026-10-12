// ============================================================
// LUNA KNOWLEDGE GRAPH v18.0 — A Luna Sabe o que Está Acontecendo
// Extrai entidades e relacionamentos de mensagens e dados.
// Não é mais um log. É um cérebro de conhecimento.
// ============================================================

const fs = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, '../../dashboard/data/luna-knowledge-graph.db');
const JSON_PATH = path.join(__dirname, '../../dashboard/data/luna-knowledge-graph.json');

class LunaKnowledgeGraph {
  constructor() {
    this.useSQLite = false;
    this.db = null;
    this.data = { entities: {}, relationships: [], facts: [], lastUpdated: null };
    this.init();
  }

  init() {
    try {
      const Database = require('better-sqlite3');
      this.db = new Database(DB_PATH);
      this.createTables();
      this.useSQLite = true;
      console.log('[KG] ✅ Knowledge Graph com SQLite ativo');
    } catch (e) {
      this.useSQLite = false;
      this.loadJson();
      console.log('[KG] ⚠️  SQLite indisponível, usando JSON fallback');
    }
  }

  createTables() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        attributes TEXT,
        first_seen TEXT,
        last_seen TEXT,
        confidence REAL DEFAULT 1.0
      );
      CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
      CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

      CREATE TABLE IF NOT EXISTS relationships (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subject TEXT NOT NULL,
        predicate TEXT NOT NULL,
        object TEXT NOT NULL,
        context TEXT,
        timestamp TEXT,
        confidence REAL DEFAULT 1.0,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_rel_subj ON relationships(subject);
      CREATE INDEX IF NOT EXISTS idx_rel_obj ON relationships(object);
      CREATE INDEX IF NOT EXISTS idx_rel_pred ON relationships(predicate);

      CREATE TABLE IF NOT EXISTS facts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        entity TEXT NOT NULL,
        attribute TEXT NOT NULL,
        value TEXT NOT NULL,
        confidence REAL DEFAULT 1.0,
        timestamp TEXT,
        source TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_facts_entity ON facts(entity);
      CREATE INDEX IF NOT EXISTS idx_facts_attr ON facts(attribute);
    `);
  }

  loadJson() {
    try {
      if (fs.existsSync(JSON_PATH)) {
        this.data = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
      }
    } catch (e) {
      console.error('[KG] Erro ao carregar JSON:', e.message);
    }
  }

  saveJson() {
    if (!this.useSQLite) {
      try {
        fs.writeFileSync(JSON_PATH, JSON.stringify(this.data, null, 2));
      } catch (e) {
        console.error('[KG] Erro ao salvar JSON:', e.message);
      }
    }
  }

  // ── ENTIDADES ──

  addEntity(id, type, name, attributes = {}, confidence = 1.0) {
    const now = new Date().toISOString();
    if (this.useSQLite) {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO entities (id, type, name, attributes, first_seen, last_seen, confidence)
        VALUES (?, ?, ?, ?, COALESCE((SELECT first_seen FROM entities WHERE id = ?), ?), ?, ?)
      `);
      stmt.run(id, type, name, JSON.stringify(attributes), id, now, now, confidence);
    } else {
      if (!this.data.entities[id]) {
        this.data.entities[id] = { id, type, name, attributes, first_seen: now, last_seen: now, confidence };
      } else {
        this.data.entities[id].name = name;
        this.data.entities[id].attributes = { ...this.data.entities[id].attributes, ...attributes };
        this.data.entities[id].last_seen = now;
        this.data.entities[id].confidence = Math.max(this.data.entities[id].confidence, confidence);
      }
      this.saveJson();
    }
  }

  getEntity(id) {
    if (this.useSQLite) {
      const stmt = this.db.prepare('SELECT * FROM entities WHERE id = ?');
      const row = stmt.get(id);
      if (row) {
        row.attributes = JSON.parse(row.attributes || '{}');
        return row;
      }
      return null;
    }
    return this.data.entities[id] || null;
  }

  findEntities(type, nameQuery) {
    const lower = (nameQuery || '').toLowerCase();
    if (this.useSQLite) {
      const stmt = this.db.prepare('SELECT * FROM entities WHERE type = ? AND LOWER(name) LIKE ?');
      return stmt.all(type, `%${lower}%`).map(r => ({ ...r, attributes: JSON.parse(r.attributes || '{}') }));
    }
    return Object.values(this.data.entities).filter(e =>
      (!type || e.type === type) &&
      (!nameQuery || e.name.toLowerCase().includes(lower))
    );
  }

  // ── RELACIONAMENTOS ──

  addRelationship(subject, predicate, object, context = '', timestamp = null, confidence = 1.0, source = '') {
    const ts = timestamp || new Date().toISOString();
    if (this.useSQLite) {
      const stmt = this.db.prepare(`
        INSERT INTO relationships (subject, predicate, object, context, timestamp, confidence, source)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(subject, predicate, object, context, ts, confidence, source);
    } else {
      this.data.relationships.push({ subject, predicate, object, context, timestamp: ts, confidence, source });
      this.saveJson();
    }
  }

  getRelationships(subject = null, predicate = null, object = null, limit = 50) {
    if (this.useSQLite) {
      let query = 'SELECT * FROM relationships WHERE 1=1';
      const params = [];
      if (subject) { query += ' AND subject = ?'; params.push(subject); }
      if (predicate) { query += ' AND predicate = ?'; params.push(predicate); }
      if (object) { query += ' AND object = ?'; params.push(object); }
      query += ' ORDER BY timestamp DESC LIMIT ?';
      params.push(limit);
      const stmt = this.db.prepare(query);
      return stmt.all(...params);
    }
    return this.data.relationships
      .filter(r =>
        (!subject || r.subject === subject) &&
        (!predicate || r.predicate === predicate) &&
        (!object || r.object === object)
      )
      .slice(-limit)
      .reverse();
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

  // ── EXTRAÇÃO INTELIGENTE ──

  /**
   * Extrai entidades e fatos de uma mensagem do WhatsApp
   */
  extractFromMessage(msg) {
    const body = (msg.body || msg.text || '').toLowerCase();
    const author = msg.author || msg.pushname || msg.from || 'unknown';
    const timestamp = msg.timestamp || new Date().toISOString();
    const source = msg.id?._serialized || `${msg.from}:${timestamp}`;

    const extractions = [];

    // Extrair pessoas mencionadas
    const people = this._extractPeople(body, author);
    for (const p of people) {
      this.addEntity(`person:${p}`, 'person', p, {}, 0.8);
      extractions.push({ type: 'person', name: p });
    }

    // Extrair projetos mencionados
    const projects = this._extractProjects(body);
    for (const proj of projects) {
      this.addEntity(`project:${proj.id}`, 'project', proj.name, { codename: proj.codename }, 0.9);
      extractions.push({ type: 'project', ...proj });
    }

    // Extrair tarefas
    const tasks = this._extractTasks(body);
    for (const t of tasks) {
      this.addEntity(`task:${t.text}`, 'task', t.text, { priority: t.priority }, 0.7);
      extractions.push({ type: 'task', ...t });
    }

    // Extrair pagamentos
    const payments = this._extractPayments(body);
    for (const p of payments) {
      this.addFact(p.who, 'pagamento', p.status, 0.9, timestamp, source);
      extractions.push({ type: 'payment', ...p });
    }

    // Extratar prazos/deadlines
    const deadlines = this._extractDeadlines(body);
    for (const d of deadlines) {
      this.addFact(d.what, 'deadline', d.when, 0.8, timestamp, source);
      extractions.push({ type: 'deadline', ...d });
    }

    // Relacionamentos
    for (const p of people) {
      for (const proj of projects) {
        this.addRelationship(`person:${p}`, 'mencionou', `project:${proj.id}`, body.slice(0, 100), timestamp, 0.8, source);
      }
    }

    return extractions;
  }

  _extractPeople(text, excludeAuthor) {
    const names = [];
    const known = ['abner', 'enoque', 'nonoke', 'elias', 'paulo', 'juan', 'jess', 'gesse', 'lucas'];
    for (const name of known) {
      if (text.includes(name) && name !== excludeAuthor.toLowerCase()) {
        names.push(name);
      }
    }
    return names;
  }

  _extractProjects(text) {
    const projects = [];
    try {
      const projectsSchema = JSON.parse(fs.readFileSync(path.join(__dirname, '../../dashboard/data/schema/projects-registry.json'), 'utf8'));
      for (const [id, proj] of Object.entries(projectsSchema.projects || {})) {
        const keywords = [proj.codename, proj.name, ...(proj.aliases || [])].filter(Boolean);
        for (const kw of keywords) {
          if (text.includes(kw.toLowerCase())) {
            projects.push({ id, name: proj.name, codename: proj.codename });
            break;
          }
        }
      }
    } catch (e) {
      // schema não disponível
    }
    return projects;
  }

  _extractTasks(text) {
    const tasks = [];
    const patterns = [
      /(?:precisamos|falta|fazer|implementar|criar|desenvolver|corrigir|arrumar)\s+(.{3,80})/i,
      /(?:tarefa|todo|pendente):?\s*(.{3,80})/i
    ];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const priority = /P0|urgente|critical/i.test(text) ? 'P0' : /P1/i.test(text) ? 'P1' : 'P2';
        tasks.push({ text: match[1].trim(), priority });
      }
    }
    return tasks;
  }

  _extractPayments(text) {
    const payments = [];
    const paidMatch = text.match(/(\w+)\s+(?:pagou|pago|recebido|transferiu|pix)/i);
    if (paidMatch) {
      payments.push({ who: paidMatch[1], status: 'pago' });
    }
    const pendingMatch = text.match(/(\w+)\s+(?:nao pag|pendente|falta pagar|deve)/i);
    if (pendingMatch) {
      payments.push({ who: pendingMatch[1], status: 'pendente' });
    }
    return payments;
  }

  _extractDeadlines(text) {
    const deadlines = [];
    const match = text.match(/(?:deadline|prazo|entrega|ate|até)\s+(?:dia\s+)?(\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?)/i);
    if (match) {
      const taskMatch = text.match(/(?:para|do|da)\s+(.{3,40})/i);
      deadlines.push({ what: taskMatch ? taskMatch[1].trim() : 'tarefa', when: match[1] });
    }
    return deadlines;
  }

  // ── CONSULTAS INTELIGENTES ──

  /**
   * Responde perguntas do tipo "Quem é responsável pelo X?"
   */
  whoIsResponsibleFor(projectName) {
    const projects = this.findEntities('project', projectName);
    if (projects.length === 0) return null;
    const proj = projects[0];
    const rels = this.getRelationships(null, 'responsável', `project:${proj.id}`);
    return rels.map(r => r.subject);
  }

  /**
   * Responde perguntas do tipo "Qual o status do pagamento do X?"
   */
  getPaymentStatus(entityName) {
    const people = this.findEntities('person', entityName);
    if (people.length === 0) return null;
    const person = people[0];
    const fact = this.getLatestFact(`person:${person.id}`, 'pagamento');
    return fact ? { status: fact.value, when: fact.timestamp, confidence: fact.confidence } : null;
  }

  /**
   * Responde perguntas do tipo "Quando é o deadline do X?"
   */
  getDeadline(taskName) {
    const tasks = this.findEntities('task', taskName);
    if (tasks.length === 0) {
      // Tentar buscar como fato genérico
      const fact = this.getLatestFact(taskName, 'deadline');
      return fact ? { when: fact.value, confidence: fact.confidence } : null;
    }
    const task = tasks[0];
    const fact = this.getLatestFact(`task:${task.id}`, 'deadline');
    return fact ? { when: fact.value, confidence: fact.confidence } : null;
  }

  /**
   * Resumo de uma entidade
   */
  summarizeEntity(entityId) {
    const entity = this.getEntity(entityId);
    if (!entity) return null;

    const facts = this.getFacts(entityId);
    const rels = this.getRelationships(entityId);
    const incoming = this.getRelationships(null, null, entityId);

    return {
      entity,
      facts: facts.slice(0, 20),
      outgoing: rels.slice(0, 20),
      incoming: incoming.slice(0, 20)
    };
  }

  getStats() {
    if (this.useSQLite) {
      const e = this.db.prepare('SELECT COUNT(*) as count FROM entities').get();
      const r = this.db.prepare('SELECT COUNT(*) as count FROM relationships').get();
      const f = this.db.prepare('SELECT COUNT(*) as count FROM facts').get();
      return { entities: e.count, relationships: r.count, facts: f.count };
    }
    return {
      entities: Object.keys(this.data.entities).length,
      relationships: this.data.relationships.length,
      facts: this.data.facts.length
    };
  }
}

module.exports = { LunaKnowledgeGraph };
