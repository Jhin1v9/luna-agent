const express = require('express');

module.exports = function(dataStore, { requireAuth }) {
  const router = express.Router();

  // ── Listar tickets del cliente ──

  router.get('/client/:clientId', async (req, res) => {
    try {
      const tickets = await dataStore.getServiceTickets(req.params.clientId, req.query);
      res.json({ ok: true, tickets });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Listar todos los tickets (admin) ──

  router.get('/all', requireAuth, async (req, res) => {
    try {
      const tickets = await dataStore.getAllServiceTickets(req.query);
      res.json({ ok: true, tickets });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Crear ticket (cliente) ──

  router.post('/', async (req, res) => {
    try {
      const { clientId, title, description, category, priority } = req.body;
      if (!clientId || !title) return res.status(400).json({ ok: false, error: 'clientId and title required' });

      const ticket = await dataStore.saveServiceTicket({
        clientId, title, description, category, priority, status: 'pendiente'
      });

      res.json({ ok: true, ticket });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Cotizar ticket (asigna créditos estimados) ──

  router.post('/:id/quote', requireAuth, async (req, res) => {
    try {
      const { estimatedCredits } = req.body;
      if (!estimatedCredits || estimatedCredits <= 0) return res.status(400).json({ ok: false, error: 'estimatedCredits > 0 required' });

      const tickets = await dataStore.getAllServiceTickets();
      const ticket = tickets.find(t => t.id === req.params.id);
      if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });

      ticket.estimatedCredits = estimatedCredits;
      ticket.status = 'cotizado';
      const updated = await dataStore.saveServiceTicket(ticket);
      res.json({ ok: true, ticket: updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Aprobar ticket (cliente confirma, reserva créditos) ──

  router.post('/:id/approve', async (req, res) => {
    try {
      const tickets = await dataStore.getAllServiceTickets();
      const ticket = tickets.find(t => t.id === req.params.id);
      if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });

      const creditsModule = require('./credits');
      // Simulate credit reservation via direct call
      const { saveClientCredits, getClientCredits, saveCreditTransaction } = dataStore;

      let credits = await getClientCredits(ticket.clientId);
      if (!credits || credits.balance < ticket.estimatedCredits) {
        return res.status(400).json({
          ok: false, error: 'Saldo insuficiente',
          available: credits?.balance || 0, required: ticket.estimatedCredits
        });
      }

      const newBalance = credits.balance - ticket.estimatedCredits;
      await saveClientCredits({
        ...credits, balance: newBalance, totalReserved: credits.totalReserved + ticket.estimatedCredits
      });

      const tx = await saveCreditTransaction({
        clientId: ticket.clientId, type: 'reserva', amount: -ticket.estimatedCredits,
        balanceAfter: newBalance, description: `Reserva para: ${ticket.title}`,
        referenceType: 'ticket', referenceId: ticket.id, createdBy: ticket.clientId
      });

      ticket.status = 'aprobado';
      ticket.creditTransactionId = tx.id;
      const updated = await dataStore.saveServiceTicket(ticket);
      res.json({ ok: true, ticket: updated, transaction: tx });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  // ── Admin: cambiar estado ──

  router.put('/:id/status', requireAuth, async (req, res) => {
    try {
      const { status, actualCredits, assignedTo } = req.body;
      const tickets = await dataStore.getAllServiceTickets();
      const ticket = tickets.find(t => t.id === req.params.id);
      if (!ticket) return res.status(404).json({ ok: false, error: 'Ticket no encontrado' });

      ticket.status = status || ticket.status;
      if (actualCredits !== undefined) ticket.actualCredits = actualCredits;
      if (assignedTo) ticket.assignedTo = assignedTo;
      if (status === 'completado') {
        ticket.completedAt = new Date().toISOString();
        // If credits were reserved, consume them
        if (ticket.estimatedCredits > 0) {
          const credits = await dataStore.getClientCredits(ticket.clientId);
          if (credits) {
            const consumeAmount = actualCredits || ticket.estimatedCredits;
            const newReserved = Math.max(0, credits.totalReserved - ticket.estimatedCredits);
            await dataStore.saveClientCredits({
              ...credits, totalReserved: newReserved, totalConsumed: credits.totalConsumed + consumeAmount
            });
            await dataStore.saveCreditTransaction({
              clientId: ticket.clientId, type: 'consumo', amount: -consumeAmount,
              balanceAfter: credits.balance, description: `Consumo: ${ticket.title}`,
              referenceType: 'ticket', referenceId: ticket.id, createdBy: 'admin'
            });
          }
        }
      }
      if (status === 'cancelado' && ticket.creditTransactionId) {
        // Release reserved credits
        const credits = await dataStore.getClientCredits(ticket.clientId);
        if (credits && ticket.estimatedCredits > 0) {
          const newBalance = credits.balance + ticket.estimatedCredits;
          await dataStore.saveClientCredits({
            ...credits, balance: newBalance, totalReserved: Math.max(0, credits.totalReserved - ticket.estimatedCredits)
          });
          await dataStore.saveCreditTransaction({
            clientId: ticket.clientId, type: 'liberacion', amount: ticket.estimatedCredits,
            balanceAfter: newBalance, description: `Liberación por cancelación: ${ticket.title}`,
            referenceType: 'ticket', referenceId: ticket.id, createdBy: 'admin'
          });
        }
      }

      const updated = await dataStore.saveServiceTicket(ticket);
      res.json({ ok: true, ticket: updated });
    } catch (e) {
      res.status(500).json({ ok: false, error: e.message });
    }
  });

  return router;
};
