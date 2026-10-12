/**
 * ═══════════════════════════════════════════════════════════════════════════
 * Leads Routes — NEXO Dashboard PRO
 * POST /api/leads — Captura leads do formulário de demo
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * • Público (sem auth)
 * • Rate limit: 3 req / 15min por IP
 * • Validação Zod
 * • Salva no PostgreSQL (tabela leads existente)
 * • Notifica equipe via Email + Discord
 * ═══════════════════════════════════════════════════════════════════════════
 */

const express = require('express');
const router = express.Router();
const { notifyNewLead } = require('../services/notification.service');

// Rate limiting em memória (simples, por IP)
const rateLimitMap = new Map();
const RATE_LIMIT_MAX = 3;
const RATE_LIMIT_WINDOW = 15 * 60 * 1000; // 15 min

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now - entry.resetTime > RATE_LIMIT_WINDOW) {
    rateLimitMap.set(ip, { count: 1, resetTime: now });
    return { allowed: true, remaining: RATE_LIMIT_MAX - 1 };
  }
  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfter = Math.ceil((entry.resetTime + RATE_LIMIT_WINDOW - now) / 1000);
    return { allowed: false, retryAfter };
  }
  entry.count++;
  return { allowed: true, remaining: RATE_LIMIT_MAX - entry.count };
}

// Simples validação (sem Zod pesado para manter leve)
function validateLead(body) {
  const errors = [];
  const { name, email, companyName, companySize, phone, message } = body;

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Nome é obrigatório (mínimo 2 caracteres)');
  }
  if (!email || typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.push('Email válido é obrigatório');
  }
  if (companyName && companyName.length > 200) {
    errors.push('Nome da empresa muito longo');
  }
  if (companySize && (typeof companySize !== 'string' || companySize.length > 50)) {
    errors.push('Tamanho da equipe inválido');
  }
  if (phone && phone.length > 50) {
    errors.push('Telefone muito longo');
  }
  if (message && message.length > 2000) {
    errors.push('Mensagem muito longa (máx 2000 caracteres)');
  }

  return { valid: errors.length === 0, errors };
}

// Sanitização básica
function sanitize(text) {
  if (!text) return '';
  return String(text).trim().replace(/[<>]/g, '');
}

/**
 * POST /api/leads
 * Cria um novo lead a partir do formulário de demo
 */
router.post('/', async (req, res) => {
  try {
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown';

    // Rate limit
    const rate = checkRateLimit(clientIp);
    if (!rate.allowed) {
      return res.status(429).json({
        success: false,
        error: 'Muitas tentativas. Aguarde 15 minutos.',
        retryAfter: rate.retryAfter
      });
    }

    // Validação
    const { valid, errors } = validateLead(req.body);
    if (!valid) {
      return res.status(400).json({ success: false, errors });
    }

    const { name, email, companyName, companySize, phone, message } = req.body;

    // Gerar ID
    const leadId = 'lead_' + Date.now() + '_' + Math.random().toString(36).substring(2, 8);

    // Montar objeto lead (mapeamento para tabela existente — camelCase conforme datastore-pg)
    const leadData = {
      id: leadId,
      displayName: sanitize(name),
      name: sanitize(companyName) || null,
      email: sanitize(email).toLowerCase(),
      phone: sanitize(phone) || '',
      source: 'website',
      type: 'lead',
      status: 'potencial',
      pipelineStatus: 'novo',
      estimatedValue: 0,
      currency: 'EUR',
      notes: sanitize(message) || '',
      assignedTo: null,
      tags: [companySize || ''].filter(Boolean),
      createdAt: new Date().toISOString(),
      lastContact: null,
      convertedAt: null
    };

    // Salvar no PostgreSQL via datastore
    const dataStore = require('../datastore-pg');
    await dataStore.saveLead(leadData);

    // Notificar equipe (email + Discord)
    const notifications = await notifyNewLead({
      id: leadId,
      displayName: leadData.displayName,
      email: leadData.email,
      companyName: leadData.name,
      companySize: companySize,
      phone: leadData.phone,
      notes: leadData.notes
    });

    res.status(201).json({
      success: true,
      leadId,
      message: 'Obrigado! Nossa equipe entrará em contato em até 24h.',
      notifications: {
        email: notifications.email?.success || false,
        discord: notifications.discord?.success || false,
        telegram: notifications.telegram?.sent || false
      }
    });

  } catch (err) {
    console.error('[LeadsRoute] Erro ao criar lead:', err);
    res.status(500).json({ success: false, error: 'Erro interno. Tente novamente mais tarde.' });
  }
});

module.exports = router;
