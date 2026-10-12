/**
 * Voting Module Routes — PostgreSQL Edition
 * CEOs vote on actions; approved tool_actions auto-execute.
 */
const express = require('express');
const crypto = require('crypto');

// Telegram notifier for voting notifications
let telegramNotifier = null;
try {
  telegramNotifier = require('./services/telegram-notifier');
} catch (e) {
  console.warn('[Voting] telegram-notifier não disponível:', e.message);
}

function generateId(prefix = 'id') {
  return `${prefix}-${crypto.randomUUID()}`;
}

const CEOs = (process.env.VOTING_CEO_USERS || 'abner,nonoke,elias')
  .split(',')
  .map(s => s.trim().toLowerCase())
  .filter(Boolean);

// Build votes object from array for frontend compatibility
function buildVotesObject(votesArray) {
  const votes = {};
  CEOs.forEach(ceo => { votes[ceo] = null; });
  for (const v of (votesArray || [])) {
    if (v.voter) {
      votes[v.voter] = { vote: v.vote, votedAt: v.votedAt, comment: v.comment };
    }
  }
  return votes;
}

// Tool registry for auto-execute of approved actions
function createToolRegistry(dataStore) {
  return {
    async dashboardCreateTask(params) {
      const newTask = {
        id: generateId('task'),
        title: params.title || 'Untitled Task',
        description: params.description || '',
        priority: params.priority || 'medium',
        status: 'pending',
        taskType: 'one_time',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        assignedTo: params.assignee || null,
        addedBy: 'voting-auto',
        source: 'voting',
        comments: []
      };
      await dataStore.saveTask(newTask);
      return { success: true, task: newTask };
    },
    async dashboardUpdateTask(params) {
      const tasks = await dataStore.getTasks();
      const task = tasks.find(t => t.id === params.taskId);
      if (!task) throw new Error(`Task ${params.taskId} not found`);
      Object.assign(task, params.updates, { updatedAt: new Date().toISOString() });
      await dataStore.saveTask(task);
      return { success: true, task };
    },
    async dashboardDeleteTask(params) {
      await dataStore.deleteTask(params.taskId);
      return { success: true, deleted: params.taskId };
    }
  };
}

async function executeVotingTool(toolRegistry, toolName, toolParams) {
  const tool = toolRegistry[toolName];
  if (!tool) throw new Error(`Tool "${toolName}" not found in registry`);
  return await tool(toolParams);
}

module.exports = function(app, { requireAuth, dataStore, auditLogService }) {
  const toolRegistry = createToolRegistry(dataStore);

  // Helper: enrich session with votes
  async function enrichSession(session) {
    if (!session) return null;
    const votesArray = await dataStore.getVotingVotes(session.id);
    return { ...session, votes: buildVotesObject(votesArray) };
  }

  // GET /api/voting/stats
  app.get('/api/voting/stats', requireAuth, async (req, res) => {
    try {
      const sessions = await dataStore.getVotingSessions();
      const active = sessions.filter(s => s.status === 'open' || s.status === 'voting').length;
      const approved = sessions.filter(s => s.status === 'approved').length;
      const rejected = sessions.filter(s => s.status === 'rejected').length;
      const closed = sessions.filter(s => s.status === 'closed' || s.status === 'closed_without_quorum').length;
      res.json({ total: sessions.length, active, approved, rejected, closed });
    } catch (err) {
      console.error('[API] Error getting stats:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/voting/sessions
  app.get('/api/voting/sessions', requireAuth, async (req, res) => {
    try {
      const sessions = await dataStore.getVotingSessions();
      const { page = 1, limit = 20, status, filter, createdBy } = req.query;
      let filtered = [...sessions];
      if (status) filtered = filtered.filter(s => s.status === status);
      if (createdBy === 'me') filtered = filtered.filter(s => s.createdBy === req.user.userId);
      else if (createdBy) filtered = filtered.filter(s => s.createdBy === createdBy);
      if (filter) {
        const f = filter.toLowerCase();
        filtered = filtered.filter(s => s.title.toLowerCase().includes(f) || (s.description || '').toLowerCase().includes(f));
      }
      filtered.sort((a, b) => {
        const statusOrder = { open: 0, voting: 1, approved: 2, rejected: 3, closed: 4 };
        const sa = statusOrder[a.status] ?? 99;
        const sb = statusOrder[b.status] ?? 99;
        if (sa !== sb) return sa - sb;
        return new Date(b.createdAt) - new Date(a.createdAt);
      });
      const start = (page - 1) * limit;
      const paginated = filtered.slice(start, start + parseInt(limit));
      // Enrich with votes
      const enriched = await Promise.all(paginated.map(s => enrichSession(s)));
      res.json({
        sessions: enriched,
        pagination: { page: parseInt(page), limit: parseInt(limit), total: filtered.length, pages: Math.ceil(filtered.length / limit) }
      });
    } catch (err) {
      console.error('[API] Error listing sessions:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/voting/sessions/:id
  app.get('/api/voting/sessions/:id', requireAuth, async (req, res) => {
    try {
      const session = await dataStore.getVotingSessionById(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      const enriched = await enrichSession(session);
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/voting/sessions
  app.post('/api/voting/sessions', requireAuth, async (req, res) => {
    try {
      const { title, description, type = 'generic', toolName, toolParams, quorumRequired = 3, linkedTimelineId, linkedRoadmapId, reviewMeetingAt } = req.body;
      if (!title) return res.status(400).json({ error: 'Title is required' });
      if (!['tool_action', 'generic', 'review'].includes(type)) return res.status(400).json({ error: 'Invalid type' });
      if (type === 'tool_action' && !toolName) return res.status(400).json({ error: 'toolName required for tool_action type' });
      if (![2, 3].includes(parseInt(quorumRequired))) return res.status(400).json({ error: 'quorumRequired must be 2 or 3' });

      const newSession = {
        id: generateId('sess'),
        title,
        description: description || '',
        type,
        toolName: type === 'tool_action' ? toolName : null,
        toolParams: type === 'tool_action' ? (toolParams || {}) : null,
        linkedTimelineId: linkedTimelineId || null,
        linkedRoadmapId: linkedRoadmapId || null,
        reviewMeetingAt: reviewMeetingAt || null,
        status: 'open',
        quorumRequired: parseInt(quorumRequired),
        createdBy: req.user.userId,
        createdAt: new Date().toISOString(),
        closedAt: null,
        result: null,
        executionResult: null
      };

      await dataStore.saveVotingSession(newSession);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'votingSession',
          entityId: newSession.id,
          action: 'create',
          actor: req.user?.userId || 'dashboard',
          source: 'dashboard',
          after: newSession,
          description: `Criou votação "${newSession.title}"`,
        });
      }

      // Notificar Telegram
      if (telegramNotifier?.sendVotingNotification) {
        telegramNotifier.sendVotingNotification({ type: 'new', session: { ...newSession, votes: buildVotesObject([]) } }).catch(() => {});
      }

      res.status(201).json({ ...newSession, votes: buildVotesObject([]) });
    } catch (err) {
      console.error('[API] Error creating session:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // PUT /api/voting/sessions/:id
  app.put('/api/voting/sessions/:id', requireAuth, async (req, res) => {
    try {
      const session = await dataStore.getVotingSessionById(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.createdBy !== req.user.userId) {
        return res.status(403).json({ error: 'Only the creator can edit this session' });
      }
      if (session.status !== 'open' && session.status !== 'voting') {
        return res.status(400).json({ error: 'Cannot edit a closed session' });
      }
      const updates = req.body;
      const beforeSession = JSON.parse(JSON.stringify(session));
      const updated = {
        ...session,
        title: updates.title !== undefined ? updates.title : session.title,
        description: updates.description !== undefined ? updates.description : session.description,
        type: updates.type !== undefined ? updates.type : session.type,
        toolName: updates.toolName !== undefined ? updates.toolName : session.toolName,
        toolParams: updates.toolParams !== undefined ? updates.toolParams : session.toolParams,
        quorumRequired: updates.quorumRequired !== undefined ? updates.quorumRequired : session.quorumRequired,
        updatedAt: new Date().toISOString()
      };
      await dataStore.saveVotingSession(updated);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'votingSession',
          entityId: updated.id,
          action: 'update',
          actor: req.user?.userId || 'dashboard',
          source: 'dashboard',
          before: beforeSession,
          after: updated,
          description: `Atualizou votação "${updated.title}"`,
        });
      }

      res.json({ ...updated, votes: buildVotesObject(await dataStore.getVotingVotes(req.params.id)) });
    } catch (err) {
      console.error('[API] Error updating session:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/voting/sessions/:id/vote
  app.post('/api/voting/sessions/:id/vote', requireAuth, async (req, res) => {
    try {
      const { vote, comment = '' } = req.body;
      const username = req.user.userId;
      if (!vote || !['yes', 'no'].includes(vote)) {
        return res.status(400).json({ error: 'Vote must be "yes" or "no"' });
      }
      if (!CEOs.includes(username)) {
        return res.status(403).json({ error: 'Only CEOs can vote' });
      }

      const session = await dataStore.getVotingSessionById(req.params.id);
      if (!session) throw new Error('SESSION_NOT_FOUND');
      if (session.status !== 'open' && session.status !== 'voting') {
        throw new Error(`SESSION_CLOSED:${session.status}`);
      }

      const votedAt = new Date().toISOString();

      // Save vote
      await dataStore.saveVotingVote({
        id: generateId('vote'),
        sessionId: req.params.id,
        voter: username,
        vote,
        comment,
        votedAt
      });

      // Get all votes for this session
      const allVotes = await dataStore.getVotingVotes(req.params.id);
      const yesVotes = allVotes.filter(v => v.vote === 'yes').length;
      const noVotes = allVotes.filter(v => v.vote === 'no').length;
      const totalCEOs = CEOs.length;

      let notificationType = null;
      let autoExecuteResult = null;
      let updatedSession = { ...session };

      if (noVotes >= 1) {
        updatedSession.status = 'rejected';
        updatedSession.result = 'rejected';
        updatedSession.closedAt = votedAt;
        notificationType = 'rejected';
      } else if (yesVotes >= session.quorumRequired) {
        updatedSession.status = 'approved';
        updatedSession.result = 'approved';
        updatedSession.closedAt = votedAt;
        if (session.type === 'tool_action' && session.toolName) {
          try {
            autoExecuteResult = await executeVotingTool(toolRegistry, session.toolName, session.toolParams || {});
          } catch (execErr) {
            console.error('[AUTO-EXECUTE] Error:', execErr.message);
            autoExecuteResult = { success: false, error: execErr.message };
          }
          updatedSession.executionResult = autoExecuteResult;
        }
        if (session.type === 'review') {
          // Create completed task and update timeline
          try {
            const task = {
              id: generateId('task'),
              title: `[REVISÃO APROVADA] ${session.title}`,
              description: session.description || 'Revisão em grupo aprovada por unanimidade.',
              status: 'completed',
              priority: 'high',
              source: 'roadmap_review',
              assignedTo: session.createdBy,
              addedBy: 'voting-auto',
              comments: [],
              linkedRoadmapId: session.linkedRoadmapId,
              linkedTimelineId: session.linkedTimelineId,
              metadata: { voting_session_id: session.id },
              completedAt: new Date().toISOString(),
              createdAt: new Date().toISOString()
            };
            await dataStore.saveCompanyTask(task);

            if (session.linkedTimelineId) {
              const timeline = await dataStore.getTimelineById(session.linkedTimelineId);
              if (timeline) {
                const steps = timeline.steps || [];
                const currentIdx = timeline.current_step_index || 0;
                if (steps[currentIdx]) {
                  steps[currentIdx] = { ...steps[currentIdx], status: 'approved', vote_pending: false };
                }
                await dataStore.saveTimeline({
                  ...timeline,
                  steps,
                  current_step_index: currentIdx,
                  status: currentIdx >= steps.length - 1 ? 'completed' : timeline.status
                });
              }
            }
            autoExecuteResult = { success: true, taskCreated: task.id };
          } catch (reviewErr) {
            console.error('[REVIEW-AUTO] Error:', reviewErr.message);
            autoExecuteResult = { success: false, error: reviewErr.message };
          }
          updatedSession.executionResult = autoExecuteResult;
        }
      } else {
        const votedCount = allVotes.length;
        if (votedCount >= totalCEOs && yesVotes < session.quorumRequired && noVotes === 0) {
          updatedSession.status = 'closed';
          updatedSession.result = 'closed_without_quorum';
          updatedSession.closedAt = votedAt;
        }
      }

      // Save updated session
      if (updatedSession.status !== session.status || updatedSession.closedAt !== session.closedAt) {
        await dataStore.saveVotingSession(updatedSession);
      }

      const tally = { yes: yesVotes, no: noVotes, pending: totalCEOs - yesVotes - noVotes };
      const yourVote = { vote, votedAt, comment };
      const enriched = await enrichSession(updatedSession);

      // Notificar Telegram
      if (telegramNotifier?.sendVotingNotification) {
        if (notificationType) {
          telegramNotifier.sendVotingNotification({ type: notificationType, session: enriched }).catch(() => {});
        } else if (enriched.status === 'open' || enriched.status === 'voting') {
          telegramNotifier.sendVotingNotification({ type: 'vote', session: enriched, voter: username, voteValue: vote }).catch(() => {});
        }
      }

      res.json({
        session: enriched,
        yourVote,
        tally,
        autoExecuted: session.type === 'tool_action' && enriched.status === 'approved' ? enriched.executionResult : null
      });
    } catch (err) {
      if (err.message === 'SESSION_NOT_FOUND') {
        return res.status(404).json({ error: 'Session not found' });
      }
      if (err.message.startsWith('SESSION_CLOSED:')) {
        return res.status(400).json({ error: `Session is ${err.message.split(':')[1]}, cannot vote` });
      }
      console.error('[API] Error voting:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // DELETE /api/voting/sessions/:id
  app.delete('/api/voting/sessions/:id', requireAuth, async (req, res) => {
    try {
      const session = await dataStore.getVotingSessionById(req.params.id);
      if (!session) return res.status(404).json({ error: 'Session not found' });
      if (session.createdBy !== req.user.userId) {
        return res.status(403).json({ error: 'Only the creator can delete this session' });
      }
      if (session.status !== 'open' && session.status !== 'voting') {
        return res.status(400).json({ error: 'Cannot delete a closed session' });
      }
      // Soft delete by updating status
      const beforeSession = JSON.parse(JSON.stringify(session));
      const updated = { ...session, status: 'deleted', updatedAt: new Date().toISOString() };
      await dataStore.saveVotingSession(updated);

      if (auditLogService) {
        auditLogService.log({
          entityType: 'votingSession',
          entityId: updated.id,
          action: 'update',
          actor: req.user?.userId || 'dashboard',
          source: 'dashboard',
          before: beforeSession,
          after: updated,
          description: `Excluiu votação "${updated.title}"`,
        });
      }

      res.json({ message: 'Session deleted', session: updated });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // GET /api/voting/sessions/:id/votes
  app.get('/api/voting/sessions/:id/votes', requireAuth, async (req, res) => {
    try {
      const votes = await dataStore.getVotingVotes(req.params.id);
      res.json(votes);
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // POST /api/voting/telegram-vote
  app.post('/api/voting/telegram-vote', async (req, res) => {
    try {
      const { sessionId, voter, vote, secret } = req.body;
      const expectedSecret = process.env.TELEGRAM_BOT_TOKEN;
      if (!expectedSecret || secret !== expectedSecret) {
        return res.status(403).json({ error: 'Invalid secret' });
      }
      if (!sessionId || !voter || !vote || !['yes', 'no'].includes(vote)) {
        return res.status(400).json({ error: 'Invalid parameters' });
      }
      if (!CEOs.includes(voter)) {
        return res.status(403).json({ error: 'Only CEOs can vote' });
      }

      const session = await dataStore.getVotingSessionById(sessionId);
      if (!session) throw new Error('SESSION_NOT_FOUND');
      if (session.status !== 'open' && session.status !== 'voting') {
        throw new Error(`SESSION_CLOSED:${session.status}`);
      }

      const votedAt = new Date().toISOString();

      // Save vote
      await dataStore.saveVotingVote({
        id: generateId('vote'),
        sessionId,
        voter,
        vote,
        comment: 'Telegram',
        votedAt
      });

      // Recalculate status
      const allVotes = await dataStore.getVotingVotes(sessionId);
      const yesVotes = allVotes.filter(v => v.vote === 'yes').length;
      const noVotes = allVotes.filter(v => v.vote === 'no').length;

      let updatedSession = { ...session };
      if (noVotes >= 1) {
        updatedSession.status = 'rejected';
        updatedSession.result = 'rejected';
        updatedSession.closedAt = votedAt;
      } else if (yesVotes >= session.quorumRequired) {
        updatedSession.status = 'approved';
        updatedSession.result = 'approved';
        updatedSession.closedAt = votedAt;
      }

      if (updatedSession.status !== session.status) {
        await dataStore.saveVotingSession(updatedSession);
      }

      const enriched = await enrichSession(updatedSession);
      res.json({ session: enriched, voter, vote, votedAt });
    } catch (err) {
      if (err.message === 'SESSION_NOT_FOUND') return res.status(404).json({ error: 'Session not found' });
      if (err.message.startsWith('SESSION_CLOSED:')) return res.status(400).json({ error: `Session is ${err.message.split(':')[1]}, cannot vote` });
      console.error('[API] Error telegram vote:', err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });
};
