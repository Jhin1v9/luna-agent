-- Migration 014: Persist event ledger and last acked event ID for reliable SSE delivery
-- v10.16-fix: Prevents message loss on reconnect/restart

ALTER TABLE luna_chat_sessions
  ADD COLUMN IF NOT EXISTS event_ledger JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS last_acked_event_id TEXT;
