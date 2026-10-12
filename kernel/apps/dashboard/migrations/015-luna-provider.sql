-- Migration 015: Adiciona coluna provider às sessões de chat da Luna Web
-- Necessária para suporte multi-provider (kimi, deepseek, etc.)

ALTER TABLE luna_chat_sessions
ADD COLUMN IF NOT EXISTS provider TEXT NOT NULL DEFAULT 'kimi';
