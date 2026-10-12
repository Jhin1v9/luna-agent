/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Roadmaps & Metas Routes — NEXO Dashboard PRO
 * /api/roadmaps — Hub de Projetos com Timeline, Pagamentos, Votações
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 */
const express = require('express');
const crypto = require('crypto');

function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

module.exports = function(dataStore, { requireAuth }) {
  const router = express.Router();

  // ============================================================
  // PROJECT TYPE TEMPLATES
  // ============================================================
  router.get('/project-templates', requireAuth, async (req, res) => {
    try {
      const templates = await dataStore.getProjectTypeTemplates();
      res.json({ templates });
    } catch (err) {
      console.error('[Roadmaps] Error listing templates:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============================================================
  // ROADMAPS CRUD
  // ============================================================
  router.get('/', requireAuth, async (req, res) => {
    try {
      const filters = {};
      if (req.query.status) filters.status = req.query.status;
      if (req.query.client_id) filters.client_id = req.query.client_id;
      if (req.query.project_type) filters.project_type = req.query.project_type;
      const roadmaps = await dataStore.getRoadmaps(filters);
      res.json({ roadmaps });
    } catch (err) {
      console.error('[Roadmaps] Error listing:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.get('/:id', requireAuth, async (req, res) => {
    try {
      const roadmap = await dataStore.getRoadmapById(req.params.id);
      if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });
      const timelines = await dataStore.getTimelines(req.params.id);
      const history = await dataStore.getPhaseHistory(req.params.id);
      res.json({ ...roadmap, timelines, history });
    } catch (err) {
      console.error('[Roadmaps] Error getting:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/', requireAuth, async (req, res) => {
    try {
      const { title, client_id, lead_id, project_type, total_value, currency, start_date, github_repo, subdomain, onboarding_answers } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });

      // Buscar template
      const template = await dataStore.getProjectTypeTemplate(project_type || 'website');
      const phases = template ? (template.default_phases || []) : [];
      const paymentSplits = template ? (template.default_payment_splits || [{ percent: 50, label: 'Contrato' }, { percent: 50, label: 'Entrega' }]) : [{ percent: 50, label: 'Contrato' }, { percent: 50, label: 'Entrega' }];

      // Gerar payment_schedule
      const startDate = start_date ? new Date(start_date) : new Date();
      const paymentSchedule = paymentSplits.map((split, idx) => ({
        phase: split.label.toLowerCase().replace(/\s+/g, '_'),
        percent: split.percent,
        due_date: idx === 0 ? startDate.toISOString().split('T')[0] : null,
        paid: false,
        label: split.label,
        payment_id: null
      }));

      // Calcular expected_end_date baseado nas fases
      const totalDuration = phases.reduce((sum, p) => sum + (p.duration_days || 0), 0);
      const expectedEnd = new Date(startDate);
      expectedEnd.setDate(expectedEnd.getDate() + totalDuration);

      const roadmap = {
        id: generateId('roadmap'),
        title: title.trim(),
        client_id: client_id || null,
        lead_id: lead_id || null,
        project_type: project_type || 'website',
        status: 'active',
        total_value: parseFloat(total_value) || 0,
        currency: currency || 'EUR',
        payment_schedule: paymentSchedule,
        github_repo: github_repo || null,
        subdomain: subdomain || null,
        current_phase_index: 0,
        phases: phases.map((p, i) => ({ ...p, index: i, status: i === 0 ? 'active' : 'pending' })),
        expected_end_date: expectedEnd.toISOString().split('T')[0],
        onboarding_answers: onboarding_answers || {},
        created_by: req.user?.userId || req.user?.id || 'system'
      };

      await dataStore.saveRoadmap(roadmap);

      // Auto-criar timelines filhas baseadas no template
      const defaultRoles = template ? (template.default_roles || ['coder']) : ['coder'];
      for (const role of defaultRoles) {
        const timeline = {
          id: generateId('timeline'),
          roadmap_id: roadmap.id,
          title: `${role.charAt(0).toUpperCase() + role.slice(1)}`,
          role,
          assigned_to: null,
          parent_timeline_id: null,
          steps: role === 'coder' ? [
            { title: 'Ouvir pedidos do cliente', status: 'pending', order: 0 },
            { title: 'Documentar requisitos', status: 'pending', order: 1 },
            { title: 'Implementar', status: 'pending', order: 2 },
            { title: 'Testar', status: 'pending', order: 3 },
            { title: 'Pedir opinião (revisão)', status: 'pending', order: 4, creates_vote: true },
            { title: 'Aprovação / Revisão', status: 'pending', order: 5 }
          ] : [
            { title: 'Análise inicial', status: 'pending', order: 0 },
            { title: 'Execução', status: 'pending', order: 1 },
            { title: 'Revisão', status: 'pending', order: 2 }
          ],
          current_step_index: 0,
          status: 'pending'
        };
        await dataStore.saveTimeline(timeline);
      }

      // Notificar Telegram
      try {
        const telegramNotifier = require('../services/telegram-notifier');
        if (telegramNotifier.sendRoadmapNotification) {
          telegramNotifier.sendRoadmapNotification(roadmap).catch(err => {
            console.warn('[Roadmaps] Falha ao notificar Telegram:', err.message);
          });
        }
      } catch (e) {
        console.warn('[Roadmaps] telegram-notifier não disponível:', e.message);
      }

      res.status(201).json(roadmap);
    } catch (err) {
      console.error('[Roadmaps] Error creating:', err);
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  });

  router.put('/:id', requireAuth, async (req, res) => {
    try {
      const existing = await dataStore.getRoadmapById(req.params.id);
      if (!existing) return res.status(404).json({ error: 'Roadmap not found' });

      const updates = req.body;
      const roadmap = {
        id: req.params.id,
        title: updates.title !== undefined ? updates.title : existing.title,
        client_id: updates.client_id !== undefined ? updates.client_id : existing.client_id,
        lead_id: updates.lead_id !== undefined ? updates.lead_id : existing.lead_id,
        project_type: updates.project_type !== undefined ? updates.project_type : existing.project_type,
        status: updates.status !== undefined ? updates.status : existing.status,
        total_value: updates.total_value !== undefined ? updates.total_value : existing.total_value,
        currency: updates.currency !== undefined ? updates.currency : existing.currency,
        payment_schedule: updates.payment_schedule !== undefined ? updates.payment_schedule : existing.payment_schedule,
        github_repo: updates.github_repo !== undefined ? updates.github_repo : existing.github_repo,
        subdomain: updates.subdomain !== undefined ? updates.subdomain : existing.subdomain,
        current_phase_index: updates.current_phase_index !== undefined ? updates.current_phase_index : existing.current_phase_index,
        phases: updates.phases !== undefined ? updates.phases : existing.phases,
        expected_end_date: updates.expected_end_date !== undefined ? updates.expected_end_date : existing.expected_end_date,
        onboarding_answers: updates.onboarding_answers !== undefined ? updates.onboarding_answers : existing.onboarding_answers,
        created_by: existing.created_by
      };

      await dataStore.saveRoadmap(roadmap);
      res.json(roadmap);
    } catch (err) {
      console.error('[Roadmaps] Error updating:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.delete('/:id', requireAuth, async (req, res) => {
    try {
      await dataStore.deleteRoadmap(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('[Roadmaps] Error deleting:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============================================================
  // AVANÇAR FASE (botão "Próximo")
  // ============================================================
  router.post('/:id/advance', requireAuth, async (req, res) => {
    try {
      const roadmap = await dataStore.getRoadmapById(req.params.id);
      if (!roadmap) return res.status(404).json({ error: 'Roadmap not found' });

      const phases = roadmap.phases || [];
      const currentIdx = roadmap.current_phase_index || 0;
      if (currentIdx >= phases.length - 1) {
        return res.status(400).json({ error: 'Already at last phase' });
      }

      const currentPhase = phases[currentIdx];
      const nextIdx = currentIdx + 1;
      const nextPhase = phases[nextIdx];

      // Atualizar fases
      phases[currentIdx] = { ...currentPhase, status: 'completed' };
      phases[nextIdx] = { ...nextPhase, status: 'active' };

      // Se fase atual tinha payment_trigger, criar payment
      if (currentPhase.payment_trigger) {
        const paymentSplit = (roadmap.payment_schedule || []).find(p => p.phase === currentPhase.title.toLowerCase().replace(/\s+/g, '_'));
        const percent = paymentSplit ? paymentSplit.percent : 50;
        const amount = (parseFloat(roadmap.total_value) || 0) * (percent / 100);

        const payment = {
          payment_id: generateId('pay'),
          client_id: roadmap.client_id,
          client_name: null, // será preenchido pelo frontend ou lookup
          project_name: roadmap.title,
          description: `${roadmap.title} — ${currentPhase.title} (${percent}%)`,
          total_amount: { value: amount, currency: roadmap.currency || 'EUR' },
          status: 'pending',
          due_date: new Date().toISOString().split('T')[0],
          linked_roadmap_id: roadmap.id,
          payment_phase: currentPhase.title
        };
        await dataStore.savePayment(payment);

        // Atualizar payment_schedule
        const schedule = roadmap.payment_schedule || [];
        const schedIdx = schedule.findIndex(p => p.phase === currentPhase.title.toLowerCase().replace(/\s+/g, '_'));
        if (schedIdx >= 0) {
          schedule[schedIdx].payment_id = payment.payment_id;
          schedule[schedIdx].due_date = payment.due_date;
        }
      }

      // Salvar histórico
      await dataStore.savePhaseHistory({
        id: generateId('hist'),
        roadmap_id: roadmap.id,
        from_index: currentIdx,
        to_index: nextIdx,
        changed_by: req.user?.userId || req.user?.id || 'system',
        reason: req.body.reason || `Avanço para fase: ${nextPhase.title}`
      });

      // Atualizar roadmap
      await dataStore.saveRoadmap({
        ...roadmap,
        current_phase_index: nextIdx,
        phases,
        payment_schedule: roadmap.payment_schedule || []
      });

      // Se última fase, marcar como completed
      if (nextIdx === phases.length - 1) {
        await dataStore.saveRoadmap({ ...roadmap, status: 'completed', current_phase_index: nextIdx, phases });
      }

      res.json({ success: true, current_phase_index: nextIdx, phases });
    } catch (err) {
      console.error('[Roadmaps] Error advancing:', err);
      res.status(500).json({ error: 'Internal server error', details: err.message });
    }
  });

  // ============================================================
  // TIMELINES
  // ============================================================
  router.get('/:id/timelines', requireAuth, async (req, res) => {
    try {
      const timelines = await dataStore.getTimelines(req.params.id);
      // Enrich with collaborators
      for (const t of timelines) {
        t.collaborators = await dataStore.getTimelineCollaborators(t.id);
      }
      res.json({ timelines });
    } catch (err) {
      console.error('[Roadmaps] Error listing timelines:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/:id/timelines', requireAuth, async (req, res) => {
    try {
      const { title, role, steps } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });

      const timeline = {
        id: generateId('timeline'),
        roadmap_id: req.params.id,
        title: title.trim(),
        role: role || 'coder',
        assigned_to: null,
        parent_timeline_id: null,
        steps: steps || [],
        current_step_index: 0,
        status: 'pending'
      };
      await dataStore.saveTimeline(timeline);
      res.status(201).json(timeline);
    } catch (err) {
      console.error('[Roadmaps] Error creating timeline:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // ============================================================
  // TIMELINE OPERATIONS
  // ============================================================
  router.put('/timelines/:timelineId', requireAuth, async (req, res) => {
    try {
      const existing = await dataStore.getTimelineById(req.params.timelineId);
      if (!existing) return res.status(404).json({ error: 'Timeline not found' });

      const updates = req.body;
      const timeline = {
        id: req.params.timelineId,
        roadmap_id: existing.roadmap_id,
        title: updates.title !== undefined ? updates.title : existing.title,
        role: updates.role !== undefined ? updates.role : existing.role,
        assigned_to: updates.assigned_to !== undefined ? updates.assigned_to : existing.assigned_to,
        parent_timeline_id: existing.parent_timeline_id,
        steps: updates.steps !== undefined ? updates.steps : existing.steps,
        current_step_index: updates.current_step_index !== undefined ? updates.current_step_index : existing.current_step_index,
        status: updates.status !== undefined ? updates.status : existing.status,
        version: existing.version
      };

      await dataStore.saveTimeline(timeline);
      res.json(timeline);
    } catch (err) {
      console.error('[Roadmaps] Error updating timeline:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/timelines/:timelineId/join', requireAuth, async (req, res) => {
    try {
      const user = {
        id: req.user?.userId || req.user?.id || 'anonymous',
        name: req.user?.name || req.user?.userId || 'Anônimo',
        color: req.user?.color || '#6c5ce7'
      };
      await dataStore.joinTimeline(req.params.timelineId, user);
      const collaborators = await dataStore.getTimelineCollaborators(req.params.timelineId);
      res.json({ success: true, collaborators });
    } catch (err) {
      console.error('[Roadmaps] Error joining timeline:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/timelines/:timelineId/leave', requireAuth, async (req, res) => {
    try {
      const userId = req.user?.userId || req.user?.id || 'anonymous';
      await dataStore.leaveTimeline(req.params.timelineId, userId);
      const collaborators = await dataStore.getTimelineCollaborators(req.params.timelineId);
      res.json({ success: true, collaborators });
    } catch (err) {
      console.error('[Roadmaps] Error leaving timeline:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  router.post('/timelines/:timelineId/advance-step', requireAuth, async (req, res) => {
    try {
      const timeline = await dataStore.getTimelineById(req.params.timelineId);
      if (!timeline) return res.status(404).json({ error: 'Timeline not found' });

      const steps = timeline.steps || [];
      const currentIdx = timeline.current_step_index || 0;
      if (currentIdx >= steps.length - 1) {
        return res.status(400).json({ error: 'Already at last step' });
      }

      steps[currentIdx] = { ...steps[currentIdx], status: 'completed' };
      const nextIdx = currentIdx + 1;
      steps[nextIdx] = { ...steps[nextIdx], status: 'active' };

      // Se step tinha creates_vote, criar votação
      if (steps[currentIdx].creates_vote) {
        // A votação será criada pelo frontend chamando POST /api/voting/sessions
        // Aqui apenas marcamos que precisa de votação
        steps[currentIdx] = { ...steps[currentIdx], vote_pending: true };
      }

      const updated = {
        ...timeline,
        steps,
        current_step_index: nextIdx,
        status: nextIdx === steps.length - 1 ? 'completed' : 'active'
      };

      await dataStore.saveTimeline(updated);
      res.json({ success: true, timeline: updated });
    } catch (err) {
      console.error('[Roadmaps] Error advancing step:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return router;
};
