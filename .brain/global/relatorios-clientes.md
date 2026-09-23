# Global — Nexo Digital

Regras operacionais, procedimentos e decisões. Append-only, assinado `data + autor`.

## 2026-09-24 · REGRA (decreto owner) — Relatório de cliente é obrigatório
- **Todo cliente ativo tem que ter relatório em `vps.nexo-digital.app/relatorios/`.**
- A Luna checa isso em TODA varredura: login por e-mail do cliente em `/relatorios/entrar`
  (cliente entra só com e-mail; sem senha) e conferir se o relatório existe e está atualizado
  (seção "Pendências do cliente" tem que refletir os pedidos abertos do painel).
- Sem relatório = pendência registrada e reportada ao Abner.
- autor: Luna (registrando decreto verbal do owner, 2026-09-24 ~01:40)

## 2026-09-24 · Inventário de relatórios (baseline)
| Cliente | E-mail de acesso | Relatório | Estado |
|---|---|---|---|
| HDM Industrial | hdm-industrial@nexo-digital.app | /relatorios/clientes/hdm/ | ✅ existe, **desatualizado** (14/09 — não cobre pedidos de 21/09) |
| JR Reformas (Juninho) | juninho@nexo-digital.app | /relatorios/clientes/jr-reformas/ | ✅ completo |
| Santa Fe | santafe@nexo-digital.app | /relatorios/clientes/santafe/ | ⚠️ acesso OK, conteúdo "em breve" |
| Ona Dance (Jess) | — | — | ❌ SEM acesso, SEM card, SEM relatório |
- Nota: e-mail jr-reformas@nexo-digital.app (painel) ≠ juninho@nexo-digital.app (relatórios).
- autor: Luna
