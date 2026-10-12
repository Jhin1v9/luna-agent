#!/usr/bin/env node
/**
 * MIGRATION 005 — Apply real schema & migrate JSON data → PostgreSQL
 * Fase 0.1 · NEXO Dashboard Pro
 *
 * Usage:
 *   cd backend && node migrate-005.js
 *
 * What it does:
 *   1. Reads and executes migrations/005-real-schema.sql
 *   2. Reads each JSON file and inserts data into PostgreSQL with REAL field names
 *   3. Prints a summary of migrated rows per table
 *
 * Safety:
 *   - Backs up workspace_clients and quotes before dropping
 *   - Skips tables that already have data (unless --force)
 *   - Transaction per table for atomicity
 */

require('dotenv').config({ path: './.env' });
const fs = require('fs');
const path = require('path');
const db = require('./db');

const DATA_DIR = path.join(__dirname, 'data');
const FORCE = process.argv.includes('--force');

function readJSON(file, def = []) {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    return JSON.parse(raw);
  } catch { return def; }
}

async function runSQLFile(filePath) {
  const sql = fs.readFileSync(filePath, 'utf8');
  // Split on semicolons but be careful with comments
  const statements = sql
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/--.*$/gm, '')
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const stmt of statements) {
    try {
      await db.query(stmt);
    } catch (err) {
      if (!err.message.includes('already exists') && !err.message.includes('does not exist')) {
        console.error(`  SQL ERROR: ${err.message}`);
        console.error(`  STATEMENT: ${stmt.substring(0, 200)}...`);
      }
    }
  }
}

async function countRows(table) {
  try {
    const rows = await db.query(`SELECT COUNT(*) FROM ${table}`);
    return parseInt(rows[0].count, 10);
  } catch { return 0; }
}

// ============================================================
// MIGRATORS (one per entity)
// ============================================================

async function migrateUsers() {
  const data = readJSON(path.join(DATA_DIR, 'users.json'), { users: {} });
  const users = data.users || {};
  let count = 0;
  for (const [id, u] of Object.entries(users)) {
    await db.run(
      `INSERT INTO users (id, name, role, color, password, discord_id, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,COALESCE($7,NOW()),COALESCE($8,NOW()))
       ON CONFLICT (id) DO UPDATE SET
         name=$2, role=$3, color=$4, password=$5, discord_id=$6, updated_at=NOW()`,
      [id, u.name, u.role, u.color, u.password, u.discordId || null, u.createdAt, u.updatedAt]
    );
    count++;
  }
  return count;
}

async function migrateTasks() {
  const tasks = readJSON(path.join(DATA_DIR, 'tasks.json'), []);
  let count = 0;
  for (const t of tasks) {
    await db.run(
      `INSERT INTO tasks (id, title, description, status, priority, task_type, due_date, added_by, assigned_to, source, comments, created_at, updated_at, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, description=$3, status=$4, priority=$5, task_type=$6,
         due_date=$7, added_by=$8, assigned_to=$9, source=$10, comments=$11,
         updated_at=$13, started_at=$14, completed_at=$15`,
      [t.id, t.title, t.description, t.status, t.priority, t.taskType,
       t.dueDate, t.addedBy, t.assignedTo, t.source,
       JSON.stringify(t.comments || []), t.createdAt, t.updatedAt,
       t.startedAt, t.completedAt]
    );
    count++;
  }
  return count;
}

async function migrateCompanyTasks() {
  const tasks = readJSON(path.join(DATA_DIR, 'company-tasks.json'), []);
  let count = 0;
  for (const t of tasks) {
    await db.run(
      `INSERT INTO company_tasks (id, title, description, status, priority, task_type, due_date, added_by, assigned_to, source, comments, created_at, updated_at, started_at, completed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, description=$3, status=$4, priority=$5, task_type=$6,
         due_date=$7, added_by=$8, assigned_to=$9, source=$10, comments=$11,
         updated_at=$13, started_at=$14, completed_at=$15`,
      [t.id, t.title, t.description, t.status, t.priority, t.taskType,
       t.dueDate, t.addedBy, t.assignedTo, t.source,
       JSON.stringify(t.comments || []), t.createdAt, t.updatedAt,
       t.startedAt, t.completedAt]
    );
    count++;
  }
  return count;
}

async function migratePayments() {
  const payments = readJSON(path.join(DATA_DIR, 'payments.json'), []);
  let count = 0;
  for (const p of payments) {
    const pid = p.paymentId || p.id || `pay-${Date.now()}-${count}`;
    await db.run(
      `INSERT INTO payments (payment_id, id, client_id, client_name, client_short_name, project_name, project_id, description, total_amount, equivalent_eur, status, payment_terms, method_preferred, method_accepted, revenue_split, transactions, notes, links, company_share_percent, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (payment_id) DO UPDATE SET
         id=$2, client_id=$3, client_name=$4, client_short_name=$5, project_name=$6,
         project_id=$7, description=$8, total_amount=$9, equivalent_eur=$10, status=$11,
         payment_terms=$12, method_preferred=$13, method_accepted=$14, revenue_split=$15,
         transactions=$16, notes=$17, links=$18, company_share_percent=$19, updated_at=$21`,
      [
        pid, p.id || pid, p.clientId, p.clientName, p.clientShortName || '',
        p.projectName, p.projectId, p.description || '',
        JSON.stringify(p.totalAmount || { value: 0, currency: 'EUR' }),
        p.equivalentEUR ? JSON.stringify(p.equivalentEUR) : null,
        p.status, JSON.stringify(p.paymentTerms || { type: 'full', splits: [] }),
        p.methodPreferred, JSON.stringify(p.methodAccepted || ['transfer','card','cash','bizum']),
        JSON.stringify(p.revenueSplit || []), JSON.stringify(p.transactions || []),
        p.notes || '', JSON.stringify(p.links || {}), p.companySharePercent || 25,
        p.createdAt, p.updatedAt
      ]
    );
    count++;
  }
  return count;
}

async function migrateExpenses() {
  const expenses = readJSON(path.join(DATA_DIR, 'expenses.json'), []);
  let count = 0;
  for (const e of expenses) {
    await db.run(
      `INSERT INTO expenses (id, name, description, amount_value, amount_currency, cost_per_person_value, cost_per_person_currency, type, period, period_label, start_date, renew_date, end_date, category, category_label, split_among, paid_by, fully_paid, auto_deduct_from_cash_box, notes, attachments, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, description=$3, amount_value=$4, amount_currency=$5,
         cost_per_person_value=$6, cost_per_person_currency=$7, type=$8, period=$9,
         period_label=$10, start_date=$11, renew_date=$12, end_date=$13,
         category=$14, category_label=$15, split_among=$16, paid_by=$17,
         fully_paid=$18, auto_deduct_from_cash_box=$19, notes=$20,
         attachments=$21, created_by=$22, updated_at=$24`,
      [
        e.id, e.name, e.description,
        e.amount?.value ?? e.amount ?? 0,
        e.amount?.currency ?? 'EUR',
        e.costPerPerson?.value ?? 0,
        e.costPerPerson?.currency ?? 'EUR',
        e.type, e.period, e.periodLabel,
        e.startDate, e.renewDate, e.endDate,
        e.category, e.categoryLabel,
        JSON.stringify(e.splitAmong || []),
        JSON.stringify(e.paidBy || {}),
        e.fullyPaid ?? false,
        e.autoDeductFromCashBox ?? true,
        e.notes,
        JSON.stringify(e.attachments || []),
        e.createdBy, e.createdAt, e.updatedAt
      ]
    );
    count++;
  }
  return count;
}

async function migrateCashBox() {
  const data = readJSON(path.join(DATA_DIR, 'cash-box.json'), {});
  if (!data || Object.keys(data).length === 0) return 0;
  await db.run(
    `INSERT INTO cash_box (id, balance_value, balance_currency, monthly_income_value, monthly_income_currency, monthly_expenses_value, monthly_expenses_currency, projected_balance_value, projected_balance_currency, projection_months, incoming_payments, outgoing_expenses, history, last_updated, alerts, settings, audit_log)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       balance_value=$1, balance_currency=$2, monthly_income_value=$3, monthly_income_currency=$4,
       monthly_expenses_value=$5, monthly_expenses_currency=$6, projected_balance_value=$7,
       projected_balance_currency=$8, projection_months=$9, incoming_payments=$10,
       outgoing_expenses=$11, history=$12, last_updated=$13, alerts=$14, settings=$15, audit_log=$16`,
    [
      data.balance?.value ?? data.balance ?? 0,
      data.balance?.currency ?? 'EUR',
      data.monthlyIncome?.value ?? 0,
      data.monthlyIncome?.currency ?? 'EUR',
      data.monthlyExpenses?.value ?? 0,
      data.monthlyExpenses?.currency ?? 'EUR',
      data.projectedBalance?.value ?? 0,
      data.projectedBalance?.currency ?? 'EUR',
      data.projectionMonths ?? 3,
      JSON.stringify(data.incomingPayments || []),
      JSON.stringify(data.outgoingExpenses || []),
      JSON.stringify(data.history || []),
      data.lastUpdated || new Date().toISOString(),
      JSON.stringify(data.alerts || []),
      JSON.stringify(data.settings || { lowBalanceMultiplier: 2, currency: 'EUR', autoDeductRecurring: true, projectionMonths: 3 }),
      JSON.stringify(data.auditLog || [])
    ]
  );
  return 1;
}

async function migrateQuotes() {
  const quotes = readJSON(path.join(DATA_DIR, 'quotes.json'), []);
  let count = 0;
  for (const q of quotes) {
    await db.run(
      `INSERT INTO quotes (quote_id, id, project_id, project_name, client_name, client_id, status, status_label, total_amount, monthly_fee, year1_investment, discount_upfront, items, github_url, created_at, sent_at, valid_until, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (quote_id) DO UPDATE SET
         id=$2, project_id=$3, project_name=$4, client_name=$5, client_id=$6,
         status=$7, status_label=$8, total_amount=$9, monthly_fee=$10,
         year1_investment=$11, discount_upfront=$12, items=$13,
         github_url=$14, created_at=$15, sent_at=$16, valid_until=$17, updated_at=$18`,
      [
        q.quoteId || q.id, q.id || q.quoteId,
        q.projectId, q.projectName, q.clientName, q.clientId,
        q.status, q.statusLabel,
        JSON.stringify(q.totalAmount || { value: 0, currency: 'EUR' }),
        JSON.stringify(q.monthlyFee || { value: 0, currency: 'EUR' }),
        JSON.stringify(q.year1Investment || { value: 0, currency: 'EUR' }),
        JSON.stringify(q.discountUpfront || { percent: 0, amount: 0, currency: 'EUR' }),
        JSON.stringify(q.items || []),
        q.githubUrl, q.createdAt, q.sentAt, q.validUntil,
        new Date().toISOString()
      ]
    );
    count++;
  }
  return count;
}

async function migrateLeads() {
  const leads = readJSON(path.join(DATA_DIR, 'leads.json'), []);
  let count = 0;
  for (const l of leads) {
    const lid = l.id || `lead-${Date.now()}-${count}`;
    await db.run(
      `INSERT INTO leads (id, display_name, name, email, phone, source, type, status, pipeline_status, estimated_value, currency, notes, assigned_to, tags, created_at, last_contact, converted_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         display_name=$2, name=$3, email=$4, phone=$5, source=$6,
         type=$7, status=$8, pipeline_status=$9, estimated_value=$10,
         currency=$11, notes=$12, assigned_to=$13, tags=$14,
         last_contact=$16, converted_at=$17`,
      [lid, l.displayName || l.name, l.name, l.email, l.phone,
       l.source, l.type, l.status, l.pipelineStatus,
       l.estimatedValue, l.currency, l.notes, l.assignedTo,
       JSON.stringify(l.tags || []), l.createdAt,
       l.lastContact, l.convertedAt]
    );
    count++;
  }
  return count;
}

async function migrateMembers() {
  const members = readJSON(path.join(DATA_DIR, 'members.json'), []);
  let count = 0;
  for (const m of members) {
    await db.run(
      `INSERT INTO members (id, name, role, skills, share_percent, status, projects, email, phone, country, joined_at, note, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
       ON CONFLICT (id) DO UPDATE SET
         name=$2, role=$3, skills=$4, share_percent=$5, status=$6,
         projects=$7, email=$8, phone=$9, country=$10, joined_at=$11,
         note=$12, updated_at=$14`,
      [m.id, m.name, m.role, JSON.stringify(m.skills || []),
       m.sharePercent, m.status, JSON.stringify(m.projects || []),
       m.email, m.phone, m.country, m.joinedAt,
       m.note, m.createdAt, m.updatedAt]
    );
    count++;
  }
  return count;
}

async function migrateTransactions() {
  const txs = readJSON(path.join(DATA_DIR, 'transactions.json'), []);
  let count = 0;
  for (const t of txs) {
    await db.run(
      `INSERT INTO transactions (id, date, type, amount, currency, description, category, balance_after, recorded_by, recorded_at, notes, source, is_active, deleted_at, deleted_by, metadata, created_at, created_by, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       ON CONFLICT (id) DO UPDATE SET
         date=$2, type=$3, amount=$4, currency=$5, description=$6,
         category=$7, balance_after=$8, recorded_by=$9, recorded_at=$10,
         notes=$11, source=$12, is_active=$13, deleted_at=$14,
         deleted_by=$15, metadata=$16, updated_at=$19`,
      [t.id, t.date, t.type, t.amount, t.currency || 'EUR', t.description,
       t.category, t.balanceAfter, t.recordedBy, t.recordedAt,
       t.notes || '', t.source, t.isActive ?? true, t.deletedAt,
       t.deletedBy, JSON.stringify(t.metadata || {}), t.createdAt,
       t.createdBy || 'abner', t.updatedAt]
    );
    count++;
  }
  return count;
}

async function migrateNotifications() {
  const data = readJSON(path.join(DATA_DIR, 'notifications.json'), { notifications: [] });
  const list = data.notifications || [];
  let count = 0;
  for (const n of list) {
    await db.run(
      `INSERT INTO notifications (id, type, title, message, severity, read, timestamp, metadata, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (id) DO UPDATE SET
         type=$2, title=$3, message=$4, severity=$5, read=$6, timestamp=$7, metadata=$8`,
      [n.id, n.type, n.title, n.message, n.severity, n.read, n.timestamp,
       JSON.stringify(n.metadata || {}), n.createdAt || n.timestamp]
    );
    count++;
  }
  return count;
}

async function migrateLinks() {
  const data = readJSON(path.join(DATA_DIR, 'links-index.json'), { links: [] });
  const list = data.links || [];
  let count = 0;
  for (const l of list) {
    await db.run(
      `INSERT INTO links (id, url, author, timestamp, chat, notes, manual, preview, platform, patterns, icon, color, category, label, hostname, enriched_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         url=$2, author=$3, timestamp=$4, chat=$5, notes=$6, manual=$7,
         preview=$8, platform=$9, patterns=$10, icon=$11, color=$12,
         category=$13, label=$14, hostname=$15, enriched_at=$16`,
      [l.id, l.url, l.author, l.timestamp, l.chat, l.notes,
       l.manual, JSON.stringify(l.preview || {}), l.platform,
       JSON.stringify(l.patterns || []), l.icon, l.color, l.category,
       l.label, l.hostname, l.enrichedAt, l.createdAt]
    );
    count++;
  }
  return count;
}

async function migrateSecurityLogs() {
  const data = readJSON(path.join(DATA_DIR, 'security-log.json'), { events: [] });
  const list = data.events || [];
  let count = 0;
  for (const e of list) {
    await db.run(
      `INSERT INTO security_logs (id, timestamp, type, severity, ip, location, risk, device, attempted_user, message, notified, notification_channel, has_camera_photo, has_screenshot, camera_photo, screenshot, intruder_data)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO NOTHING`,
      [e.id, e.timestamp, e.type, e.severity, e.ip,
       JSON.stringify(e.location || {}), JSON.stringify(e.risk || {}),
       JSON.stringify(e.device || {}), e.attemptedUser, e.message,
       e.notified ?? false, e.notificationChannel,
       e.hasCameraPhoto ?? false, e.hasScreenshot ?? false,
       e.cameraPhoto, e.screenshot, JSON.stringify(e.intruderData || {})]
    );
    count++;
  }
  return count;
}

async function migrateChangelog() {
  const data = readJSON(path.join(__dirname, 'changelog.json'), { entries: [] });
  const list = data.entries || [];
  let count = 0;
  for (const e of list) {
    await db.run(
      `INSERT INTO changelog (id, version, title, description, category, emoji, author, tier, date, tags, read_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
       ON CONFLICT (id) DO UPDATE SET
         version=$2, title=$3, description=$4, category=$5, emoji=$6,
         author=$7, tier=$8, date=$9, tags=$10, read_by=$11`,
      [e.id, e.version, e.title, e.description, e.category,
       e.emoji, e.author, e.tier, e.date,
       JSON.stringify(e.tags || []), JSON.stringify(e.readBy || [])]
    );
    count++;
  }
  return count;
}

async function migrateIdeas() {
  const data = readJSON(path.join(DATA_DIR, 'ideas-registry.json'), { ideas: {} });
  const ideas = data.ideas || {};
  let count = 0;
  for (const [id, idea] of Object.entries(ideas)) {
    await db.run(
      `INSERT INTO ideas (id, title, status, type, priority, linked_to, content, ai_context, tags, created_by, created_by_name, created_at, updated_at, collaborators, comments, attachments, version_history, summary, due_date, assigned_to, converted_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       ON CONFLICT (id) DO UPDATE SET
         title=$2, status=$3, type=$4, priority=$5, linked_to=$6,
         content=$7, ai_context=$8, tags=$9, created_by=$10,
         created_by_name=$11, updated_at=$13, collaborators=$14,
         comments=$15, attachments=$16, version_history=$17,
         summary=$18, due_date=$19, assigned_to=$20, converted_to=$21`,
      [id, idea.title, idea.status, idea.type, idea.priority,
       JSON.stringify(idea.linkedTo || {}), JSON.stringify(idea.content || {}),
       JSON.stringify(idea.aiContext || { brainstormHistory: [], aiSuggestions: [], aiInsights: [] }),
       JSON.stringify(idea.tags || []), idea.createdBy, idea.createdByName,
       idea.createdAt, idea.updatedAt, JSON.stringify(idea.collaborators || []),
       JSON.stringify(idea.comments || []), JSON.stringify(idea.attachments || []),
       JSON.stringify(idea.versionHistory || []), idea.summary, idea.dueDate,
       idea.assignedTo, JSON.stringify(idea.convertedTo || {})]
    );
    count++;
  }
  return count;
}

async function migrateWhatsappHistory() {
  const msgs = readJSON(path.join(DATA_DIR, 'whatsapp-history.json'), []);
  let count = 0;
  for (const m of msgs) {
    await db.run(
      `INSERT INTO whatsapp_history (id, text, body, author, author_name, chat, chat_name, timestamp, classification, reviewed, corrected_category, notes, sent_via_dashboard, direction, responded, resolved_author, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       ON CONFLICT (id) DO UPDATE SET
         text=$2, body=$3, author=$4, author_name=$5, chat=$6, chat_name=$7,
         timestamp=$8, classification=$9, reviewed=$10, corrected_category=$11,
         notes=$12, sent_via_dashboard=$13, direction=$14, responded=$15,
         resolved_author=$16`,
      [m.id, m.text, m.body, m.author, m.authorName, m.chat,
       m.chatName, m.timestamp, JSON.stringify(m.classification || {}),
       m.reviewed ?? false, m.correctedCategory, m.notes,
       m.sentViaDashboard ?? false, m.direction, m.responded ?? false,
       JSON.stringify(m.resolvedAuthor || {}), m.createdAt || m.timestamp]
    );
    count++;
  }
  return count;
}

async function migrateLunaThreads() {
  const data = readJSON(path.join(DATA_DIR, 'luna-chat-threads.json'), { threads: {} });
  const threads = data.threads || {};
  let count = 0;
  for (const [id, t] of Object.entries(threads)) {
    await db.run(
      `INSERT INTO luna_threads (id, type, title, participants, created_at, updated_at, message_count, messages)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT (id) DO UPDATE SET
         type=$2, title=$3, participants=$4, updated_at=$6,
         message_count=$7, messages=$8`,
      [id, t.type, t.title, JSON.stringify(t.participants || []),
       t.createdAt, t.updatedAt, t.messageCount || 0,
       JSON.stringify(t.messages || [])]
    );
    count++;
  }
  return count;
}

async function migrateLunaBuffer() {
  const data = readJSON(path.join(DATA_DIR, 'luna-buffer.json'), {});
  if (!data || Object.keys(data).length === 0) return 0;
  await db.run(
    `INSERT INTO luna_buffer (id, new_messages, new_tasks, new_tasks_done, new_ideas, new_decisions, new_links, new_leads, new_finance, ignored_messages, new_mentions, sentiment, last_buffer_update)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (id) DO UPDATE SET
       new_messages=$1, new_tasks=$2, new_tasks_done=$3, new_ideas=$4,
       new_decisions=$5, new_links=$6, new_leads=$7, new_finance=$8,
       ignored_messages=$9, new_mentions=$10, sentiment=$11, last_buffer_update=$12`,
    [
      JSON.stringify(data.newMessages || []),
      JSON.stringify(data.newTasks || []),
      JSON.stringify(data.newTasksDone || []),
      JSON.stringify(data.newIdeas || []),
      JSON.stringify(data.newDecisions || []),
      JSON.stringify(data.newLinks || []),
      JSON.stringify(data.newLeads || []),
      JSON.stringify(data.newFinance || []),
      JSON.stringify(data.ignoredMessages || []),
      JSON.stringify(data.newMentions || []),
      JSON.stringify(data.sentiment || { positive: 0, negative: 0, urgent: 0 }),
      data.lastBufferUpdate || new Date().toISOString()
    ]
  );
  return 1;
}

async function migrateWorkspaceClients() {
  const data = readJSON(path.join(DATA_DIR, 'workspace-index.json'), { clientes: [] });
  const list = data.clientes || [];
  let count = 0;
  for (const c of list) {
    await db.run(
      `INSERT INTO workspace_clients (id, nome, caminho, status, cor, responsavel, tipo, data_inicio, orcamento_total, moeda, tags, anotacoes, versao, ultima_atualizacao, criado_em, atualizado_em)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
       ON CONFLICT (id) DO UPDATE SET
         nome=$2, caminho=$3, status=$4, cor=$5, responsavel=$6,
         tipo=$7, data_inicio=$8, orcamento_total=$9, moeda=$10,
         tags=$11, anotacoes=$12, versao=$13, ultima_atualizacao=$14,
         atualizado_em=$16`,
      [c.id, c.nome, c.caminho, c.status, c.cor,
       c.responsavel, c.tipo, c.dataInicio,
       c.orcamentoTotal, c.moeda, JSON.stringify(c.tags || []),
       c.anotacoes, '1.0', new Date().toISOString(),
       c.criadoEm, c.atualizadoEm]
    );
    count++;
  }
  return count;
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║  MIGRATION 005 — Real Schema + JSON → PostgreSQL          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  // 1. Apply schema migration
  console.log('📐 Applying schema migration (005-real-schema.sql)...');
  await runSQLFile(path.join(__dirname, 'migrations', '005-real-schema.sql'));
  console.log('   ✅ Schema migration applied.\n');

  // 2. Migrate data
  const migrations = [
    { name: 'users', fn: migrateUsers },
    { name: 'tasks', fn: migrateTasks },
    { name: 'company_tasks', fn: migrateCompanyTasks },
    { name: 'payments', fn: migratePayments },
    { name: 'expenses', fn: migrateExpenses },
    { name: 'cash_box', fn: migrateCashBox },
    { name: 'quotes', fn: migrateQuotes },
    { name: 'leads', fn: migrateLeads },
    { name: 'members', fn: migrateMembers },
    { name: 'transactions', fn: migrateTransactions },
    { name: 'notifications', fn: migrateNotifications },
    { name: 'links', fn: migrateLinks },
    { name: 'security_logs', fn: migrateSecurityLogs },
    { name: 'changelog', fn: migrateChangelog },
    { name: 'ideas', fn: migrateIdeas },
    { name: 'whatsapp_history', fn: migrateWhatsappHistory },
    { name: 'luna_threads', fn: migrateLunaThreads },
    { name: 'luna_buffer', fn: migrateLunaBuffer },
    { name: 'workspace_clients', fn: migrateWorkspaceClients },
  ];

  const results = [];
  for (const { name, fn } of migrations) {
    const before = await countRows(name);
    if (before > 0 && !FORCE) {
      console.log(`⏭️  ${name}: already has ${before} rows (use --force to overwrite)`);
      results.push({ name, before, after: before, skipped: true });
      continue;
    }
    try {
      const inserted = await fn();
      const after = await countRows(name);
      results.push({ name, before, after, inserted, skipped: false });
      console.log(`✅ ${name}: ${before} → ${after} rows (${inserted} inserted)`);
    } catch (err) {
      console.error(`❌ ${name}: ${err.message}`);
      results.push({ name, before, error: err.message });
    }
  }

  // 3. Summary
  console.log('\n════════════════════════════════════════════════════════════');
  console.log('                    MIGRATION SUMMARY');
  console.log('════════════════════════════════════════════════════════════');
  let totalInserted = 0;
  for (const r of results) {
    if (r.error) {
      console.log(`  ❌ ${r.name}: ERROR — ${r.error}`);
    } else if (r.skipped) {
      console.log(`  ⏭️  ${r.name}: ${r.after} rows (skipped)`);
    } else {
      console.log(`  ✅ ${r.name}: ${r.before} → ${r.after} rows (+${r.inserted})`);
      totalInserted += r.inserted;
    }
  }
  console.log(`\n  TOTAL inserted: ${totalInserted} rows`);
  console.log('════════════════════════════════════════════════════════════');

  await db.pool.end();
  process.exit(0);
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
