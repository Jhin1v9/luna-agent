-- ============================================================
-- Luna Active Learning — Persistência de Exemplos de Treinamento
-- ============================================================
-- Guarda exemplos adicionados em runtime (active learning) para que
-- o modelo não perca o que aprende quando o dyno reinicia.

CREATE TABLE IF NOT EXISTS luna_training_examples (
  id          SERIAL PRIMARY KEY,
  lang        TEXT NOT NULL CHECK (lang IN ('pt', 'es', 'ca')),
  utterance   TEXT NOT NULL,
  intent      TEXT NOT NULL,
  source      TEXT DEFAULT 'active_learning',
  created_at  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_luna_training_intent ON luna_training_examples(intent);
CREATE INDEX IF NOT EXISTS idx_luna_training_lang    ON luna_training_examples(lang);

-- Evita duplicatas exatas
CREATE UNIQUE INDEX IF NOT EXISTS idx_luna_training_unique
  ON luna_training_examples(lang, utterance, intent);
