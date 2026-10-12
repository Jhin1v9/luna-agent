#!/usr/bin/env node
/**
 * NEXO Dashboard — JSON to PostgreSQL Migration Script (Batch Optimized)
 * Reads all JSON data files and inserts into PostgreSQL tables.
 * Usage: DATABASE_URL=postgresql://... node migrate-json-to-sql.js
 */
const fs = require('fs');
const path = require('path');
const db = require('../db');

const DATA_DIR = path.join(__dirname, '..', 'data');

function readJSON(filename, defaultValue = null) {
  const p = path.join(DATA_DIR, filename);
  if (!fs.existsSync(p)) return defaultValue;
  try {
    return JSON.parse(fs.readFileSync(p, 'utf-8'));
  } catch {
    return defaultValue;
  }
}

/**
 * Batch insert helper — inserts multiple rows in a single query.
 */
async function batchInsert(table, columns, rows, transformRow) {
  if (!rows || rows.length === 0) return 0;
  const BATCH_SIZE = 100;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const values = [];
    const params = [];
    let paramIdx = 1;
    for (const row of batch) {
      const transformed = transformRow ? transformRow(row) : row;
      if (!transformed) continue;
      const placeholders = transformed.map(() => `$${paramIdx++}`);
      values.push(`(${placeholders.join(',')})`);
      params.push(...transformed);
    }
    if (values.length === 0) continue;
    const sql = `INSERT INTO ${table} (${columns.join(',')}) VALUES ${values.join(',')} ON CONFLICT DO NOTHING`;
    try {
      const client = await db.pool.connect();
      try {
        await client.query(sql, params);
        inserted += values.length;
      } finally {
        client.release();
      }
    } catch (err) {
      console.error(`  ✗ Batch insert failed for ${table}:`, err.message);
      throw err;
    }
  }
  return inserted;
}

// ============================================================
// 1. USERS
// ============================================================
async function migrateUsers() {
  const data = readJSON('users.json');
  if (!data?.users) return;
  const rows = Object.entries(data.users).map(([id, u]) => [id, u.name, u.role, u.color, u.password]);
  await batchInsert('users', ['id','name','role','color','password'], rows);
  console.log('  ✓ users');
}

// ============================================================
// 2. TASKS
// ============================================================
async function migrateTasks() {
  const data = readJSON('tasks.json', []);
  const rows = data.map(t => [
    t.id, t.title, t.description, t.status, t.priority, t.taskType,
    t.dueDate, t.addedBy, t.assignedTo, t.source,
    JSON.stringify(t.comments || []),
    t.createdAt, t.updatedAt, t.startedAt, t.completedAt
  ]);
  await batchInsert('tasks', ['id','title','description','status','priority','task_type','due_date','added_by','assigned_to','source','comments','created_at','updated_at','started_at','completed_at'], rows);
  console.log(`  ✓ tasks (${data.length})`);
}

// ============================================================
// 3. COMPANY TASKS
// ============================================================
async function migrateCompanyTasks() {
  const data = readJSON('company-tasks.json');
  let tasks = [];
  if (Array.isArray(data)) {
    tasks = data;
  } else if (data?.categories) {
    for (const cat of Object.values(data.categories)) {
      if (cat?.tasks && Array.isArray(cat.tasks)) tasks.push(...cat.tasks);
    }
  }
  const rows = tasks.map(t => [
    t.id, t.title, t.description, t.status, t.priority || t.frequencyCode || 'one_time',
    t.taskType || t.frequencyCode || 'one_time',
    t.dueDate, t.addedBy || t.owner, t.assignedTo || t.owner, t.source || 'manual',
    JSON.stringify(t.comments || t.subtasks || []),
    t.createdAt || data?.metadata?.generatedAt, t.updatedAt, t.startedAt, t.completedAt
  ]);
  await batchInsert('company_tasks', ['id','title','description','status','priority','task_type','due_date','added_by','assigned_to','source','comments','created_at','updated_at','started_at','completed_at'], rows);
  console.log(`  ✓ company_tasks (${tasks.length})`);
}

// ============================================================
// 4. IDEAS
// ============================================================
async function migrateIdeas() {
  const data = readJSON('ideas-registry.json');
  if (!data) return;
  const ideas = [];
  if (Array.isArray(data.ideas)) ideas.push(...data.ideas);
  for (const [key, val] of Object.entries(data)) {
    if (key.startsWith('idea-') && val && typeof val === 'object') ideas.push(val);
  }
  const rows = ideas.map(i => [
    i.id || i.ideaId || `idea-${Date.now()}`, i.title, i.summary, i.status, i.category,
    i.priority, i.author, JSON.stringify(i.tags || []), JSON.stringify(i.blocks || []),
    JSON.stringify(i.metadata || {}), i.createdAt, i.updatedAt
  ]);
  await batchInsert('ideas', ['id','title','summary','status','category','priority','author','tags','blocks','metadata','created_at','updated_at'], rows);
  console.log(`  ✓ ideas (${ideas.length})`);
}

// ============================================================
// 5. PAYMENTS
// ============================================================
async function migratePayments() {
  const data = readJSON('payments.json', []);
  const rows = data.map(p => [
    p.id || p.paymentId, p.name, p.clientId, p.clientName, p.projectId, p.projectName,
    p.amount?.value ?? p.amount ?? 0, p.amount?.currency ?? 'EUR',
    p.status, p.dueDate, p.paidDate, JSON.stringify(p.installments || []),
    p.notes, p.createdBy, p.createdAt, p.updatedAt
  ]);
  await batchInsert('payments', ['id','name','client_id','client_name','project_id','project_name','amount_value','amount_currency','status','due_date','paid_date','installments','notes','created_by','created_at','updated_at'], rows);
  console.log(`  ✓ payments (${data.length})`);
}

// ============================================================
// 6. EXPENSES
// ============================================================
async function migrateExpenses() {
  const data = readJSON('expenses.json', []);
  const rows = data.map(e => [
    e.id, e.name, e.description,
    e.amount?.value ?? e.amount ?? 0, e.amount?.currency ?? 'EUR',
    e.costPerPerson?.value ?? 0, e.costPerPerson?.currency ?? 'EUR',
    e.type, e.period, e.periodLabel, e.startDate, e.renewDate, e.endDate,
    e.category, e.categoryLabel, JSON.stringify(e.splitAmong || []),
    JSON.stringify(e.paidBy || {}), e.fullyPaid ?? false,
    e.autoDeductFromCashBox ?? true, e.notes,
    JSON.stringify(e.attachments || []), e.createdBy, e.createdAt, e.updatedAt
  ]);
  await batchInsert('expenses', ['id','name','description','amount_value','amount_currency','cost_per_person_value','cost_per_person_currency','type','period','period_label','start_date','renew_date','end_date','category','category_label','split_among','paid_by','fully_paid','auto_deduct_from_cash_box','notes','attachments','created_by','created_at','updated_at'], rows);
  console.log(`  ✓ expenses (${data.length})`);
}

// ============================================================
// 7. CASH BOX
// ============================================================
async function migrateCashBox() {
  const data = readJSON('cash-box.json');
  if (!data) return;
  await db.run(
    `INSERT INTO cash_box (id,balance_value,balance_currency,monthly_income_value,monthly_income_currency,monthly_expenses_value,monthly_expenses_currency,projected_balance_value,projected_balance_currency,projection_months,incoming_payments,outgoing_expenses,history,last_updated)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO NOTHING`,
    [
      1,
      data.balance?.value ?? data.balance ?? 0, data.balance?.currency ?? 'EUR',
      data.monthlyIncome?.value ?? 0, data.monthlyIncome?.currency ?? 'EUR',
      data.monthlyExpenses?.value ?? 0, data.monthlyExpenses?.currency ?? 'EUR',
      data.projectedBalance?.value ?? 0, data.projectedBalance?.currency ?? 'EUR',
      data.projectionMonths ?? 3,
      JSON.stringify(data.incomingPayments || []),
      JSON.stringify(data.outgoingExpenses || []),
      JSON.stringify(data.history || []),
      data.lastUpdated
    ]
  );
  console.log('  ✓ cash_box');
}

// ============================================================
// 8. QUOTES
// ============================================================
async function migrateQuotes() {
  const data = readJSON('quotes.json', []);
  const rows = data.map(q => [
    q.quoteId || q.id, q.projectId, q.projectName, q.clientName, q.clientId,
    q.status, q.statusLabel,
    q.totalAmount?.value ?? 0, q.totalAmount?.currency ?? 'EUR',
    q.monthlyFee?.value ?? 0, q.monthlyFee?.currency ?? 'EUR',
    q.year1Investment?.value ?? 0, q.year1Investment?.currency ?? 'EUR',
    q.discountUpfront?.percent ?? q.discount?.percent ?? 0,
    q.discountUpfront?.amount ?? q.discount?.amount ?? 0,
    q.discountUpfront?.currency ?? q.discount?.currency ?? 'EUR',
    q.createdAt, q.sentAt, q.validUntil, q.githubUrl,
    JSON.stringify(q.items || []), new Date().toISOString()
  ]);
  await batchInsert('quotes', ['id','project_id','project_name','client_name','client_id','status','status_label','total_amount_value','total_amount_currency','monthly_fee_value','monthly_fee_currency','year1_investment_value','year1_investment_currency','discount_percent','discount_amount','discount_currency','created_at','sent_at','valid_until','github_url','items','updated_at'], rows);
  console.log(`  ✓ quotes (${data.length})`);
}

// ============================================================
// 9. LEADS
// ============================================================
async function migrateLeads() {
  const data = readJSON('leads.json');
  const leads = Array.isArray(data) ? data : (data?.leads || []);
  const rows = leads.map(l => [
    l.id || l.leadId, l.name, l.email, l.phone, l.company,
    l.source, l.status, l.notes, JSON.stringify(l.metadata || {}),
    l.createdAt, l.updatedAt
  ]);
  await batchInsert('leads', ['id','name','email','phone','company','source','status','notes','metadata','created_at','updated_at'], rows);
  console.log(`  ✓ leads (${leads.length})`);
}

// ============================================================
// 10. MEMBERS
// ============================================================
async function migrateMembers() {
  const data = readJSON('members.json', []);
  const rows = data.map(m => [
    m.id, m.name, m.role, JSON.stringify(m.skills || []),
    m.sharePercent ?? 0, m.status, JSON.stringify(m.projects || []),
    m.email, m.phone, m.country, m.joinedAt, m.note,
    m.createdAt ?? new Date().toISOString(),
    m.updatedAt ?? new Date().toISOString()
  ]);
  await batchInsert('members', ['id','name','role','skills','share_percent','status','projects','email','phone','country','joined_at','note','created_at','updated_at'], rows);
  console.log(`  ✓ members (${data.length})`);
}

// ============================================================
// 11. TRANSACTIONS
// ============================================================
async function migrateTransactions() {
  const data = readJSON('transactions.json', []);
  const rows = data.map(t => [
    t.id, t.date, t.type, t.amount, t.description, t.category,
    t.balanceAfter, t.recordedBy, t.recordedAt, t.note, t.source,
    t.isActive ?? true, t.deletedAt, t.deletedBy,
    JSON.stringify(t.metadata || {})
  ]);
  await batchInsert('transactions', ['id','date','type','amount','description','category','balance_after','recorded_by','recorded_at','note','source','is_active','deleted_at','deleted_by','metadata'], rows);
  console.log(`  ✓ transactions (${data.length})`);
}

// ============================================================
// 12. LINKS
// ============================================================
async function migrateLinks() {
  const data = readJSON('links-index.json');
  const links = data?.links || data || [];
  const rows = links.map(l => {
    let ts = l.timestamp;
    if (typeof ts === 'number') {
      ts = new Date(ts > 9999999999 ? ts : ts * 1000).toISOString();
    }
    return [
      l.id, l.url, l.author, ts, l.chat, l.notes,
      l.manual ?? false, JSON.stringify(l.preview || {}),
      l.platform, JSON.stringify(l.patterns || []),
      l.icon, l.color, l.category, l.label, l.hostname,
      l.enrichedAt, l.createdAt
    ];
  });
  await batchInsert('links', ['id','url','author','timestamp','chat','notes','manual','preview','platform','patterns','icon','color','category','label','hostname','enriched_at','created_at'], rows);
  console.log(`  ✓ links (${links.length})`);
}

// ============================================================
// 13. CHANGELOG
// ============================================================
async function migrateChangelog() {
  const data = readJSON('changelog.json');
  const entries = data?.entries || data || [];
  const rows = entries.map(e => [
    e.id || e.changelogId, e.version, e.title, e.description,
    e.category, e.emoji, e.author, e.tier, e.date,
    JSON.stringify(e.tags || []), JSON.stringify(e.readBy || []), e.date
  ]);
  await batchInsert('changelog', ['id','version','title','description','category','emoji','author','tier','date','tags','read_by','created_at'], rows);
  console.log(`  ✓ changelog (${entries.length})`);
}

// ============================================================
// 14. NOTIFICATIONS
// ============================================================
async function migrateNotifications() {
  const data = readJSON('notifications.json');
  const notifs = data?.notifications || data || [];
  const rows = notifs.map(n => [
    n.id || n.notifId, n.type, n.title, n.message,
    n.severity, n.read ?? false, n.timestamp,
    JSON.stringify(n.metadata || {}), n.timestamp
  ]);
  await batchInsert('notifications', ['id','type','title','message','severity','read','timestamp','metadata','created_at'], rows);
  console.log(`  ✓ notifications (${notifs.length})`);
}

// ============================================================
// 15. SECURITY LOGS
// ============================================================
async function migrateSecurityLogs() {
  const data = readJSON('security-log.json');
  const events = data?.events || data || [];
  const rows = events.map(e => [
    e.id || e.eventId, e.type || e.eventType,
    e.attemptedUser || e.userId, e.ip,
    e.location ? (typeof e.location === 'string' ? e.location : `${e.location.city || ''}, ${e.location.country || ''}`) : '',
    e.device?.userAgent || e.userAgent, e.success ?? false,
    JSON.stringify({ device: e.device, severity: e.severity, notified: e.notified, message: e.message }),
    e.timestamp
  ]);
  await batchInsert('security_logs', ['id','event_type','user_id','ip','location','user_agent','success','details','created_at'], rows);
  console.log(`  ✓ security_logs (${events.length})`);
}

// ============================================================
// 16. WHATSAPP HISTORY
// ============================================================
async function migrateWhatsAppHistory() {
  const data = readJSON('whatsapp-history.json', []);
  const rows = data.map(m => [
    m.id || m.messageId, m.chatId || m.chat, m.chatName,
    m.sender || m.author, m.text || m.message || m.body, m.timestamp,
    m.type || 'text',
    JSON.stringify({ classification: m.classification, direction: m.direction, resolvedAuthor: m.resolvedAuthor }),
    m.timestamp
  ]);
  await batchInsert('whatsapp_history', ['id','chat_id','chat_name','sender','message','timestamp','type','metadata','created_at'], rows);
  console.log(`  ✓ whatsapp_history (${data.length})`);
}

// ============================================================
// 17. LUNA THREADS
// ============================================================
async function migrateLunaThreads() {
  const data = readJSON('luna-chat-threads.json');
  const threads = data?.threads ? Object.values(data.threads) : (Array.isArray(data) ? data : []);
  const rows = threads.map(t => [
    t.id, t.participants?.[0] || t.userId, t.title,
    JSON.stringify(t.messages || []),
    JSON.stringify({ type: t.type, participants: t.participants, messageCount: t.messageCount }),
    t.createdAt, t.updatedAt
  ]);
  await batchInsert('luna_threads', ['id','user_id','title','messages','context','created_at','updated_at'], rows);
  console.log(`  ✓ luna_threads (${threads.length})`);
}

// ============================================================
// 18. LUNA BUFFER
// ============================================================
async function migrateLunaBuffer() {
  const data = readJSON('luna-buffer.json');
  if (!data) return;
  await db.run(
    `INSERT INTO luna_buffer (id,data,updated_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
    [1, JSON.stringify(data), new Date().toISOString()]
  );
  console.log('  ✓ luna_buffer');
}

// ============================================================
// 19. SETTINGS
// ============================================================
async function migrateWorkspaceClients() {
  const data = readJSON('workspace-index.json');
  const clients = data?.clientes || [];
  const rows = clients.map(c => [
    c.id, c.nome, c.caminho, c.status, c.cor, c.responsavel,
    c.tipo || 'cliente', c.dataInicio,
    c.orcamentoTotal ?? 0, c.moeda || 'EUR',
    JSON.stringify(c.tags || []), c.anotacoes || '',
    JSON.stringify(c.metadata || {}), c.criadoEm, c.atualizadoEm
  ]);
  await batchInsert('workspace_clients', ['id','name','path','status','color','responsavel','tipo','data_inicio','orcamento_total','moeda','tags','anotacoes','metadata','criado_em','atualizado_em'], rows);
  console.log(`  ✓ workspace_clients (${clients.length})`);
}

async function migrateSettings() {
  const configs = [
    { key: 'payment_config', file: 'payment-config.json' },
    { key: 'auto_config', file: 'auto-config.json' },
    { key: 'alerts', file: 'alerts.json' },
    { key: 'access_requests', file: 'access-requests.json' },
    { key: 'access_users', file: 'access-users.json' },
    { key: 'github_users', file: 'github_users.json' },
    { key: 'vercel_users', file: 'vercel_users.json' },
    { key: 'unified_feed_config', file: 'unified-feed-config.json' },
    { key: 'report_history', file: 'report-history.json' },
    { key: 'full_extract', file: 'full-extract.json' },
  ];
  let count = 0;
  for (const cfg of configs) {
    const data = readJSON(cfg.file);
    if (data !== null) {
      await db.run(
        `INSERT INTO settings (key,value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()`,
        [cfg.key, JSON.stringify(data)]
      );
      count++;
    }
  }
  console.log(`  ✓ settings (${count})`);
}

// ============================================================
// MAIN
// ============================================================
async function main() {
  console.log('🚀 Starting JSON → PostgreSQL migration...\n');
  const start = Date.now();

  try {
    const health = await db.healthCheck();
    if (!health.ok) {
      console.error('❌ Database connection failed:', health.error);
      process.exit(1);
    }
    console.log('✅ Database connected:', health.now);

    console.log('\n📤 Migrating data...');
    await migrateUsers();
    await migrateTasks();
    await migrateCompanyTasks();
    await migrateIdeas();
    await migratePayments();
    await migrateExpenses();
    await migrateCashBox();
    await migrateQuotes();
    await migrateLeads();
    await migrateMembers();
    await migrateTransactions();
    await migrateLinks();
    await migrateChangelog();
    await migrateNotifications();
    await migrateSecurityLogs();
    await migrateWhatsAppHistory();
    await migrateLunaThreads();
    await migrateLunaBuffer();
    await migrateWorkspaceClients();
    await migrateSettings();

    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`\n✅ Migration completed in ${elapsed}s`);
  } catch (err) {
    console.error('\n❌ Migration failed:', err.message);
    console.error(err.stack);
    process.exit(1);
  } finally {
    await db.pool.end();
  }
}

main();
