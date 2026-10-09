# PAUTA — Reunião com Miranda (Gestión Contable) — 01/10/2026

Fontes: especificacao_sistema_gestoria_miranda.md (v1.0, trecho recebido) + thread Production 01/10 + benchmark Contasimple.
Lead dashboard: lead-1790882990504-xe66 (assignedTo abner).

## 1. Entender a operação dela (escuta antes de propor)
- Quantos clientes (autónomos/empresas) ela gere hoje? Crescimento esperado em 12m?
- Volume de faturas/mês; emite só faturas ou faz contabilidade completa + nóminas?
- O que ela mais odeia no ContaSimple hoje? (dores reais = escopo)
- Como recebe os dados dos clientes hoje (papel, email, Drive)?

## 2. Escopo proposto — MVP (multi-tenant desde o zero)
- **3 perfis:** admin da gestoria (matrix) / gestor de conta / cliente autónomo (portal simples).
- **Faturação com Verifactu** (obrigatório AEAT 2026) — alinhamento fiscal é o core.
- Dashboard da matrix: carteira de clientes, estado fiscal de cada um, alertas de prazo.
- Importação de dados do ContaSimple (CSV) — migração sem trauma.
- Segurança nativa (checklist Enoque): RLS por tenant, rate limit, audit log, secrets fora do código.
- **Fase 2 (não prometer no MVP):** nóminas, integração bancária, app mobile do cliente.

## 3. Preço — âncora Contasimple, valor de matrix
- Referência: Contasimple cobra do autónomo 0€/10,95€/15,95€+IVA — sem visão de gestoria.
- Proposta: setup 990–1.900€ (conforme escopo fechado) + mensalidade base 189€ (matrix) + por cliente ativo ~5–9€/mês.
- Cliente final dela paga preço simples (tipo ContaSimple) — margem dela ou repasse.
- Sem permanência (padrão Nexo), garantia de 30 dias.

## 4. Motor de crescimento (o que ela oferece)
- Ela vira cliente-âncora + canal: cada cliente dela vira usuário do sistema.
- Modelo de parceria: desconto progressivo na mensalidade dela por volume de clientes indicados, ou % recorrente.
- Ganho Nexo: base instalada multiplicável por gestorias (vertical replicável — tese do Abner).

## 5. Prazo e entrega
- Stack Nexo (Postgres+RLS, Next.js, VPS própria): MVP em 4–6 semanas.
- Entrega 1: protótipo navegável (o próprio doc pede isso) — 1 semana, antes de fechar preço final.
- Entrega 2: MVP em produção com migração assistida dos primeiros clientes.

## 6. Próximos passos pós-call
- Fechar escopo MVP por escrito → proposta comercial com 2 opções de preço.
- Registrar org/cliente no painel Nexo; contrato com cláusula de parceria de indicação.

---
*Luna · material interno Nexo Digital · 01/10/2026*
