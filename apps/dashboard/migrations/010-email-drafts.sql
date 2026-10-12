-- Migration 010: Email Drafts
-- Move email drafts from JSON file to PostgreSQL

CREATE TABLE IF NOT EXISTS email_drafts (
  id TEXT PRIMARY KEY,
  email_id TEXT,
  thread_id TEXT,
  subject TEXT,
  body TEXT,
  notes TEXT,
  tone TEXT DEFAULT 'professional',
  status TEXT NOT NULL DEFAULT 'pending',
  to_recipient TEXT,
  created_by TEXT DEFAULT 'luna',
  approved_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_email_drafts_status ON email_drafts(status);
CREATE INDEX IF NOT EXISTS idx_email_drafts_created_at ON email_drafts(created_at DESC);
