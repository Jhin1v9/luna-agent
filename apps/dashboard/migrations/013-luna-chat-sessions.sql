-- Migration 013: Cria tabela de sessões de chat da Luna Web
-- Necessária para persistência de conversas entre reinícios

CREATE TABLE IF NOT EXISTS luna_chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL DEFAULT 'anonymous',
  title TEXT NOT NULL DEFAULT 'Nova conversa',
  mode TEXT NOT NULL DEFAULT 'instant',
  persona TEXT NOT NULL DEFAULT 'default',
  messages JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luna_chat_sessions_user_id ON luna_chat_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_luna_chat_sessions_updated_at ON luna_chat_sessions(updated_at DESC);
