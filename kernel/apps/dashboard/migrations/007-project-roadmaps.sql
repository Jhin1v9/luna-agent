-- ============================================================
-- MIGRATION 007 — Project Roadmaps & Metas (NEXO Dashboard PRO)
-- Fase 0.2 · Hub de Projetos com Timeline, Pagamentos, Votações
-- ============================================================

-- ============================================================
-- 1. PROJECT TYPE TEMPLATES (configurável, versionável)
-- ============================================================
CREATE TABLE IF NOT EXISTS project_type_templates (
  id TEXT PRIMARY KEY,
  project_type TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  icon TEXT DEFAULT 'code',
  default_phases JSONB NOT NULL DEFAULT '[]',
  default_payment_splits JSONB DEFAULT '[{"percent":50,"label":"Contrato"},{"percent":50,"label":"Entrega"}]',
  default_roles JSONB DEFAULT '["coder","seo","design"]',
  onboarding_questions JSONB DEFAULT '[]',
  is_custom BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed templates padrão
INSERT INTO project_type_templates (id, project_type, name, icon, default_phases, default_roles, onboarding_questions)
VALUES
  ('tmpl_website', 'website', 'Website / Landing', 'globe', '[
    {"title":"Contrato & Setup","description":"Assinar contrato, criar repo GitHub, subir subdomínio staging","duration_days":3,"deliverables":["Contrato assinado","Repo GitHub","Staging online"],"review_required":false,"payment_trigger":true},
    {"title":"Discovery & Design","description":"Briefing completo, wireframes, aprovação visual","duration_days":7,"deliverables":["Briefing","Wireframes","Design aprovado"],"review_required":false,"payment_trigger":false},
    {"title":"Desenvolvimento","description":"Frontend, backend, integrações","duration_days":14,"deliverables":["Código frontend","Backend/API","Integrações"],"review_required":false,"payment_trigger":false},
    {"title":"Revisão em Grupo","description":"Votação interna, QA, testes","duration_days":3,"deliverables":["QA pass","Testes OK","Aprovação CEOs"],"review_required":true,"payment_trigger":false},
    {"title":"Deploy & SEO","description":"Publicação, indexação, analytics","duration_days":2,"deliverables":["Site no ar","Google Index","Analytics"],"review_required":false,"payment_trigger":false},
    {"title":"Entrega Final","description":"Handoff, documentação, treinamento","duration_days":2,"deliverables":["Documentação","Treinamento","Entrega assinada"],"review_required":false,"payment_trigger":true}
  ]', '["coder","seo","design"]', '[
    {"id":"blog","label":"Precisa de blog?","type":"boolean","default":false},
    {"id":"ecommerce","label":"E-commerce integrado?","type":"boolean","default":false},
    {"id":"multilang","label":"Multilíngue?","type":"boolean","default":false},
    {"id":"pages","label":"Número estimado de páginas","type":"number","default":5}
  ]')
  ON CONFLICT (project_type) DO NOTHING;

INSERT INTO project_type_templates (id, project_type, name, icon, default_phases, default_roles, onboarding_questions)
VALUES
  ('tmpl_app', 'app', 'App Mobile', 'smartphone', '[
    {"title":"Contrato & Setup","description":"Assinar contrato, criar repo, configurar contas de dev","duration_days":3,"deliverables":["Contrato","Repo","Contas dev"],"review_required":false,"payment_trigger":true},
    {"title":"Discovery & UX Research","description":"Pesquisa de usuários, personas, jornadas","duration_days":5,"deliverables":["Personas","Jornadas","Pesquisa"],"review_required":false,"payment_trigger":false},
    {"title":"Protótipos & Design System","description":"Wireframes, protótipos interativos, design system","duration_days":7,"deliverables":["Protótipos","Design System","Assets"],"review_required":false,"payment_trigger":false},
    {"title":"Desenvolvimento","description":"Frontend mobile, backend, API","duration_days":21,"deliverables":["App","Backend","API"],"review_required":false,"payment_trigger":false},
    {"title":"Testes & Beta","description":"TestFlight / Play Console, beta testers","duration_days":7,"deliverables":["Beta build","Feedback","Bugs fix"],"review_required":false,"payment_trigger":false},
    {"title":"Revisão em Grupo","description":"Votação interna de qualidade","duration_days":2,"deliverables":["Aprovação CEOs"],"review_required":true,"payment_trigger":false},
    {"title":"Deploy Loja","description":"Publicação App Store / Play Store","duration_days":3,"deliverables":["App publicado","Screenshots","Descrição"],"review_required":false,"payment_trigger":false},
    {"title":"Entrega Final","description":"Handoff, documentação","duration_days":2,"deliverables":["Doc","Treinamento"],"review_required":false,"payment_trigger":true}
  ]', '["coder","design","devops"]', '[
    {"id":"platform","label":"Plataforma","type":"select","options":["iOS","Android","Ambos"],"default":"Ambos"},
    {"id":"backend","label":"Precisa de backend?","type":"boolean","default":true},
    {"id":"social_login","label":"Login social?","type":"boolean","default":false}
  ]')
  ON CONFLICT (project_type) DO NOTHING;

INSERT INTO project_type_templates (id, project_type, name, icon, default_phases, default_roles, onboarding_questions)
VALUES
  ('tmpl_sistema', 'sistema', 'Sistema / SaaS', 'server', '[
    {"title":"Contrato & Setup","description":"Contrato, arquitetura inicial, ambiente","duration_days":3,"deliverables":["Contrato","Arquitetura","Ambiente"],"review_required":false,"payment_trigger":true},
    {"title":"Discovery & Arquitetura","description":"Requisitos, arquitetura de sistema, stack","duration_days":7,"deliverables":["SRS","Diagramas","Stack definido"],"review_required":false,"payment_trigger":false},
    {"title":"MVP Core","description":"Funcionalidades core do sistema","duration_days":14,"deliverables":["MVP funcional","Auth","Core features"],"review_required":false,"payment_trigger":false},
    {"title":"Iterações & Features","description":"Features adicionais, refinamentos","duration_days":14,"deliverables":["Features","Refinamentos"],"review_required":false,"payment_trigger":false},
    {"title":"Segurança & Performance","description":"Audit de segurança, otimização","duration_days":5,"deliverables":["Audit","Otimização","Pen-test"],"review_required":false,"payment_trigger":false},
    {"title":"Revisão em Grupo","description":"Votação interna","duration_days":2,"deliverables":["Aprovação CEOs"],"review_required":true,"payment_trigger":false},
    {"title":"Deploy Produção","description":"Deploy em produção, monitoramento","duration_days":3,"deliverables":["Produção","Monitoramento","Backups"],"review_required":false,"payment_trigger":false},
    {"title":"Entrega Final","description":"Documentação, treinamento","duration_days":2,"deliverables":["Doc","Treinamento"],"review_required":false,"payment_trigger":true}
  ]', '["coder","security","devops"]', '[
    {"id":"users_est","label":"Usuários estimados","type":"number","default":100},
    {"id":"integrations","label":"Integrações necessárias","type":"text","default":""},
    {"id":"security_level","label":"Nível de segurança","type":"select","options":["Padrão","Alto","Crítico"],"default":"Padrão"}
  ]')
  ON CONFLICT (project_type) DO NOTHING;

INSERT INTO project_type_templates (id, project_type, name, icon, default_phases, default_roles, onboarding_questions)
VALUES
  ('tmpl_ecommerce', 'ecommerce', 'E-commerce', 'shopping-cart', '[
    {"title":"Contrato & Setup","description":"Contrato, gateway de pagamento, conta marketplace","duration_days":3,"deliverables":["Contrato","Gateway","Conta"],"review_required":false,"payment_trigger":true},
    {"title":"Discovery & Design","description":"Catálogo, UX de checkout, design","duration_days":7,"deliverables":["Catálogo","Checkout UX","Design"],"review_required":false,"payment_trigger":false},
    {"title":"Desenvolvimento","description":"Loja, painel admin, integrações","duration_days":14,"deliverables":["Loja","Admin","Integrações"],"review_required":false,"payment_trigger":false},
    {"title":"Revisão em Grupo","description":"QA, testes de checkout","duration_days":3,"deliverables":["QA","Checkout test"],"review_required":true,"payment_trigger":false},
    {"title":"Deploy & SEO","description":"Publicação, produtos, indexação","duration_days":3,"deliverables":["Loja no ar","Produtos","SEO"],"review_required":false,"payment_trigger":false},
    {"title":"Entrega Final","description":"Treinamento, documentação","duration_days":2,"deliverables":["Doc","Treinamento"],"review_required":false,"payment_trigger":true}
  ]', '["coder","seo","design"]', '[
    {"id":"products","label":"Número de produtos estimado","type":"number","default":50},
    {"id":"payments","label":"Gateways de pagamento","type":"text","default":"Stripe, PayPal"},
    {"id":"shipping","label":"Integração com envio?","type":"boolean","default":true}
  ]')
  ON CONFLICT (project_type) DO NOTHING;

-- ============================================================
-- 2. PROJECT ROADMAPS
-- ============================================================
CREATE TABLE IF NOT EXISTS project_roadmaps (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  client_id TEXT REFERENCES workspace_clients(id) ON DELETE SET NULL,
  lead_id TEXT REFERENCES leads(id) ON DELETE SET NULL,
  project_type TEXT NOT NULL DEFAULT 'website',
  status TEXT DEFAULT 'active', -- active | paused | completed | cancelled | at_risk
  total_value NUMERIC DEFAULT 0,
  currency TEXT DEFAULT 'EUR',
  payment_schedule JSONB DEFAULT '[]',
  github_repo TEXT,
  subdomain TEXT,
  current_phase_index INTEGER DEFAULT 0,
  phases JSONB DEFAULT '[]',
  expected_end_date DATE,
  onboarding_answers JSONB DEFAULT '{}',
  created_by TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  deleted_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_roadmaps_status ON project_roadmaps(status);
CREATE INDEX IF NOT EXISTS idx_roadmaps_client ON project_roadmaps(client_id);
CREATE INDEX IF NOT EXISTS idx_roadmaps_lead ON project_roadmaps(lead_id);
CREATE INDEX IF NOT EXISTS idx_roadmaps_type ON project_roadmaps(project_type);

-- ============================================================
-- 3. PROJECT TIMELINES
-- ============================================================
CREATE TABLE IF NOT EXISTS project_timelines (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT REFERENCES project_roadmaps(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'coder',
  assigned_to TEXT,
  parent_timeline_id TEXT REFERENCES project_timelines(id) ON DELETE CASCADE,
  steps JSONB DEFAULT '[]',
  current_step_index INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending', -- pending | active | completed | blocked
  version INTEGER DEFAULT 1, -- optimistic locking
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_timelines_roadmap ON project_timelines(roadmap_id);
CREATE INDEX IF NOT EXISTS idx_timelines_role ON project_timelines(role);
CREATE INDEX IF NOT EXISTS idx_timelines_status ON project_timelines(status);

-- ============================================================
-- 4. TIMELINE COLLABORATORS (evita race condition no JSONB)
-- ============================================================
CREATE TABLE IF NOT EXISTS timeline_collaborators (
  id TEXT PRIMARY KEY,
  timeline_id TEXT REFERENCES project_timelines(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  user_name TEXT,
  user_color TEXT,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT true,
  UNIQUE(timeline_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_collab_timeline ON timeline_collaborators(timeline_id);
CREATE INDEX IF NOT EXISTS idx_collab_user ON timeline_collaborators(user_id);
CREATE INDEX IF NOT EXISTS idx_collab_active ON timeline_collaborators(is_active);

-- ============================================================
-- 5. ROADMAP PHASE HISTORY (auditoria de mudanças)
-- ============================================================
CREATE TABLE IF NOT EXISTS roadmap_phase_history (
  id TEXT PRIMARY KEY,
  roadmap_id TEXT REFERENCES project_roadmaps(id) ON DELETE CASCADE,
  from_index INTEGER NOT NULL,
  to_index INTEGER NOT NULL,
  changed_by TEXT,
  changed_at TIMESTAMPTZ DEFAULT NOW(),
  reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_phase_history_roadmap ON roadmap_phase_history(roadmap_id);

-- ============================================================
-- 6. CAMPOS ADICIONAIS EM LEADS
-- ============================================================
ALTER TABLE leads ADD COLUMN IF NOT EXISTS project_type TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS preferred_stack JSONB DEFAULT '[]';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS improvement_plan JSONB DEFAULT '{}';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contract_signed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contract_value NUMERIC DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS contract_currency TEXT DEFAULT 'EUR';

-- ============================================================
-- 7. CAMPOS ADICIONAIS EM COMPANY TASKS (link bidirecional)
-- ============================================================
ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS source_roadmap_id TEXT;
ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS source_timeline_id TEXT;
ALTER TABLE company_tasks ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}';

-- ============================================================
-- 8. CAMPOS ADICIONAIS EM PAYMENTS (link com roadmap)
-- ============================================================
ALTER TABLE payments ADD COLUMN IF NOT EXISTS linked_roadmap_id TEXT;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS payment_phase TEXT;

-- ============================================================
-- 9. NOTA: voting_sessions é mantido em JSON file (backend/data/voting-sessions.json)
-- Os campos linked_timeline_id, linked_roadmap_id, review_meeting_at
-- serão adicionados ao schema do JSON no voting-routes.js
-- ============================================================
