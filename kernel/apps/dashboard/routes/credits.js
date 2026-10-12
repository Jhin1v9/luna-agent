const express = require('express');

module.exports = function(dataStore, { requireAuth }) {
  const router = express.Router();

  // ── Helpers ──

  async function ensureCredits(clientId) {
    let c = await dataStore.getClientCredits(clientId);
    if (!c) {
      c = await dataStore.saveClientCredits({
        clientId, balance: 0, totalAssigned: 0, totalConsumed: 0, totalReserved: 0, rollover: 0
      });
    }
    return c;
  }

  // ================================================================
  // RUTAS PÚBLICAS (cliente) — solo lectura
  // ================================================================

  // ── Planes disponibles ──

  router.get('/plans', async (req, res) => {
    try {
      const plans = await dataStore.getCreditPlans();
      res.json({ ok: true, plans });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Saldo del cliente ──

  router.get('/client/:clientId/balance', async (req, res) => {
    try {
      const credits = await ensureCredits(req.params.clientId);
      const subs = await dataStore.getClientSubscriptions(req.params.clientId);
      const plans = await dataStore.getCreditPlans();
      const sub = subs[0] || null;
      const plan = sub ? plans.find(p => p.id === sub.planId) : null;
      // Calcular próximos créditos del plan si hay suscripción activa
      const nextAssignment = sub && sub.status === 'active' && plan
        ? { date: sub.currentPeriodEnd, amount: plan.creditsPerMonth } : null;
      res.json({ ok: true, credits, subscription: sub, plan, nextAssignment });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Historial completo de transacciones (cliente y admin) ──

  router.get('/client/:clientId/transactions', async (req, res) => {
    try {
      const txs = await dataStore.getCreditTransactions(req.params.clientId, req.query);
      // Agrupar por mes para vista mensual
      const byMonth = {};
      for (const tx of txs) {
        const m = tx.createdAt ? tx.createdAt.substring(0, 7) : 'unknown';
        if (!byMonth[m]) byMonth[m] = { month: m, transactions: [], totalAssigned: 0, totalConsumed: 0, totalReserved: 0 };
        byMonth[m].transactions.push(tx);
        if (tx.type === 'asignacion' || tx.type === 'rollover') byMonth[m].totalAssigned += tx.amount;
        else if (tx.type === 'consumo') byMonth[m].totalConsumed += Math.abs(tx.amount);
        else if (tx.type === 'reserva') byMonth[m].totalReserved += Math.abs(tx.amount);
      }
      const months = Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month));
      res.json({ ok: true, transactions: txs, groupedByMonth: months });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Suscripción del cliente (solo lectura) ──

  router.get('/client/:clientId/subscription', async (req, res) => {
    try {
      const subs = await dataStore.getClientSubscriptions(req.params.clientId);
      const plans = await dataStore.getCreditPlans();
      const sub = subs[0] || null;
      const plan = sub ? plans.find(p => p.id === sub.planId) : null;
      res.json({ ok: true, subscription: sub, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ================================================================
  // RUTAS DE ADMIN — requieren autenticación
  // ================================================================

  // ── Dashboard: todos los clientes con resumen de créditos ──

  router.get('/admin/clients', requireAuth, async (req, res) => {
    try {
      // Get all credit records directly
      const allCredits = await dataStore.getAllClientCredits();
      const allTickets = await dataStore.getAllServiceTickets();
      const plans = await dataStore.getCreditPlans();
      const result = [];
      for (const creds of allCredits) {
        const subs = await dataStore.getClientSubscriptions(creds.clientId);
        const sub = subs[0] || null;
        const plan = sub ? plans.find(p => p.id === sub.planId) : null;
        const clientTickets = allTickets.filter(t => t.clientId === creds.clientId);
        result.push({
          clientId: creds.clientId,
          credits: { balance: creds.balance, totalAssigned: creds.totalAssigned, totalConsumed: creds.totalConsumed, totalReserved: creds.totalReserved },
          subscription: sub ? { planId: sub.planId, planName: plan?.name || sub.planId, status: sub.status, periodEnd: sub.currentPeriodEnd } : null,
          tickets: { pending: clientTickets.filter(t => t.status === 'pendiente').length, active: clientTickets.filter(t => t.status === 'aprobado' || t.status === 'en_progreso').length }
        });
      }
      res.json({ ok: true, clients: result });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Ajustar créditos (admin: añade o quita) ──

  router.post('/admin/client/:clientId/adjust', requireAuth, async (req, res) => {
    try {
      const { amount, description, referenceType, referenceId } = req.body;
      if (amount === undefined || amount === 0) return res.status(400).json({ ok: false, error: 'amount required (positive=add, negative=remove)' });

      let credits = await ensureCredits(req.params.clientId);
      const newBalance = credits.balance + amount;
      if (newBalance < 0) return res.status(400).json({ ok: false, error: 'Resultaría en saldo negativo', currentBalance: credits.balance, attemptedAdjust: amount });

      // Update counters
      const update = { ...credits, balance: newBalance };
      if (amount > 0) update.totalAssigned = credits.totalAssigned + amount;
      // For negative adjustments, we don't reduce totalAssigned — log as separate stat
      const updated = await dataStore.saveClientCredits(update);

      const txType = amount > 0 ? 'asignacion' : 'ajuste';
      const tx = await dataStore.saveCreditTransaction({
        clientId: req.params.clientId, type: txType, amount,
        balanceAfter: newBalance,
        description: description || (amount > 0 ? 'Asignación administrativa' : 'Ajuste administrativo'),
        referenceType: referenceType || 'admin', referenceId: referenceId || null,
        createdBy: req.user?.id || 'admin'
      });

      res.json({ ok: true, credits: updated, transaction: tx });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Historial de cliente con filtros (admin) ──

  router.get('/admin/client/:clientId/transactions', requireAuth, async (req, res) => {
    try {
      const { type, from, to, limit } = req.query;
      const filters = {};
      if (type) filters.type = type;
      if (limit) filters.limit = parseInt(limit);
      let txs = await dataStore.getCreditTransactions(req.params.clientId, filters);
      if (from) txs = txs.filter(t => t.createdAt >= from);
      if (to) txs = txs.filter(t => t.createdAt <= to + 'T23:59:59Z');
      // Agrupar por mes
      const byMonth = {};
      for (const tx of txs) {
        const m = tx.createdAt ? tx.createdAt.substring(0, 7) : 'unknown';
        if (!byMonth[m]) byMonth[m] = { month: m, transactions: [], totalAssigned: 0, totalConsumed: 0, totalAdjusted: 0 };
        byMonth[m].transactions.push(tx);
        if (tx.type === 'asignacion' || tx.type === 'rollover') byMonth[m].totalAssigned += tx.amount;
        else if (tx.type === 'consumo') byMonth[m].totalConsumed += Math.abs(tx.amount);
        else if (tx.type === 'ajuste') byMonth[m].totalAdjusted += tx.amount;
      }
      res.json({ ok: true, transactions: txs, groupedByMonth: Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month)) });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Asignación mensual automática (admin trigger) ──

  router.post('/admin/auto-assign-monthly', requireAuth, async (req, res) => {
    try {
      const { clientId } = req.body; // opcional: si se omite, asigna a todos
      const plans = await dataStore.getCreditPlans();
      const allSubs = clientId
        ? await dataStore.getClientSubscriptions(clientId)
        : await dataStore.getClientSubscriptions('__all__');

      // Como getClientSubscriptions es por clientId, necesitamos obtener todas
      let subsToProcess = [];
      // Obtenemos clientes con suscripciones activas
      if (clientId) {
        const s = await dataStore.getClientSubscriptions(clientId);
        subsToProcess = s.filter(s => s.status === 'active');
      } else {
        const allCredits = await dataStore.getAllClientCredits();
        for (const c of allCredits) {
          const s = await dataStore.getClientSubscriptions(c.clientId);
          for (const sub of s.filter(s => s.status === 'active')) {
            subsToProcess.push(sub);
          }
        }
      }

      const results = [];
      for (const sub of subsToProcess) {
        const plan = plans.find(p => p.id === sub.planId);
        if (!plan || plan.creditsPerMonth <= 0) continue;

        const credits = await ensureCredits(sub.clientId);
        const newBalance = credits.balance + plan.creditsPerMonth;
        await dataStore.saveClientCredits({
          ...credits, balance: newBalance, totalAssigned: credits.totalAssigned + plan.creditsPerMonth
        });
        const tx = await dataStore.saveCreditTransaction({
          clientId: sub.clientId, type: 'asignacion', amount: plan.creditsPerMonth,
          balanceAfter: newBalance,
          description: `Asignación mensual - Plan ${plan.name} (${plan.creditsPerMonth} créditos)`,
          referenceType: 'plan', referenceId: sub.planId, createdBy: 'system'
        });
        results.push({ clientId: sub.clientId, planId: sub.planId, creditsAssigned: plan.creditsPerMonth, transaction: tx.id });
      }

      res.json({ ok: true, assigned: results.length, results });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Crear/actualizar plan (admin) ──

  router.post('/admin/plans', requireAuth, async (req, res) => {
    try {
      const plan = await dataStore.saveCreditPlan(req.body);
      res.json({ ok: true, plan });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Asignar suscripción a cliente (admin) ──

  router.post('/admin/client/:clientId/subscription', requireAuth, async (req, res) => {
    try {
      const { planId, autoRenew, hostingAddon } = req.body;
      const sub = await dataStore.saveClientSubscription({
        clientId: req.params.clientId, planId, autoRenew,
        hostingAddon, status: 'active'
      });
      res.json({ ok: true, subscription: sub });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Resumen global (admin) ──

  router.get('/admin/summary', requireAuth, async (req, res) => {
    try {
      const allCredits = await dataStore.getAllClientCredits();
      const allTickets = await dataStore.getAllServiceTickets();
      let totalBalance = 0, totalReserved = 0, totalConsumed = 0, totalAssigned = 0;
      for (const creds of allCredits) {
        totalBalance += creds.balance;
        totalReserved += creds.totalReserved;
        totalConsumed += creds.totalConsumed;
        totalAssigned += creds.totalAssigned;
      }
      res.json({
        ok: true, summary: {
          clientsWithCredits: allCredits.length,
          totalBalance, totalReserved, totalConsumed, totalAssigned,
          pendingTickets: allTickets.filter(t => t.status === 'pendiente' || t.status === 'cotizado').length,
          activeTickets: allTickets.filter(t => t.status === 'aprobado' || t.status === 'en_progreso').length
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ================================================================
  // PERFIL UNIFICADO (cliente + admin)
  // ================================================================

  // ── Perfil completo del cliente (público / solo lectura) ──

  router.get('/client/:clientId/profile', async (req, res) => {
    try {
      const { clientId } = req.params;
      const org = await dataStore.getPrismaOrganization(clientId);
      const plans = await dataStore.getCreditPlans();

      // Credits from our system
      const credits = await dataStore.getClientCredits(clientId) || { balance: 0, totalAssigned: 0, totalConsumed: 0, totalReserved: 0, rollover: 0 };

      // Subscription
      const subs = await dataStore.getClientSubscriptions(clientId);
      const sub = subs[0] || null;
      const creditPlan = sub ? plans.find(p => p.id === sub.planId) : null;
      const nextAssignment = sub && sub.status === 'active' && creditPlan
        ? { date: sub.currentPeriodEnd, amount: creditPlan.creditsPerMonth } : null;

      // Projects
      const projects = org ? await dataStore.getPrismaProjectsByOrg(clientId) : [];

      // Contracts
      const contracts = org ? await dataStore.getPrismaContractsByOrg(clientId) : [];

      // Requests (service tickets from workspace cliente)
      const requests = org ? await dataStore.getPrismaRequestsByOrg(clientId) : [];

      // Our service tickets
      const tickets = await dataStore.getServiceTickets(clientId);

      // Users (team members from this org)
      const users = org ? await dataStore.getPrismaWorkspaceUsersByOrg(clientId) : [];

      // Recent credit transactions (last 20)
      const txs = await dataStore.getCreditTransactions(clientId, { limit: 20 });

      res.json({
        ok: true,
        profile: {
          organization: org ? { id: org.id, name: org.name, slug: org.slug, domain: org.domain, status: org.status, plan: org.plan, settings: org.settings } : { id: clientId },
          credits,
          subscription: sub ? { planId: sub.planId, planName: creditPlan?.name || sub.planId, status: sub.status, periodEnd: sub.currentPeriodEnd, autoRenew: sub.autoRenew } : null,
          creditPlan,
          nextAssignment,
          projects: projects.map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status, url: p.url })),
          contracts: contracts.map(c => ({ id: c.id, title: c.title, status: c.status, signedAt: c.signedAt, expiresAt: c.expiresAt })),
          requests: requests.map(r => ({ id: r.id, content: r.content.substring(0, 200), status: r.status, createdAt: r.createdAt })),
          tickets: tickets.map(t => ({ id: t.id, title: t.title, status: t.status, estimatedCredits: t.estimatedCredits, priority: t.priority, createdAt: t.createdAt })),
          teamUsers: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, isStaff: u.isNexoStaff, userCredits: u.credits })),
          recentTransactions: txs
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Admin: perfil completo + edición de créditos ──

  router.get('/admin/client/:clientId/profile', requireAuth, async (req, res) => {
    try {
      const { clientId } = req.params;

      // Same as client profile
      const org = await dataStore.getPrismaOrganization(clientId);
      const plans = await dataStore.getCreditPlans();
      const credits = await dataStore.getClientCredits(clientId) || { balance: 0, totalAssigned: 0, totalConsumed: 0, totalReserved: 0, rollover: 0 };
      const subs = await dataStore.getClientSubscriptions(clientId);
      const sub = subs[0] || null;
      const creditPlan = sub ? plans.find(p => p.id === sub.planId) : null;
      const projects = org ? await dataStore.getPrismaProjectsByOrg(clientId) : [];
      const contracts = org ? await dataStore.getPrismaContractsByOrg(clientId) : [];
      const tickets = await dataStore.getServiceTickets(clientId);
      const users = org ? await dataStore.getPrismaWorkspaceUsersByOrg(clientId) : [];

      // All transactions (full history)
      const allTxs = await dataStore.getCreditTransactions(clientId);

      // Internal team credit usage (isNexoStaff)
      const staffUsers = users.filter(u => u.isNexoStaff);
      let internalCreditsUsed = 0;
      for (const su of staffUsers) {
        const staffTxs = await dataStore.getPrismaCreditTransactions({ userId: su.id, type: 'usage' });
        for (const stx of staffTxs) {
          if (stx.amount < 0) internalCreditsUsed += Math.abs(stx.amount);
        }
      }
      // Also count team consumption from our credit_transactions
      const teamTxs = await dataStore.getCreditTransactions(clientId, { type: 'consumo_team' });

      res.json({
        ok: true,
        profile: {
          organization: org ? { id: org.id, name: org.name, slug: org.slug, domain: org.domain, status: org.status, plan: org.plan, settings: org.settings } : { id: clientId },
          credits,
          subscription: sub ? { planId: sub.planId, planName: creditPlan?.name || sub.planId, status: sub.status, periodEnd: sub.currentPeriodEnd, autoRenew: sub.autoRenew, hostingAddon: sub.hostingAddon } : null,
          creditPlan,
          nextAssignment: sub && sub.status === 'active' && creditPlan ? { date: sub.currentPeriodEnd, amount: creditPlan.creditsPerMonth } : null,
          projects: projects.map(p => ({ id: p.id, name: p.name, type: p.type, status: p.status, url: p.url })),
          contracts: contracts.map(c => ({ id: c.id, title: c.title, status: c.status, signedAt: c.signedAt, expiresAt: c.expiresAt })),
          tickets: tickets.map(t => ({ id: t.id, title: t.title, status: t.status, estimatedCredits: t.estimatedCredits, actualCredits: t.actualCredits, priority: t.priority, createdAt: t.createdAt })),
          teamUsers: users.map(u => ({ id: u.id, name: u.name, email: u.email, role: u.role, isStaff: u.isNexoStaff, userCredits: u.credits })),
          creditHistory: allTxs,
          internalCredits: { used: internalCreditsUsed, teamTransactions: teamTxs }
        }
      });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Admin: log team credit usage (no descuenta del cliente) ──

  router.post('/admin/client/:clientId/team-usage', requireAuth, async (req, res) => {
    try {
      const { userId, amount, description, projectId } = req.body;
      if (!userId || !amount || amount >= 0) return res.status(400).json({ ok: false, error: 'userId and negative amount required' });

      // Log in Prisma CreditTransaction (user-level, not client)
      const tx = await dataStore.savePrismaCreditTransaction({
        userId, projectId, amount,
        description: description || 'Trabajo interno del team',
        type: 'usage'
      });

      // Also log in our system for visibility
      const allTickets = await dataStore.getAllServiceTickets();
      const clientId = req.params.clientId;
      let credits = await dataStore.getClientCredits(clientId);
      const tx2 = await dataStore.saveCreditTransaction({
        clientId, type: 'consumo_team', amount,
        balanceAfter: credits ? credits.balance : 0,
        description: `[INTERNO] ${description || 'Trabajo del team'}`,
        referenceType: 'team', referenceId: userId,
        createdBy: req.user?.id || 'admin'
      });

      res.json({ ok: true, transaction: tx, log: tx2 });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
