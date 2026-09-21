# ADR-026 — Classifier pós-conversa (§27): taxonomia pequena, Brain alimentado por commit/sinapse

- **Status:** aceito (2026-09-21, F3 adiantado — decreto owner Brain/Sinapses)
- **Contexto:** o owner decretou: "cada commit já virar uma sinapse" e
  classificação rica de clientes/projetos. Pesquisa rápida de boas práticas
  convergiu em: **taxonomia PEQUENA e travada antes do código** (5–12 labels
  distintas com exemplos — projetos de classifier falham na taxonomia, não no
  modelo); campos padrão de roteamento = intent/urgency/topic/sentiment +
  follow-up; e generalistas **superestimam nuance** quando o schema é amplo —
  schema simples, zero-shot com saída JSON.

## Decisões

1. **Taxonomia (zod, versionada no código)**: outcome
   (resuelto/cliente_feliz/queria_mejora/sugestao/reclamacao/outro — §27),
   sentiment (positivo/neutro/negativo), topic (site/design/conteudo/
   dominio_hospedagem/financeiro/prazo/suporte_tecnico/pedido_novo/outro —
   9 labels do escopo Nexo), product (livre), urgency
   (baixa/normal/alta/critica), follow_up_required + nota, quality_score 1-5
   (qualidade da resposta da Luna), summary 1-2 frases, client_signal
   (pedido/reclamacao_recorrente/elogio/duvida/nenhum — sinal de negócio).
2. **Pipeline**: handler ao RESOLVED → job `conversation.classify` na cola
   (idempotente por evento) → worker roda o FAST com prompt estruturado →
   grava `conversations.classification` (migração 007), acumula sinais em
   `clients.profile`, append no Brain (`OPINIONES.md` do cliente + sinapse +
   `memory_index`). Falha de parse = audit explícito, nunca derruba.
3. **Sinapses**: `@luna/brain` (package real) — `appendSynapse` escreve
   `.brain/luna/synapses/YYYY-MM.md` (uma linha por classificação/commit,
   append-only, assinado, com correlation). O hook de "commit → sinapse"
   para commits de CÓDIGO entra como script de pós-commit (instalação local
   do owner); o formato já é estável.
4. **Clientes↔projetos**: `projects.client_id` (FK) existe desde a 001 —
   link sem migração. Seed dev: Jess (Onadance) + Site Onadance; NEXO
   Internal + Produção 2026 (grupo interno ≠ cliente).

## Fontes da pesquisa

- [Auto-categorize support tickets (Cyberax)](https://cyberax.com/ai-playbook/auto-categorize-support-tickets) — taxonomia travada primeiro
- [AI email classifier (CodeWords)](https://www.codewords.ai/blog/how-to-build-an-ai-email-classifier) — intent/urgency/topic/sender
- [Event-driven agent triage (Vertical Idea)](https://verticalidea.co/blog/let-s-build-an-event-driven-ai-agent-with-langgraph-go-pgvector-and-redis-streams-part-3/) — schema JSON pequeno com fallback
- [Benchmarking classification SLM (ScaleDown)](https://tinyml.substack.com/p/benchmarking-scaledowns-classification) — generalista superestima nuance
