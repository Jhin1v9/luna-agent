-- Migration 011: Voting System
-- Move voting sessions and votes from JSON files to PostgreSQL

CREATE TABLE IF NOT EXISTS voting_sessions (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  action_type TEXT NOT NULL,
  action_params JSONB DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active',
  created_by TEXT,
  approved_at TIMESTAMP WITH TIME ZONE,
  rejected_at TIMESTAMP WITH TIME ZONE,
  executed_at TIMESTAMP WITH TIME ZONE,
  execution_result JSONB,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS voting_votes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES voting_sessions(id) ON DELETE CASCADE,
  voter TEXT NOT NULL,
  vote TEXT NOT NULL CHECK (vote IN ('yes', 'no')),
  reason TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_voting_votes_session ON voting_votes(session_id);
CREATE INDEX IF NOT EXISTS idx_voting_sessions_status ON voting_sessions(status);
