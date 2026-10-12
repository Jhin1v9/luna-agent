/**
 * NEXO Dashboard — PostgreSQL-Only Datastore
 * ZERO fallback to JSON. PostgreSQL is the single source of truth.
 * Schema 1:1 with server.js — zero adapters, zero translation.
 */
const db = require('./db');

// ── FATAL: No PostgreSQL, no service ──
if (!process.env.DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL is not defined.');
  console.warn('   PostgreSQL is the only supported persistence layer.');
  console.warn('   Set DATABASE_URL and restart the server.');
  console.warn('   Falling back to JSON datastore.');
  // Export a dummy module that throws on any operation
  module.exports = new Proxy({}, {
    get: () => () => { throw new Error('DATABASE_URL not configured'); }
  });
  return;
}

// ── Change notification hook (for WebSocket broadcasts) ──
let changeCallback = null;
function onChange(callback) { changeCallback = callback; }
function notifyChange(entity, data) {
  if (typeof changeCallback === 'function') {
    try { changeCallback(entity, data); } catch (e) {
      console.error('[datastore-pg] Change notification error:', e.message);
    }
  }
}

// ============================================================
// USERS
// ============================================================
async function getUsers() {
  const rows = await db.query('SELECT id, name, role, color, password, discord_id, created_at, updated_at FROM users');
  const users = {};
  rows.forEach(r => {
    users[r.id] = {
      name: r.name,
      role: r.role,
      color: r.color,
      password: r.password,
      discordId: r.discord_id,
      createdAt: r.created_at,
      updatedAt: r.updated_at
    };
  });
  return { users, active: 'abner' };
}

async function saveUser(id, userData) {
  await db.run(
    `INSERT INTO users (id, name, role, color, password, discord_id, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, COALESCE($7, NOW()), COALESCE($8, NOW()))
     ON CONFLICT (id) DO UPDATE SET
       name = $2, role = $3, color = $4, password = $5, discord_id = $6,
       updated_at = NOW()`,
    [id, userData.name, userData.role, userData.color, userData.password,
     userData.discordId || null, userData.createdAt, userData.updatedAt]
  );
  notifyChange('users', await getUsers());
}

// ============================================================
// TASKS
// ============================================================
async function getTasks() {
  const rows = await db.query('SELECT * FROM tasks ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id, title: r.title, description: r.description, status: r.status,
    priority: r.priority, taskType: r.task_type, dueDate: r.due_date,
    addedBy: r.added_by, assignedTo: r.assigned_to, source: r.source,
    comments: r.comments || [], createdAt: r.created_at, updatedAt: r.updated_at,
    startedAt: r.started_at, completedAt: r.completed_at
  }));
}

async function saveTask(task) {
  await db.run(
    `INSERT INTO tasks (id, title, description, status, priority, task_type, due_date, added_by, assigned_to, source, comments, created_at, updated_at, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       title=$2, description=$3, status=$4, priority=$5, task_type=$6,
       due_date=$7, added_by=$8, assigned_to=$9, source=$10, comments=$11,
       updated_at=$13, started_at=$14, completed_at=$15`,
    [task.id, task.title, task.description, task.status, task.priority, task.taskType,
     task.dueDate, task.addedBy, task.assignedTo, task.source,
     JSON.stringify(task.comments || []), task.createdAt, task.updatedAt,
     task.startedAt, task.completedAt]
  );
  notifyChange('tasks', await getTasks());
  return task;
}

async function deleteTask(taskId) {
  await db.run('DELETE FROM tasks WHERE id=$1', [taskId]);
  notifyChange('tasks', await getTasks());
  return true;
}

// ============================================================
// COMPANY TASKS
// ============================================================
async function getCompanyTasks() {
  const rows = await db.query('SELECT * FROM company_tasks ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id, title: r.title, description: r.description, status: r.status,
    priority: r.priority, taskType: r.task_type, dueDate: r.due_date,
    addedBy: r.added_by, assignedTo: r.assigned_to, source: r.source,
    linkedRoadmapId: r.source_roadmap_id, linkedTimelineId: r.source_timeline_id,
    comments: r.comments || [], createdAt: r.created_at, updatedAt: r.updated_at,
    startedAt: r.started_at, completedAt: r.completed_at
  }));
}

async function saveCompanyTask(task) {
  await db.run(
    `INSERT INTO company_tasks (id, title, description, status, priority, task_type, due_date, added_by, assigned_to, source, source_roadmap_id, source_timeline_id, metadata, comments, created_at, updated_at, started_at, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (id) DO UPDATE SET
       title=$2, description=$3, status=$4, priority=$5, task_type=$6,
       due_date=$7, added_by=$8, assigned_to=$9, source=$10, source_roadmap_id=$11, source_timeline_id=$12,
       metadata=$13, comments=$14, updated_at=$16, started_at=$17, completed_at=$18`,
    [task.id, task.title, task.description, task.status, task.priority, task.taskType,
     task.dueDate, task.addedBy, task.assignedTo, task.source,
     task.linkedRoadmapId || null, task.linkedTimelineId || null,
     JSON.stringify(task.metadata || {}),
     JSON.stringify(task.comments || []), task.createdAt, task.updatedAt,
     task.startedAt, task.completedAt]
  );
  notifyChange('companyTasks', await getCompanyTasks());
  return task;
}

async function deleteCompanyTask(id) {
  await db.run('DELETE FROM company_tasks WHERE id=$1', [id]);
  notifyChange('companyTasks', await getCompanyTasks());
  return true;
}

// ============================================================
// PAYMENTS (schema real do server.js — NOMES REAIS)
// ============================================================
async function getPayments() {
  const rows = await db.query('SELECT * FROM payments ORDER BY created_at DESC');
  return rows.map(r => ({
    paymentId: r.payment_id, id: r.id, clientId: r.client_id,
    clientName: r.client_name, clientShortName: r.client_short_name,
    projectName: r.project_name, projectId: r.project_id,
    description: r.description, totalAmount: r.total_amount,
    equivalentEUR: r.equivalent_eur, status: r.status,
    paymentTerms: r.payment_terms, methodPreferred: r.method_preferred,
    methodAccepted: r.method_accepted, revenueSplit: r.revenue_split,
    transactions: r.transactions, notes: r.notes, links: r.links,
    linkedRoadmapId: r.linked_roadmap_id, linkedTimelineId: r.linked_timeline_id,
    companySharePercent: parseFloat(r.company_share_percent) || 25,
    createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function savePayment(payment) {
  await db.run(
    `INSERT INTO payments (payment_id, id, client_id, client_name, client_short_name, project_name, project_id, description, total_amount, equivalent_eur, status, payment_terms, method_preferred, method_accepted, revenue_split, transactions, notes, links, linked_roadmap_id, company_share_percent, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
     ON CONFLICT (payment_id) DO UPDATE SET
       id=$2, client_id=$3, client_name=$4, client_short_name=$5, project_name=$6,
       project_id=$7, description=$8, total_amount=$9, equivalent_eur=$10, status=$11,
       payment_terms=$12, method_preferred=$13, method_accepted=$14, revenue_split=$15,
       transactions=$16, notes=$17, links=$18, linked_roadmap_id=$19,
       company_share_percent=$20, updated_at=$22`,
    [
      payment.paymentId || payment.id, payment.id || payment.paymentId,
      payment.clientId, payment.clientName, payment.clientShortName || '',
      payment.projectName, payment.projectId, payment.description || '',
      JSON.stringify(payment.totalAmount || { value: 0, currency: 'EUR' }),
      payment.equivalentEUR ? JSON.stringify(payment.equivalentEUR) : null,
      payment.status, JSON.stringify(payment.paymentTerms || { type: 'full', splits: [] }),
      payment.methodPreferred, JSON.stringify(payment.methodAccepted || ['transfer', 'card', 'cash', 'bizum']),
      JSON.stringify(payment.revenueSplit || []),
      JSON.stringify(payment.transactions || []),
      payment.notes || '', JSON.stringify(payment.links || {}),
      payment.linkedRoadmapId || null,
      payment.companySharePercent || 25, payment.createdAt, payment.updatedAt
    ]
  );
  notifyChange('payments', await getPayments());
  return payment;
}

async function deletePayment(paymentId) {
  await db.run('DELETE FROM payments WHERE payment_id=$1', [paymentId]);
  notifyChange('payments', await getPayments());
  return true;
}

// ============================================================
// EXPENSES
// ============================================================
async function getExpenses() {
  const rows = await db.query('SELECT * FROM expenses ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    amount: { value: parseFloat(r.amount_value), currency: r.amount_currency },
    costPerPerson: { value: parseFloat(r.cost_per_person_value), currency: r.cost_per_person_currency },
    type: r.type, period: r.period, periodLabel: r.period_label,
    startDate: r.start_date, renewDate: r.renew_date, endDate: r.end_date,
    category: r.category, categoryLabel: r.category_label,
    splitAmong: r.split_among || [], paidBy: r.paid_by || {},
    fullyPaid: r.fully_paid, autoDeductFromCashBox: r.auto_deduct_from_cash_box,
    notes: r.notes, attachments: r.attachments || [],
    createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function saveExpense(expense) {
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
      expense.id, expense.name, expense.description,
      expense.amount?.value ?? expense.amount ?? 0,
      expense.amount?.currency ?? 'EUR',
      expense.costPerPerson?.value ?? 0,
      expense.costPerPerson?.currency ?? 'EUR',
      expense.type, expense.period, expense.periodLabel,
      expense.startDate, expense.renewDate, expense.endDate,
      expense.category, expense.categoryLabel,
      JSON.stringify(expense.splitAmong || []),
      JSON.stringify(expense.paidBy || {}),
      expense.fullyPaid ?? false,
      expense.autoDeductFromCashBox ?? true,
      expense.notes,
      JSON.stringify(expense.attachments || []),
      expense.createdBy, expense.createdAt, expense.updatedAt
    ]
  );
  notifyChange('expenses', await getExpenses());
  return expense;
}

async function deleteExpense(expenseId) {
  await db.run('DELETE FROM expenses WHERE id=$1', [expenseId]);
  notifyChange('expenses', await getExpenses());
  return true;
}
// ============================================================
// CASH BOX
// ============================================================
async function getCashBox() {
  const row = await db.get('SELECT * FROM cash_box WHERE id=1');
  if (!row) return {
    balance: { value: 0, currency: 'EUR' },
    monthlyIncome: { value: 0, currency: 'EUR' },
    monthlyExpenses: { value: 0, currency: 'EUR' },
    projectedBalance: { value: 0, currency: 'EUR' },
    projectionMonths: 3,
    incomingPayments: [],
    outgoingExpenses: [],
    history: [],
    lastUpdated: new Date().toISOString(),
    alerts: [],
    settings: { lowBalanceMultiplier: 2, currency: 'EUR', autoDeductRecurring: true, projectionMonths: 3 },
    auditLog: []
  };
  return {
    balance: { value: parseFloat(row.balance_value), currency: row.balance_currency },
    monthlyIncome: { value: parseFloat(row.monthly_income_value), currency: row.monthly_income_currency },
    monthlyExpenses: { value: parseFloat(row.monthly_expenses_value), currency: row.monthly_expenses_currency },
    projectedBalance: { value: parseFloat(row.projected_balance_value), currency: row.projected_balance_currency },
    projectionMonths: row.projection_months,
    incomingPayments: row.incoming_payments || [],
    outgoingExpenses: row.outgoing_expenses || [],
    history: row.history || [],
    lastUpdated: row.last_updated,
    alerts: row.alerts || [],
    settings: row.settings || { lowBalanceMultiplier: 2, currency: 'EUR', autoDeductRecurring: true, projectionMonths: 3 },
    auditLog: row.audit_log || []
  };
}

async function saveCashBox(data) {
  await db.run(
    `INSERT INTO cash_box (id, balance_value, balance_currency, monthly_income_value, monthly_income_currency, monthly_expenses_value, monthly_expenses_currency, projected_balance_value, projected_balance_currency, projection_months, incoming_payments, outgoing_expenses, history, last_updated, alerts, settings, audit_log)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       balance_value=$2, balance_currency=$3, monthly_income_value=$4, monthly_income_currency=$5,
       monthly_expenses_value=$6, monthly_expenses_currency=$7, projected_balance_value=$8,
       projected_balance_currency=$9, projection_months=$10, incoming_payments=$11,
       outgoing_expenses=$12, history=$13, last_updated=$14, alerts=$15, settings=$16, audit_log=$17`,
    [
      1,
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
  notifyChange('cashBox', await getCashBox());
  return data;
}

// ============================================================
// QUOTES (schema real — NOMES REAIS)
// ============================================================
async function getQuotes() {
  const rows = await db.query('SELECT * FROM quotes ORDER BY created_at DESC');
  return rows.map(r => ({
    quoteId: r.quote_id, id: r.id, projectId: r.project_id,
    projectName: r.project_name, clientName: r.client_name,
    clientId: r.client_id, status: r.status, statusLabel: r.status_label,
    totalAmount: r.total_amount, monthlyFee: r.monthly_fee,
    year1Investment: r.year1_investment, discountUpfront: r.discount_upfront,
    items: r.items || [], githubUrl: r.github_url,
    createdAt: r.created_at, sentAt: r.sent_at,
    validUntil: r.valid_until, updatedAt: r.updated_at
  }));
}

async function saveQuote(quote) {
  await db.run(
    `INSERT INTO quotes (quote_id, id, project_id, project_name, client_name, client_id, status, status_label, total_amount, monthly_fee, year1_investment, discount_upfront, items, github_url, created_at, sent_at, valid_until, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     ON CONFLICT (quote_id) DO UPDATE SET
       id=$2, project_id=$3, project_name=$4, client_name=$5, client_id=$6,
       status=$7, status_label=$8, total_amount=$9, monthly_fee=$10,
       year1_investment=$11, discount_upfront=$12, items=$13,
       github_url=$14, created_at=$15, sent_at=$16, valid_until=$17, updated_at=$18`,
    [
      quote.quoteId || quote.id, quote.id || quote.quoteId,
      quote.projectId, quote.projectName, quote.clientName, quote.clientId,
      quote.status, quote.statusLabel,
      JSON.stringify(quote.totalAmount || { value: 0, currency: 'EUR' }),
      JSON.stringify(quote.monthlyFee || { value: 0, currency: 'EUR' }),
      JSON.stringify(quote.year1Investment || { value: 0, currency: 'EUR' }),
      JSON.stringify(quote.discountUpfront || { percent: 0, amount: 0, currency: 'EUR' }),
      JSON.stringify(quote.items || []),
      quote.githubUrl, quote.createdAt, quote.sentAt, quote.validUntil,
      new Date().toISOString()
    ]
  );
  notifyChange('quotes', await getQuotes());
  return quote;
}

async function deleteQuote(quoteId) {
  await db.run('DELETE FROM quotes WHERE quote_id=$1', [quoteId]);
  notifyChange('quotes', await getQuotes());
  return true;
}

// ============================================================
// MEMBERS
// ============================================================
async function getMembers() {
  const rows = await db.query('SELECT * FROM members ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id, name: r.name, role: r.role, skills: r.skills || [],
    sharePercent: parseFloat(r.share_percent), status: r.status,
    projects: r.projects || [], email: r.email, phone: r.phone,
    country: r.country, joinedAt: r.joined_at, note: r.note,
    createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function saveMember(member) {
  await db.run(
    `INSERT INTO members (id, name, role, skills, share_percent, status, projects, email, phone, country, joined_at, note, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT (id) DO UPDATE SET
       name=$2, role=$3, skills=$4, share_percent=$5, status=$6,
       projects=$7, email=$8, phone=$9, country=$10, joined_at=$11,
       note=$12, updated_at=$14`,
    [member.id, member.name, member.role, JSON.stringify(member.skills || []),
     member.sharePercent, member.status, JSON.stringify(member.projects || []),
     member.email, member.phone, member.country, member.joinedAt,
     member.note, member.createdAt, member.updatedAt]
  );
  notifyChange('members', await getMembers());
  return member;
}

async function deleteMember(id) {
  await db.run('DELETE FROM members WHERE id = $1', [id]);
  notifyChange('members', await getMembers());
}

// ============================================================
// SETTINGS / GENERIC JSONB
// ============================================================
async function getSettings(key) {
  const row = await db.get('SELECT value FROM settings WHERE key=$1', [key]);
  return row?.value ?? null;
}

async function setSettings(key, value) {
  await db.run(
    'INSERT INTO settings (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=$2, updated_at=NOW()',
    [key, JSON.stringify(value)]
  );
  notifyChange('settings', { key, value });
}

// ============================================================
// IDEAS (schema real — NOMES REAIS)
// ============================================================
async function getIdeas() {
  const rows = await db.query('SELECT * FROM ideas ORDER BY created_at DESC');
  const ideas = {};
  rows.forEach(r => {
    ideas[r.id] = {
      id: r.id, title: r.title, status: r.status, type: r.type,
      priority: r.priority, linkedTo: r.linked_to,
      content: r.content, aiContext: r.ai_context,
      tags: r.tags || [], createdBy: r.created_by,
      createdByName: r.created_by_name, createdAt: r.created_at,
      updatedAt: r.updated_at, collaborators: r.collaborators || [],
      comments: r.comments || [], attachments: r.attachments || [],
      versionHistory: r.version_history || [], summary: r.summary,
      dueDate: r.due_date, assignedTo: r.assigned_to,
      convertedTo: r.converted_to
    };
  });
  return { ideas };
}

async function saveIdea(idea) {
  await db.run(
    `INSERT INTO ideas (id, title, status, type, priority, linked_to, content, ai_context, tags, created_by, created_by_name, created_at, updated_at, collaborators, comments, attachments, version_history, summary, due_date, assigned_to, converted_to)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
     ON CONFLICT (id) DO UPDATE SET
       title=$2, status=$3, type=$4, priority=$5, linked_to=$6,
       content=$7, ai_context=$8, tags=$9, created_by=$10,
       created_by_name=$11, updated_at=$13, collaborators=$14,
       comments=$15, attachments=$16, version_history=$17,
       summary=$18, due_date=$19, assigned_to=$20, converted_to=$21`,
    [idea.id, idea.title, idea.status, idea.type, idea.priority,
     JSON.stringify(idea.linkedTo || {}), JSON.stringify(idea.content || {}),
     JSON.stringify(idea.aiContext || { brainstormHistory: [], aiSuggestions: [], aiInsights: [] }),
     JSON.stringify(idea.tags || []), idea.createdBy, idea.createdByName,
     idea.createdAt, idea.updatedAt, JSON.stringify(idea.collaborators || []),
     JSON.stringify(idea.comments || []), JSON.stringify(idea.attachments || []),
     JSON.stringify(idea.versionHistory || []), idea.summary, idea.dueDate,
     idea.assignedTo, JSON.stringify(idea.convertedTo || {})]
  );
  notifyChange('ideas', await getIdeas());
  return idea;
}

async function deleteIdea(id) {
  await db.run('DELETE FROM ideas WHERE id = $1', [id]);
  notifyChange('ideas', await getIdeas());
}

// ============================================================
// LEADS (schema real — NOMES REAIS)
// ============================================================
async function getLeads() {
  const rows = await db.query('SELECT * FROM leads ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id, displayName: r.display_name, name: r.name,
    email: r.email, phone: r.phone, source: r.source,
    type: r.type, status: r.status, pipelineStatus: r.pipeline_status,
    estimatedValue: parseFloat(r.estimated_value), currency: r.currency,
    notes: r.notes, assignedTo: r.assigned_to,
    tags: r.tags || [], createdAt: r.created_at,
    lastContact: r.last_contact, convertedAt: r.converted_at
  }));
}

async function saveLead(lead) {
  await db.run(
    `INSERT INTO leads (id, display_name, name, email, phone, source, type, status, pipeline_status, estimated_value, currency, notes, assigned_to, tags, created_at, last_contact, converted_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       display_name=$2, name=$3, email=$4, phone=$5, source=$6,
       type=$7, status=$8, pipeline_status=$9, estimated_value=$10,
       currency=$11, notes=$12, assigned_to=$13, tags=$14,
       last_contact=$16, converted_at=$17`,
    [lead.id, lead.displayName, lead.name, lead.email, lead.phone,
     lead.source, lead.type, lead.status, lead.pipelineStatus,
     lead.estimatedValue, lead.currency, lead.notes, lead.assignedTo,
     JSON.stringify(lead.tags || []), lead.createdAt,
     lead.lastContact, lead.convertedAt]
  );
  notifyChange('leads', await getLeads());
  return lead;
}

async function deleteLead(id) {
  await db.run('DELETE FROM leads WHERE id=$1', [id]);
  notifyChange('leads', await getLeads());
  return true;
}

// ============================================================
// SECURITY LOGS (schema real — NOMES REAIS)
// ============================================================
async function getSecurityLogs() {
  const rows = await db.query('SELECT * FROM security_logs ORDER BY timestamp DESC');
  const events = rows.map(r => ({
    id: r.id, timestamp: r.timestamp, type: r.type,
    severity: r.severity, ip: r.ip, location: r.location,
    risk: r.risk, device: r.device, attemptedUser: r.attempted_user,
    message: r.message, notified: r.notified,
    notificationChannel: r.notification_channel,
    hasCameraPhoto: r.has_camera_photo, hasScreenshot: r.has_screenshot,
    cameraPhoto: r.camera_photo, screenshot: r.screenshot,
    intruderData: r.intruder_data
  }));
  return { version: '1.0', events };
}

async function saveSecurityLog(event) {
  await db.run(
    `INSERT INTO security_logs (id, timestamp, type, severity, ip, location, risk, device, attempted_user, message, notified, notification_channel, has_camera_photo, has_screenshot, camera_photo, screenshot, intruder_data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO NOTHING`,
    [event.id, event.timestamp, event.type, event.severity, event.ip,
     JSON.stringify(event.location || {}), JSON.stringify(event.risk || {}),
     JSON.stringify(event.device || {}), event.attemptedUser, event.message,
     event.notified ?? false, event.notificationChannel,
     event.hasCameraPhoto ?? false, event.hasScreenshot ?? false,
     event.cameraPhoto, event.screenshot, JSON.stringify(event.intruderData || {})]
  );
  notifyChange('securityLogs', await getSecurityLogs());
  return event;
}

async function deleteSecurityLog(id) {
  await db.run('DELETE FROM security_logs WHERE id=$1', [id]);
  notifyChange('securityLogs', await getSecurityLogs());
  return true;
}

// ============================================================
// NOTIFICATIONS
// ============================================================
async function getNotifications() {
  const rows = await db.query('SELECT * FROM notifications ORDER BY timestamp DESC');
  const notifications = rows.map(r => ({
    id: r.id, type: r.type, title: r.title, message: r.message,
    severity: r.severity, read: r.read, timestamp: r.timestamp,
    metadata: r.metadata || {}, createdAt: r.created_at
  }));
  return { version: '1.0', notifications };
}

async function saveNotification(n) {
  await db.run(
    `INSERT INTO notifications (id, type, title, message, severity, read, timestamp, metadata, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (id) DO UPDATE SET
       type=$2, title=$3, message=$4, severity=$5, read=$6, timestamp=$7, metadata=$8`,
    [n.id, n.type, n.title, n.message, n.severity, n.read, n.timestamp,
     JSON.stringify(n.metadata || {}), n.createdAt || n.timestamp]
  );
  notifyChange('notifications', await getNotifications());
  return n;
}

async function deleteNotification(id) {
  await db.run('DELETE FROM notifications WHERE id=$1', [id]);
  notifyChange('notifications', await getNotifications());
  return true;
}

// ============================================================
// LINKS
// ============================================================
async function getLinks() {
  const rows = await db.query('SELECT * FROM links ORDER BY created_at DESC');
  return { links: rows.map(r => ({
    id: r.id, url: r.url, author: r.author, timestamp: r.timestamp,
    chat: r.chat, notes: r.notes, manual: r.manual, preview: r.preview,
    platform: r.platform, patterns: r.patterns || [], icon: r.icon,
    color: r.color, category: r.category, label: r.label,
    hostname: r.hostname, enrichedAt: r.enriched_at, createdAt: r.created_at,
    updatedAt: r.updated_at
  })) };
}

async function saveLink(link) {
  await db.run(
    `INSERT INTO links (id, url, author, timestamp, chat, notes, manual, preview, platform, patterns, icon, color, category, label, hostname, enriched_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
     ON CONFLICT (id) DO UPDATE SET
       url=$2, author=$3, timestamp=$4, chat=$5, notes=$6, manual=$7,
       preview=$8, platform=$9, patterns=$10, icon=$11, color=$12,
       category=$13, label=$14, hostname=$15, enriched_at=$16`,
    [link.id, link.url, link.author, link.timestamp, link.chat, link.notes,
     link.manual, JSON.stringify(link.preview || {}), link.platform,
     JSON.stringify(link.patterns || []), link.icon, link.color, link.category,
     link.label, link.hostname, link.enrichedAt, link.createdAt]
  );
  notifyChange('links', await getLinks());
  return link;
}

async function deleteLink(id) {
  await db.run('DELETE FROM links WHERE id=$1', [id]);
  notifyChange('links', await getLinks());
  return true;
}

// ============================================================
// TRANSACTIONS (schema real — NOMES REAIS)
// ============================================================
async function getTransactions() {
  const rows = await db.query('SELECT * FROM transactions ORDER BY date DESC');
  return rows.map(r => ({
    id: r.id, date: r.date, type: r.type, amount: parseFloat(r.amount),
    currency: r.currency, description: r.description, category: r.category,
    balanceAfter: parseFloat(r.balance_after), recordedBy: r.recorded_by,
    recordedAt: r.recorded_at, notes: r.notes, source: r.source,
    isActive: r.is_active, deletedAt: r.deleted_at, deletedBy: r.deleted_by,
    metadata: r.metadata || {}, createdAt: r.created_at,
    createdBy: r.created_by, updatedAt: r.updated_at
  }));
}

async function saveTransaction(t) {
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
  notifyChange('transactions', await getTransactions());
  return t;
}

async function deleteTransaction(id) {
  await db.run('DELETE FROM transactions WHERE id = $1', [id]);
  notifyChange('transactions', await getTransactions());
}

// ============================================================
// CHANGELOG (schema real — NOMES REAIS)
// ============================================================
async function getChangelog() {
  const rows = await db.query('SELECT * FROM changelog ORDER BY date DESC');
  const entries = rows.map(r => ({
    id: r.id, version: r.version, title: r.title,
    description: r.description, category: r.category,
    emoji: r.emoji, author: r.author, tier: r.tier,
    date: r.date, tags: r.tags || [], readBy: r.read_by || [],
    status: r.status || '❓ STATUS NÃO AVALIADO',
    statusDetail: r.status_detail || 'Esta funcionalidade ainda não foi revisada neste ciclo de testes.'
  }));
  return { version: '1.0', lastUpdated: new Date().toISOString(), entries };
}

async function saveChangelog(entry) {
  await db.run(
    `INSERT INTO changelog (id, version, title, description, category, emoji, author, tier, date, tags, read_by, status, status_detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET
       version=$2, title=$3, description=$4, category=$5, emoji=$6,
       author=$7, tier=$8, date=$9, tags=$10, read_by=$11, status=$12, status_detail=$13`,
    [entry.id, entry.version, entry.title, entry.description, entry.category,
     entry.emoji, entry.author, entry.tier, entry.date,
     JSON.stringify(entry.tags || []), JSON.stringify(entry.readBy || []),
     entry.status || '❓ STATUS NÃO AVALIADO',
     entry.statusDetail || 'Esta funcionalidade ainda não foi revisada neste ciclo de testes.']
  );
  notifyChange('changelog', await getChangelog());
  return entry;
}

async function deleteChangelog(id) {
  await db.run('DELETE FROM changelog WHERE id = $1', [id]);
  notifyChange('changelog', await getChangelog());
}

// ============================================================
// LUNA THREADS (schema real — NOMES REAIS)
// ============================================================
async function getLunaThreads() {
  const rows = await db.query('SELECT * FROM luna_threads ORDER BY updated_at DESC');
  const threads = {};
  rows.forEach(r => {
    threads[r.id] = {
      id: r.id, type: r.type, title: r.title,
      participants: r.participants || [],
      createdAt: r.created_at, updatedAt: r.updated_at,
      messageCount: r.message_count,
      messages: r.messages || []
    };
  });
  return { version: '1.0', lastUpdated: new Date().toISOString(), threads };
}

async function saveLunaThread(thread) {
  await db.run(
    `INSERT INTO luna_threads (id, type, title, participants, created_at, updated_at, message_count, messages)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (id) DO UPDATE SET
       type=$2, title=$3, participants=$4, updated_at=$6,
       message_count=$7, messages=$8`,
    [thread.id, thread.type, thread.title, JSON.stringify(thread.participants || []),
     thread.createdAt, thread.updatedAt, thread.messageCount || 0,
     JSON.stringify(thread.messages || [])]
  );
  notifyChange('lunaThreads', await getLunaThreads());
  return thread;
}

async function saveLunaThreads(data) {
  for (const thread of Object.values(data.threads || {})) {
    await saveLunaThread(thread);
  }
  return data;
}

async function deleteLunaThread(id) {
  await db.run('DELETE FROM luna_threads WHERE id = $1', [id]);
  notifyChange('lunaThreads', await getLunaThreads());
}

// ============================================================
// LUNA BUFFER (schema real — NOMES REAIS)
// ============================================================
async function getLunaBuffer() {
  const row = await db.get('SELECT * FROM luna_buffer WHERE id=1');
  if (!row) return {
    newMessages: [], newTasks: [], newTasksDone: [],
    newIdeas: [], newDecisions: [], newLinks: [],
    newLeads: [], newFinance: [], ignoredMessages: [],
    newMentions: [], sentiment: { positive: 0, negative: 0, urgent: 0 },
    newNews: [], silenceCount: 0, fullExtractDone: false,
    lastBufferUpdate: new Date().toISOString()
  };
  return {
    newMessages: row.new_messages || [],
    newTasks: row.new_tasks || [],
    newTasksDone: row.new_tasks_done || [],
    newIdeas: row.new_ideas || [],
    newDecisions: row.new_decisions || [],
    newLinks: row.new_links || [],
    newLeads: row.new_leads || [],
    newFinance: row.new_finance || [],
    ignoredMessages: row.ignored_messages || [],
    newMentions: row.new_mentions || [],
    sentiment: row.sentiment || { positive: 0, negative: 0, urgent: 0 },
    newNews: row.new_news || [],
    silenceCount: row.silence_count || 0,
    fullExtractDone: row.full_extract_done || false,
    lastBufferUpdate: row.last_buffer_update
  };
}

async function saveLunaBuffer(data) {
  await db.run(
    `INSERT INTO luna_buffer (id, new_messages, new_tasks, new_tasks_done, new_ideas, new_decisions, new_links, new_leads, new_finance, ignored_messages, new_mentions, sentiment, new_news, silence_count, full_extract_done, last_buffer_update)
     VALUES (1,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     ON CONFLICT (id) DO UPDATE SET
       new_messages=$1, new_tasks=$2, new_tasks_done=$3, new_ideas=$4,
       new_decisions=$5, new_links=$6, new_leads=$7, new_finance=$8,
       ignored_messages=$9, new_mentions=$10, sentiment=$11, new_news=$12,
       silence_count=$13, full_extract_done=$14, last_buffer_update=$15`,
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
      JSON.stringify(data.newNews || []),
      data.silenceCount || 0,
      data.fullExtractDone || false,
      data.lastBufferUpdate || new Date().toISOString()
    ]
  );
  notifyChange('lunaBuffer', await getLunaBuffer());
  return data;
}

// ============================================================
// LUNA CHECKPOINT
// ============================================================
async function getLunaCheckpoint() {
  const row = await db.get('SELECT * FROM luna_checkpoint WHERE id=1');
  if (!row) return { knownMessageHashes: [], lastScan: null, version: '14.1' };
  return {
    knownMessageHashes: row.known_message_hashes || [],
    lastScan: row.last_scan,
    version: row.version || '14.1'
  };
}

async function saveLunaCheckpoint(data) {
  await db.run(
    `INSERT INTO luna_checkpoint (id, known_message_hashes, last_scan, version, updated_at)
     VALUES (1, $1, $2, $3, NOW())
     ON CONFLICT (id) DO UPDATE SET
       known_message_hashes = $1, last_scan = $2, version = $3, updated_at = NOW()`,
    [JSON.stringify(data.knownMessageHashes || []), data.lastScan || null, data.version || '14.1']
  );
  return data;
}

// ============================================================
// WORKSPACE CLIENTS (schema real — NOMES REAIS)
// ============================================================
async function getWorkspaceClients() {
  const rows = await db.query('SELECT * FROM workspace_clients ORDER BY criado_em DESC');
  return {
    versao: '1.0',
    ultimaAtualizacao: new Date().toISOString(),
    clientes: rows.map(r => ({
      id: r.id, nome: r.nome, caminho: r.caminho,
      status: r.status, cor: r.cor, responsavel: r.responsavel,
      tipo: r.tipo, dataInicio: r.data_inicio,
      orcamentoTotal: parseFloat(r.orcamento_total), moeda: r.moeda,
      tags: r.tags || [], anotacoes: r.anotacoes,
      criadoEm: r.criado_em, atualizadoEm: r.atualizado_em
    }))
  };
}

async function saveWorkspaceClient(client) {
  await db.run(
    `INSERT INTO workspace_clients (id, nome, caminho, status, cor, responsavel, tipo, data_inicio, orcamento_total, moeda, tags, anotacoes, versao, ultima_atualizacao, criado_em, atualizado_em)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
     ON CONFLICT (id) DO UPDATE SET
       nome=$2, caminho=$3, status=$4, cor=$5, responsavel=$6,
       tipo=$7, data_inicio=$8, orcamento_total=$9, moeda=$10,
       tags=$11, anotacoes=$12, versao=$13, ultima_atualizacao=$14,
       atualizado_em=$16`,
    [client.id, client.nome, client.caminho, client.status, client.cor,
     client.responsavel, client.tipo, client.dataInicio,
     client.orcamentoTotal, client.moeda, JSON.stringify(client.tags || []),
     client.anotacoes, '1.0', new Date().toISOString(),
     client.criadoEm, client.atualizadoEm]
  );
  notifyChange('workspaceClients', await getWorkspaceClients());
  return client;
}

async function deleteWorkspaceClient(id) {
  await db.run('DELETE FROM workspace_clients WHERE id=$1', [id]);
  notifyChange('workspaceClients', await getWorkspaceClients());
  return true;
}

// ============================================================
// PROJECT ROADMAPS
// ============================================================
async function getRoadmaps(filters = {}) {
  let sql = 'SELECT * FROM project_roadmaps WHERE deleted_at IS NULL';
  const params = [];
  let idx = 1;
  if (filters.status) { sql += ` AND status=$${idx++}`; params.push(filters.status); }
  if (filters.client_id) { sql += ` AND client_id=$${idx++}`; params.push(filters.client_id); }
  if (filters.project_type) { sql += ` AND project_type=$${idx++}`; params.push(filters.project_type); }
  sql += ' ORDER BY updated_at DESC';
  return await db.query(sql, params);
}

async function getRoadmapById(id) {
  return await db.get('SELECT * FROM project_roadmaps WHERE id=$1 AND deleted_at IS NULL', [id]);
}

async function saveRoadmap(data) {
  const existing = await db.get('SELECT id FROM project_roadmaps WHERE id=$1', [data.id]);
  if (existing) {
    await db.run(
      `UPDATE project_roadmaps SET title=$2, client_id=$3, lead_id=$4, project_type=$5,
       status=$6, total_value=$7, currency=$8, payment_schedule=$9, github_repo=$10,
       subdomain=$11, current_phase_index=$12, phases=$13, expected_end_date=$14,
       onboarding_answers=$15, updated_at=NOW() WHERE id=$1`,
      [data.id, data.title, data.client_id, data.lead_id, data.project_type,
       data.status, data.total_value, data.currency, JSON.stringify(data.payment_schedule || []),
       data.github_repo, data.subdomain, data.current_phase_index,
       JSON.stringify(data.phases || []), data.expected_end_date,
       JSON.stringify(data.onboarding_answers || {})]
    );
  } else {
    await db.run(
      `INSERT INTO project_roadmaps (id, title, client_id, lead_id, project_type, status,
       total_value, currency, payment_schedule, github_repo, subdomain, current_phase_index,
       phases, expected_end_date, onboarding_answers, created_by, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,NOW(),NOW())`,
      [data.id, data.title, data.client_id, data.lead_id, data.project_type,
       data.status, data.total_value, data.currency, JSON.stringify(data.payment_schedule || []),
       data.github_repo, data.subdomain, data.current_phase_index,
       JSON.stringify(data.phases || []), data.expected_end_date,
       JSON.stringify(data.onboarding_answers || {}), data.created_by]
    );
  }
  notifyChange('roadmaps', await getRoadmaps());
  return data;
}

async function deleteRoadmap(id) {
  await db.run('UPDATE project_roadmaps SET deleted_at=NOW() WHERE id=$1', [id]);
  notifyChange('roadmaps', await getRoadmaps());
  return true;
}

// ============================================================
// PROJECT TIMELINES
// ============================================================
async function getTimelines(roadmapId) {
  return await db.query('SELECT * FROM project_timelines WHERE roadmap_id=$1 ORDER BY created_at', [roadmapId]);
}

async function getTimelineById(id) {
  return await db.get('SELECT * FROM project_timelines WHERE id=$1', [id]);
}

async function saveTimeline(data) {
  const existing = await db.get('SELECT id FROM project_timelines WHERE id=$1', [data.id]);
  if (existing) {
    await db.run(
      `UPDATE project_timelines SET title=$2, role=$3, assigned_to=$4, parent_timeline_id=$5,
       steps=$6, current_step_index=$7, status=$8, version=version+1, updated_at=NOW()
       WHERE id=$1 AND version=$9`,
      [data.id, data.title, data.role, data.assigned_to, data.parent_timeline_id,
       JSON.stringify(data.steps || []), data.current_step_index, data.status, data.version || 1]
    );
  } else {
    await db.run(
      `INSERT INTO project_timelines (id, roadmap_id, title, role, assigned_to, parent_timeline_id,
       steps, current_step_index, status, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW(),NOW())`,
      [data.id, data.roadmap_id, data.title, data.role, data.assigned_to,
       data.parent_timeline_id, JSON.stringify(data.steps || []),
       data.current_step_index, data.status]
    );
  }
  notifyChange('timelines', await getTimelines(data.roadmap_id));
  return data;
}

// ============================================================
// TIMELINE COLLABORATORS
// ============================================================
async function getTimelineCollaborators(timelineId) {
  return await db.query(
    'SELECT * FROM timeline_collaborators WHERE timeline_id=$1 AND is_active=true ORDER BY joined_at',
    [timelineId]
  );
}

async function joinTimeline(timelineId, user) {
  await db.run(
    `INSERT INTO timeline_collaborators (id, timeline_id, user_id, user_name, user_color, joined_at, is_active)
     VALUES ($1,$2,$3,$4,$5,NOW(),true)
     ON CONFLICT (timeline_id, user_id) DO UPDATE SET left_at=NULL, is_active=true, joined_at=NOW()`,
    [`collab_${timelineId}_${user.id}`, timelineId, user.id, user.name, user.color]
  );
  notifyChange('timelineCollaborators', await getTimelineCollaborators(timelineId));
  return true;
}

async function leaveTimeline(timelineId, userId) {
  await db.run(
    'UPDATE timeline_collaborators SET left_at=NOW(), is_active=false WHERE timeline_id=$1 AND user_id=$2',
    [timelineId, userId]
  );
  notifyChange('timelineCollaborators', await getTimelineCollaborators(timelineId));
  return true;
}

// ============================================================
// ROADMAP PHASE HISTORY
// ============================================================
async function getPhaseHistory(roadmapId) {
  return await db.query('SELECT * FROM roadmap_phase_history WHERE roadmap_id=$1 ORDER BY changed_at DESC', [roadmapId]);
}

async function savePhaseHistory(data) {
  await db.run(
    `INSERT INTO roadmap_phase_history (id, roadmap_id, from_index, to_index, changed_by, changed_at, reason)
     VALUES ($1,$2,$3,$4,$5,NOW(),$6)`,
    [data.id, data.roadmap_id, data.from_index, data.to_index, data.changed_by, data.reason]
  );
  return data;
}

// ============================================================
// PROJECT TYPE TEMPLATES
// ============================================================
async function getProjectTypeTemplates() {
  return await db.query('SELECT * FROM project_type_templates ORDER BY name');
}

async function getProjectTypeTemplate(projectType) {
  return await db.get('SELECT * FROM project_type_templates WHERE project_type=$1', [projectType]);
}

// ============================================================
// SECURITY SETTINGS
// ============================================================
async function getSecuritySettings() {
  const row = await db.get('SELECT * FROM security_settings WHERE id=$1', ['default']);
  if (!row) return { settings: { maxAttemptsBeforeAlert: 1 }, version: '1.0', lastNotifiedAt: null };
  return {
    settings: row.settings || {},
    version: row.version || '1.0',
    lastNotifiedAt: row.last_notified_at
  };
}

async function saveSecuritySettings(data) {
  await db.run(
    `INSERT INTO security_settings (id, settings, version, last_notified_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT (id) DO UPDATE SET
       settings = $2, version = $3, last_notified_at = $4, updated_at = NOW()`,
    [data.id || 'default', JSON.stringify(data.settings || {}), data.version || '1.0', data.lastNotifiedAt || null]
  );
  return data;
}

// ============================================================
// TRUSTED IPs
// ============================================================
async function getTrustedIps() {
  const rows = await db.query('SELECT * FROM trusted_ips ORDER BY user_key');
  const trusted = {};
  rows.forEach(r => {
    trusted[r.user_key] = {
      name: r.name,
      role: r.role,
      ips: r.ips || [],
      autoCapture: r.auto_capture,
      notes: r.notes
    };
  });
  return { trusted, updatedAt: rows[0]?.updated_at };
}

async function saveTrustedIp(userKey, data) {
  await db.run(
    `INSERT INTO trusted_ips (id, user_key, name, role, ips, auto_capture, notes, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (user_key) DO UPDATE SET
       name = $3, role = $4, ips = $5, auto_capture = $6, notes = $7, updated_at = NOW()`,
    [data.id || `ceo-${userKey}`, userKey, data.name, data.role, JSON.stringify(data.ips || []), data.autoCapture !== false, data.notes || '']
  );
  return data;
}

// ============================================================
// EMAIL DRAFTS
// ============================================================
async function getEmailDrafts() {
  const rows = await db.query('SELECT * FROM email_drafts ORDER BY created_at DESC');
  return rows.map(r => ({
    id: r.id,
    emailId: r.email_id,
    threadId: r.thread_id,
    subject: r.subject,
    body: r.body,
    notes: r.notes,
    tone: r.tone,
    status: r.status,
    to: r.to_recipient,
    createdBy: r.created_by,
    approvedBy: r.approved_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }));
}

async function saveEmailDraft(draft) {
  await db.run(
    `INSERT INTO email_drafts (id, email_id, thread_id, subject, body, notes, tone, status, to_recipient, created_by, approved_by, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, COALESCE($12, NOW()), NOW())
     ON CONFLICT (id) DO UPDATE SET
       subject = $4, body = $5, notes = $6, tone = $7, status = $8, to_recipient = $9,
       approved_by = $11, updated_at = NOW()`,
    [draft.id, draft.emailId || null, draft.threadId || null, draft.subject || '', draft.body || '',
     draft.notes || '', draft.tone || 'professional', draft.status || 'pending', draft.to || null,
     draft.createdBy || 'luna', draft.approvedBy || null, draft.createdAt || null]
  );
  return draft;
}

async function deleteEmailDraft(id) {
  await db.run('DELETE FROM email_drafts WHERE id=$1', [id]);
  return true;
}

// ============================================================
// VOTING
// ============================================================
async function getVotingSessions() {
  const rows = await db.query("SELECT * FROM voting_sessions WHERE status != 'deleted' ORDER BY created_at DESC");
  return rows.map(r => ({
    id: r.id,
    title: r.title,
    description: r.description,
    type: r.type,
    toolName: r.tool_name,
    toolParams: r.tool_params || {},
    status: r.status,
    quorumRequired: r.quorum_required,
    createdBy: r.created_by,
    createdAt: r.created_at,
    closedAt: r.closed_at,
    result: r.result,
    executionResult: r.execution_result,
    updatedAt: r.updated_at
  }));
}

async function getVotingSessionById(id) {
  const row = await db.get('SELECT * FROM voting_sessions WHERE id=$1', [id]);
  if (!row) return null;
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    type: row.type,
    toolName: row.tool_name,
    toolParams: row.tool_params || {},
    status: row.status,
    quorumRequired: row.quorum_required,
    createdBy: row.created_by,
    createdAt: row.created_at,
    closedAt: row.closed_at,
    result: row.result,
    executionResult: row.execution_result,
    updatedAt: row.updated_at
  };
}

async function saveVotingSession(session) {
  await db.run(
    `INSERT INTO voting_sessions (id, title, description, type, tool_name, tool_params, status, quorum_required, created_by, created_at, closed_at, result, execution_result, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()), $11, $12, $13, NOW())
     ON CONFLICT (id) DO UPDATE SET
       title = $2, description = $3, type = $4, tool_name = $5, tool_params = $6, status = $7,
       quorum_required = $8, closed_at = $11, result = $12, execution_result = $13, updated_at = NOW()`,
    [session.id, session.title, session.description || '', session.type || 'generic', session.toolName || null,
     JSON.stringify(session.toolParams || {}), session.status || 'open', session.quorumRequired || 2,
     session.createdBy || null, session.createdAt || null, session.closedAt || null,
     session.result || null, JSON.stringify(session.executionResult || {})]
  );
  return session;
}

async function getVotingVotes(sessionId) {
  const rows = await db.query('SELECT * FROM voting_votes WHERE session_id=$1 ORDER BY voted_at', [sessionId]);
  return rows.map(r => ({
    id: r.id,
    sessionId: r.session_id,
    voter: r.voter,
    vote: r.vote,
    comment: r.comment,
    votedAt: r.voted_at
  }));
}

async function saveVotingVote(vote) {
  await db.run(
    `INSERT INTO voting_votes (id, session_id, voter, vote, comment, voted_at)
     VALUES ($1, $2, $3, $4, $5, COALESCE($6, NOW()))
     ON CONFLICT (id) DO UPDATE SET
       vote = $4, comment = $5`,
    [vote.id, vote.sessionId, vote.voter, vote.vote, vote.comment || '', vote.votedAt || null]
  );
  return vote;
}

// ============================================================
// OPS STATE
// ============================================================
async function getOpsState() {
  const row = await db.get('SELECT * FROM ops_state WHERE id=$1', ['default']);
  if (!row) return { alerts: [], activeOperations: [], recentChanges: [], systemHealth: { status: 'ok' } };
  return {
    alerts: row.alerts || [],
    activeOperations: row.active_operations || [],
    recentChanges: row.recent_changes || [],
    systemHealth: row.system_health || { status: 'ok' }
  };
}

async function saveOpsState(data) {
  await db.run(
    `INSERT INTO ops_state (id, alerts, active_operations, recent_changes, system_health, updated_at)
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE SET
       alerts = $2, active_operations = $3, recent_changes = $4, system_health = $5, updated_at = NOW()`,
    [data.id || 'default', JSON.stringify(data.alerts || []), JSON.stringify(data.activeOperations || []),
     JSON.stringify(data.recentChanges || []), JSON.stringify(data.systemHealth || { status: 'ok' })]
  );
  return data;
}

// ============================================================
// CREDIT PLANS
// ============================================================
async function getCreditPlans() {
  const rows = await db.query('SELECT * FROM credit_plans ORDER BY price_monthly ASC');
  return rows.map(r => ({
    id: r.id, name: r.name, description: r.description,
    priceMonthly: parseFloat(r.price_monthly),
    creditsPerMonth: r.credits_per_month,
    hostingIncluded: r.hosting_included,
    supportLevel: r.support_level,
    features: r.features || [],
    active: r.active,
    createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function saveCreditPlan(plan) {
  await db.run(
    `INSERT INTO credit_plans (id, name, description, price_monthly, credits_per_month, hosting_included, support_level, features, active, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),NOW())
     ON CONFLICT (id) DO UPDATE SET
       name=$2, description=$3, price_monthly=$4, credits_per_month=$5,
       hosting_included=$6, support_level=$7, features=$8, active=$9, updated_at=NOW()`,
    [plan.id, plan.name, plan.description || '', plan.priceMonthly || 0, plan.creditsPerMonth || 0,
     plan.hostingIncluded || false, plan.supportLevel || 'basic',
     JSON.stringify(plan.features || []), plan.active !== false,
     plan.createdAt]
  );
  notifyChange('credit_plans', await getCreditPlans());
  return plan;
}

// ============================================================
// CLIENT CREDITS
// ============================================================
async function getClientCredits(clientId) {
  const row = await db.get('SELECT * FROM client_credits WHERE client_id=$1', [clientId]);
  if (!row) return null;
  return {
    clientId: row.client_id,
    balance: row.balance,
    totalAssigned: row.total_assigned,
    totalConsumed: row.total_consumed,
    totalReserved: row.total_reserved,
    rollover: row.rollover,
    autoReloadThreshold: row.auto_reload_threshold,
    autoReloadAmount: row.auto_reload_amount,
    lastReloadedAt: row.last_reloaded_at,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

async function saveClientCredits(data) {
  await db.run(
    `INSERT INTO client_credits (client_id, balance, total_assigned, total_consumed, total_reserved, rollover, auto_reload_threshold, auto_reload_amount, last_reloaded_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       balance=$2, total_assigned=$3, total_consumed=$4, total_reserved=$5, rollover=$6,
       auto_reload_threshold=$7, auto_reload_amount=$8, last_reloaded_at=$9, updated_at=NOW()`,
    [data.clientId, data.balance || 0, data.totalAssigned || 0, data.totalConsumed || 0,
     data.totalReserved || 0, data.rollover || 0, data.autoReloadThreshold || null,
     data.autoReloadAmount || null, data.lastReloadedAt || null, data.createdAt]
  );
  notifyChange('client_credits', await getClientCredits(data.clientId));
  return data;
}

// ============================================================
// CREDIT TRANSACTIONS
// ============================================================
async function getCreditTransactions(clientId, filters = {}) {
  let sql = 'SELECT * FROM credit_transactions WHERE client_id=$1';
  const params = [clientId];
  if (filters.type) { sql += ' AND type=$2'; params.push(filters.type); }
  sql += ' ORDER BY created_at DESC';
  if (filters.limit) { sql += ` LIMIT ${parseInt(filters.limit)}`; }
  const rows = await db.query(sql, params);
  return rows.map(r => ({
    id: r.id, clientId: r.client_id, type: r.type, amount: r.amount,
    balanceAfter: r.balance_after, description: r.description,
    referenceType: r.reference_type, referenceId: r.reference_id,
    createdBy: r.created_by,
    createdAt: r.created_at ? (typeof r.created_at === 'string' ? r.created_at : r.created_at.toISOString()) : null
  }));
}

async function saveCreditTransaction(tx) {
  const row = await db.get(
    `INSERT INTO credit_transactions (client_id, type, amount, balance_after, description, reference_type, reference_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [tx.clientId, tx.type, tx.amount, tx.balanceAfter, tx.description || '',
     tx.referenceType || null, tx.referenceId || null, tx.createdBy || null]
  );
  notifyChange('credit_transactions', row);
  return {
    id: row.id, clientId: row.client_id, type: row.type, amount: row.amount,
    balanceAfter: row.balance_after, description: row.description,
    referenceType: row.reference_type, referenceId: row.reference_id,
    createdBy: row.created_by, createdAt: row.created_at
  };
}

// ============================================================
// CLIENT SUBSCRIPTIONS
// ============================================================
async function getClientSubscriptions(clientId) {
  const rows = await db.query('SELECT * FROM client_subscriptions WHERE client_id=$1 ORDER BY created_at DESC', [clientId]);
  return rows.map(r => ({
    id: r.id, clientId: r.client_id, planId: r.plan_id, status: r.status,
    currentPeriodStart: r.current_period_start, currentPeriodEnd: r.current_period_end,
    autoRenew: r.auto_renew, hostingAddon: r.hosting_addon,
    cancelledAt: r.cancelled_at, createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function saveClientSubscription(sub) {
  await db.run(
    `INSERT INTO client_subscriptions (id, client_id, plan_id, status, current_period_start, current_period_end, auto_renew, hosting_addon, cancelled_at, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,COALESCE($10,NOW()),NOW())
     ON CONFLICT (client_id) DO UPDATE SET
       plan_id=$3, status=$4, current_period_start=$5, current_period_end=$6,
       auto_renew=$7, hosting_addon=$8, cancelled_at=$9, updated_at=NOW()`,
    [sub.id || require('crypto').randomUUID(), sub.clientId, sub.planId, sub.status || 'active',
     sub.currentPeriodStart || new Date().toISOString().split('T')[0],
     sub.currentPeriodEnd || new Date(Date.now() + 30*86400000).toISOString().split('T')[0],
     sub.autoRenew !== false, sub.hostingAddon || false, sub.cancelledAt || null, sub.createdAt]
  );
  notifyChange('client_subscriptions', await getClientSubscriptions(sub.clientId));
  return sub;
}

// ============================================================
// SERVICE TICKETS
// ============================================================
async function getServiceTickets(clientId, filters = {}) {
  let sql = 'SELECT * FROM service_tickets WHERE client_id=$1';
  const params = [clientId];
  if (filters.status) { sql += ' AND status=$2'; params.push(filters.status); }
  sql += ' ORDER BY created_at DESC';
  const rows = await db.query(sql, params);
  return rows.map(r => ({
    id: r.id, clientId: r.client_id, title: r.title, description: r.description,
    category: r.category, estimatedCredits: r.estimated_credits, actualCredits: r.actual_credits,
    status: r.status, priority: r.priority,
    creditTransactionId: r.credit_transaction_id,
    assignedTo: r.assigned_to, adminNotes: r.admin_notes, clientNotes: r.client_notes,
    completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function getAllClientCredits() {
  const rows = await db.query('SELECT * FROM client_credits ORDER BY client_id');
  return rows.map(r => ({
    clientId: r.client_id, balance: r.balance,
    totalAssigned: r.total_assigned, totalConsumed: r.total_consumed,
    totalReserved: r.total_reserved, rollover: r.rollover,
    createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function getAllServiceTickets(filters = {}) {
  let sql = 'SELECT * FROM service_tickets';
  const conditions = [];
  const params = [];
  if (filters.status) { conditions.push(`status=$${params.length + 1}`); params.push(filters.status); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY created_at DESC';
  const rows = await db.query(sql, params);
  return rows.map(r => ({
    id: r.id, clientId: r.client_id, title: r.title,
    description: r.description, category: r.category,
    estimatedCredits: r.estimated_credits, actualCredits: r.actual_credits,
    status: r.status, priority: r.priority,
    creditTransactionId: r.credit_transaction_id,
    assignedTo: r.assigned_to, adminNotes: r.admin_notes, clientNotes: r.client_notes,
    completedAt: r.completed_at, createdAt: r.created_at, updatedAt: r.updated_at
  }));
}

async function saveServiceTicket(ticket) {
  if (ticket.id) {
    await db.run(
      `UPDATE service_tickets SET title=$2, description=$3, category=$4, estimated_credits=$5,
       actual_credits=$6, status=$7, priority=$8, credit_transaction_id=$9, assigned_to=$10,
       admin_notes=$11, client_notes=$12, completed_at=$13, updated_at=NOW()
       WHERE id=$1`,
      [ticket.id, ticket.title, ticket.description || '', ticket.category || 'general',
       ticket.estimatedCredits || 0, ticket.actualCredits || 0, ticket.status || 'pendiente',
       ticket.priority || 'normal', ticket.creditTransactionId || null,
       ticket.assignedTo || null, ticket.adminNotes || '', ticket.clientNotes || '',
       ticket.completedAt || null]
    );
  } else {
    const row = await db.get(
      `INSERT INTO service_tickets (client_id, title, description, category, estimated_credits, status, priority, client_notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [ticket.clientId, ticket.title, ticket.description || '', ticket.category || 'general',
       ticket.estimatedCredits || 0, ticket.status || 'pendiente', ticket.priority || 'normal',
       ticket.clientNotes || '']
    );
    ticket.id = row.id;
    ticket.createdAt = row.created_at;
  }
  notifyChange('service_tickets', await getServiceTickets(ticket.clientId));
  return ticket;
}

async function deleteServiceTicket(ticketId) {
  await db.run('DELETE FROM service_tickets WHERE id=$1', [ticketId]);
  return true;
}

// ============================================================
// PRISMA-COMPATIBLE QUERIES (read-only — tables managed by Prisma)
// ============================================================

async function getPrismaOrganization(orgId) {
  const row = await db.get('SELECT * FROM "Organization" WHERE id=$1', [orgId]);
  if (!row) return null;
  return { id: row.id, slug: row.slug, name: row.name, domain: row.domain, status: row.status, plan: row.plan, isWorkspaceOwner: row.isWorkspaceOwner, settings: row.settings, createdAt: row.createdAt, updatedAt: row.updatedAt, archivedAt: row.archivedAt };
}

async function getPrismaOrganizations() {
  const rows = await db.query('SELECT * FROM "Organization" ORDER BY name');
  return rows.map(r => ({ id: r.id, slug: r.slug, name: r.name, domain: r.domain, status: r.status, plan: r.plan, isWorkspaceOwner: r.isWorkspaceOwner, settings: r.settings, createdAt: r.createdAt, updatedAt: r.updatedAt, archivedAt: r.archivedAt }));
}

async function getPrismaProjectsByOrg(orgId) {
  const rows = await db.query('SELECT * FROM "Project" WHERE "organizationId"=$1 AND status != \'ARCHIVED\' ORDER BY name', [orgId]);
  return rows.map(r => ({ id: r.id, name: r.name, type: r.type, description: r.description, url: r.url, status: r.status, organizationId: r.organizationId, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

async function getPrismaContractsByOrg(orgId) {
  const rows = await db.query(
    'SELECT c.* FROM "Contract" c JOIN "Project" p ON c."projectId" = p.id WHERE p."organizationId"=$1 ORDER BY c."createdAt" DESC',
    [orgId]
  );
  return rows.map(r => ({ id: r.id, projectId: r.projectId, title: r.title, content: r.content, status: r.status, signedAt: r.signedAt, signedBy: r.signedBy, expiresAt: r.expiresAt, createdAt: r.createdAt, updatedAt: r.updatedAt }));
}

async function getPrismaRequestsByOrg(orgId) {
  const rows = await db.query(
    'SELECT r.* FROM "Request" r JOIN "Project" p ON r."projectId" = p.id WHERE p."organizationId"=$1 ORDER BY r."createdAt" DESC',
    [orgId]
  );
  return rows.map(r => ({ id: r.id, content: r.content, status: r.status, projectId: r.projectId, organizationId: r.organizationId, externalId: r.externalId, createdAt: r.createdAt, updatedAt: r.updatedAt, closedAt: r.closedAt }));
}

async function getPrismaWorkspaceUsersByOrg(orgId) {
  const rows = await db.query('SELECT * FROM "WorkspaceUser" WHERE "organizationId"=$1 ORDER BY name', [orgId]);
  return rows.map(r => ({ id: r.id, email: r.email, name: r.name, role: r.role, status: r.status, credits: r.credits, isNexoStaff: r.isNexoStaff, organizationId: r.organizationId, createdAt: r.createdAt }));
}

async function getPrismaTeamMembersByProject(projectId) {
  const rows = await db.query('SELECT * FROM "TeamMember" WHERE "projectId"=$1', [projectId]);
  return rows.map(r => ({ id: r.id, projectId: r.projectId, name: r.name, role: r.role, email: r.email }));
}

// ── Prisma CreditTransactions (per-user) ──

async function getPrismaCreditTransactions(filters = {}) {
  let sql = 'SELECT * FROM "CreditTransaction"';
  const conditions = [];
  const params = [];
  if (filters.userId) { conditions.push(`"userId"=$${params.length + 1}`); params.push(filters.userId); }
  if (filters.projectId) { conditions.push(`"projectId"=$${params.length + 1}`); params.push(filters.projectId); }
  if (filters.type) { conditions.push(`type=$${params.length + 1}`); params.push(filters.type); }
  if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY "createdAt" DESC';
  if (filters.limit) sql += ` LIMIT ${parseInt(filters.limit)}`;
  const rows = await db.query(sql, params);
  return rows.map(r => ({ id: r.id, userId: r.userId, projectId: r.projectId, requestId: r.requestId, amount: r.amount, description: r.description, type: r.type, createdAt: r.createdAt }));
}

async function savePrismaCreditTransaction(tx) {
  const row = await db.get(
    `INSERT INTO "CreditTransaction" (id, "userId", "projectId", "requestId", amount, description, type, "createdAt")
     VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING *`,
    [tx.id || require('crypto').randomUUID(), tx.userId, tx.projectId || null, tx.requestId || null,
     tx.amount, tx.description || '', tx.type || 'usage']
  );
  return { id: row.id, userId: row.userId, projectId: row.projectId, requestId: row.requestId,
    amount: row.amount, description: row.description, type: row.type, createdAt: row.createdAt };
}

// ============================================================
// EXPORTS
// ============================================================
module.exports = {
  onChange,
  getUsers, saveUser,
  getTasks, saveTask, deleteTask,
  getCompanyTasks, saveCompanyTask, deleteCompanyTask,
  getPayments, savePayment, deletePayment,
  getExpenses, saveExpense, deleteExpense,
  getCashBox, saveCashBox,
  getQuotes, saveQuote, deleteQuote,
  getMembers, saveMember, deleteMember,
  getSettings, setSettings,
  getIdeas, saveIdea, deleteIdea,
  getLeads, saveLead, deleteLead,
  getSecurityLogs, saveSecurityLog, deleteSecurityLog,
  getNotifications, saveNotification, deleteNotification,
  getLinks, saveLink, deleteLink,
  getTransactions, saveTransaction, deleteTransaction,
  getChangelog, saveChangelog, deleteChangelog,
  getLunaThreads, saveLunaThread, saveLunaThreads, deleteLunaThread,
  getLunaBuffer, saveLunaBuffer,
  getLunaCheckpoint, saveLunaCheckpoint,
  getWorkspaceClients, saveWorkspaceClient, deleteWorkspaceClient,
  getRoadmaps, getRoadmapById, saveRoadmap, deleteRoadmap,
  getTimelines, getTimelineById, saveTimeline,
  getTimelineCollaborators, joinTimeline, leaveTimeline,
  getPhaseHistory, savePhaseHistory,
  getProjectTypeTemplates, getProjectTypeTemplate,
  getSecuritySettings, saveSecuritySettings,
  getTrustedIps, saveTrustedIp,
  getEmailDrafts, saveEmailDraft, deleteEmailDraft,
  getVotingSessions, getVotingSessionById, saveVotingSession, getVotingVotes, saveVotingVote,
  getOpsState, saveOpsState,
  getCreditPlans, saveCreditPlan,
  getClientCredits, saveClientCredits,
  getCreditTransactions, saveCreditTransaction,
  getClientSubscriptions, saveClientSubscription,
  getServiceTickets, getAllServiceTickets, saveServiceTicket, deleteServiceTicket,
  getAllClientCredits,
  getPrismaOrganization, getPrismaOrganizations, getPrismaProjectsByOrg,
  getPrismaContractsByOrg, getPrismaRequestsByOrg,
  getPrismaWorkspaceUsersByOrg, getPrismaTeamMembersByProject,
  getPrismaCreditTransactions, savePrismaCreditTransaction,
};
