require('dotenv').config();
const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function restore() {
  const client = new Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  await client.connect();

  const backups = JSON.parse(fs.readFileSync(path.join(__dirname, 'backup-pre-005.json'), 'utf-8'));

  // Restore ideas
  if (backups.ideas && backups.ideas.length > 0) {
    for (const row of backups.ideas) {
      await client.query(
        `INSERT INTO ideas (id, title, status, type, priority, linked_to, content, ai_context, tags, created_by, created_by_name, created_at, updated_at, collaborators, comments, attachments, version_history, summary, due_date, assigned_to, converted_to)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.title, row.status || 'rascunho', row.type || 'outro', row.priority || 'media',
          JSON.stringify(row.linked_to || row.metadata?.linkedTo || {}),
          JSON.stringify(row.content || row.blocks || {}),
          JSON.stringify(row.ai_context || row.metadata?.aiContext || { brainstormHistory: [], aiSuggestions: [], aiInsights: [] }),
          JSON.stringify(row.tags || []),
          row.created_by || row.author,
          row.created_by_name || row.author,
          row.created_at,
          row.updated_at,
          JSON.stringify(row.collaborators || []),
          JSON.stringify(row.comments || []),
          JSON.stringify(row.attachments || []),
          JSON.stringify(row.version_history || []),
          row.summary || row.title,
          row.due_date,
          row.assigned_to,
          JSON.stringify(row.converted_to || {})
        ]
      );
    }
    console.log(`✅ Restored ideas: ${backups.ideas.length} rows`);
  }

  // Restore security_logs
  if (backups.security_logs && backups.security_logs.length > 0) {
    for (const row of backups.security_logs) {
      await client.query(
        `INSERT INTO security_logs (id, timestamp, type, severity, ip, location, risk, device, attempted_user, message, notified, notification_channel, has_camera_photo, has_screenshot, camera_photo, screenshot, intruder_data)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.created_at || row.timestamp, row.event_type || row.type, 'info',
          row.ip, JSON.stringify({ city: row.location || 'Unknown' }), JSON.stringify({}), JSON.stringify({}),
          row.user_id || row.attempted_user, row.message || JSON.stringify(row.details), false, 'none',
          false, false, null, null, JSON.stringify(row.details || {})
        ]
      );
    }
    console.log(`✅ Restored security_logs: ${backups.security_logs.length} rows`);
  }

  // Restore luna_threads
  if (backups.luna_threads && backups.luna_threads.length > 0) {
    for (const row of backups.luna_threads) {
      await client.query(
        `INSERT INTO luna_threads (id, type, title, participants, created_at, updated_at, message_count, messages)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.type || 'individual', row.title || 'Thread',
          JSON.stringify(row.participants || []),
          row.created_at,
          row.updated_at,
          row.message_count || (row.messages ? row.messages.length : 0),
          JSON.stringify(row.messages || [])
        ]
      );
    }
    console.log(`✅ Restored luna_threads: ${backups.luna_threads.length} rows`);
  }

  // Restore changelog
  if (backups.changelog && backups.changelog.length > 0) {
    for (const row of backups.changelog) {
      await client.query(
        `INSERT INTO changelog (id, version, title, description, category, emoji, author, tier, date, tags, read_by, status, status_detail, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (id) DO NOTHING`,
        [
          row.id, row.version, row.title, row.description, row.category, row.emoji, row.author, row.tier,
          row.date, JSON.stringify(row.tags || []), JSON.stringify(row.read_by || []),
          row.status || '❓ STATUS NÃO AVALIADO',
          row.status_detail || 'Esta funcionalidade ainda não foi revisada neste ciclo de testes.',
          row.created_at
        ]
      );
    }
    console.log(`✅ Restored changelog: ${backups.changelog.length} rows`);
  }

  // Restore quotes (migration 005 already handles backup/restore, but just in case)
  if (backups.quotes && backups.quotes.length > 0) {
    for (const row of backups.quotes) {
      // Skip if already restored by migration
      const exists = await client.query('SELECT 1 FROM quotes WHERE quote_id=$1', [row.id]);
      if (exists.rows.length > 0) continue;
      await client.query(
        `INSERT INTO quotes (quote_id, id, project_id, project_name, client_name, client_id, status, status_label, total_amount, monthly_fee, year1_investment, discount_upfront, items, github_url, created_at, sent_at, valid_until, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         ON CONFLICT (quote_id) DO NOTHING`,
        [
          row.id, row.id, row.project_id, row.project_name, row.client_name, row.client_id,
          row.status, row.status_label,
          JSON.stringify({ value: row.total_amount_value || 0, currency: row.total_amount_currency || 'EUR' }),
          JSON.stringify({ value: row.monthly_fee_value || 0, currency: row.monthly_fee_currency || 'EUR' }),
          JSON.stringify({ value: row.year1_investment_value || 0, currency: row.year1_investment_currency || 'EUR' }),
          JSON.stringify({ percent: row.discount_percent || 0, amount: row.discount_amount || 0, currency: row.discount_currency || 'EUR' }),
          JSON.stringify(row.items || []),
          row.github_url, row.created_at, row.sent_at, row.valid_until, row.updated_at
        ]
      );
    }
    console.log(`✅ Restored quotes: ${backups.quotes.length} rows`);
  }

  console.log('\n💾 Restore complete.');
  await client.end();
}

restore().catch(e => { console.error('❌ Restore failed:', e); process.exit(1); });
