-- ============================================================
-- Migration 006: Adicionar status e status_detail ao changelog
-- ============================================================

ALTER TABLE changelog
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT '❓ STATUS NÃO AVALIADO',
  ADD COLUMN IF NOT EXISTS status_detail TEXT DEFAULT 'Esta funcionalidade ainda não foi revisada neste ciclo de testes.';

CREATE INDEX IF NOT EXISTS idx_changelog_status ON changelog(status);
