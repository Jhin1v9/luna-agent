# SKILL — Brain Canônico (principal-brain)

> Toda sessão da Luna (Kimi Code, Kimi Work, crons) OBRIGATORIAMENTE conhece
> e acompanha o brain canônico. Decreto owner 2026-09-25.

## O que é
- Repo GitHub: **https://github.com/Jhin1v9/principal-brain** (o "brain de verdade").
- Deploy: `https://vps.nexo-digital.app/brain` (Atlas — gerado de `atlas/public/data.js` pelo `node atlas/generate.mjs` no clone do VPS).
- **A API `/brain/api/*` é leitura. Escrita = git no repo + pull no VPS + regenerate.**

## Estrutura (o que já está lá — migração 2026-09-25)
- `luna/` — BRAIN INTEIRO da Luna CTO (migrado do PC): `luna/clients/` (fichas de TODOS os clientes: HDM com PEDIDOS, Jess, produção, pai...), `luna/luna/synapses/` (diário de tudo), `luna/luna/selectors/`, `luna/system/` (ADRs, decisões), `luna/global/relatorios-clientes.md`.
- `reports/clients/<slug>/` — fichas de clientes (cluster Relatórios no Atlas).
- `projects/` — projetos. `memory/` `knowledge/` `runbooks/` `automation/` etc.

## Regra de rotina (crons e varreduras)
**A CADA rodada:** `git -C <clone-do-brain> pull` (ou `git fetch && git diff HEAD..origin/main --stat`) e LEIA o que mudou. Diff de cliente/projeto/decisão = contexto novo que pode exigir ação (avisar o time, atualizar ficha, criar solicitação). Silêncio só quando NÃO há mudança.

## Escrever no brain
1. Arquivos locais: append-only, assine `data + autor: Luna`.
2. Sincronizar: copiar pro clone do principal-brain (estrutura acima), commit autor Luna, push.
3. No VPS: `git pull && node atlas/generate.mjs` (ou pede pro dono/SSH).

## NUNCA
- Nunca deixar conhecimento só no PC local — se não está no principal-brain, não existe.
- Nunca editar `atlas/public/data.js` na mão (é gerado).
