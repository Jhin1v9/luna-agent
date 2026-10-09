# Checklist de segurança + qualidade web — Enoque (CEO) · VERSÃO FINAL 2026-10-02

> Origem: Enoque no privado (versão final recebida 02/10 ~13h).
> Regra: TODAS as webs da operação passam por esta revisão — mesmo as puramente HTML.

## Segurança (revisão obrigatória)
1. **XSS** — ataques mediante campos (validar/escapar toda entrada)
2. **Rotas de API expostas** — se o sistema não valida o ID, qualquer um entra (IDOR)
3. **Chaves de API expostas** — no código ou no GitHub de fácil acesso
4. **Banco de dados sem regras de acesso** — SQL injection
5. **Sem limite de tentativas de login** — rate limit obrigatório (anti-robô/brute force)
6. **Prompt injection** — em IAs
7. **Sistemas de leitura/escuta de e-mails e mensagens** — instrução maliciosa embutida no texto
8. **Pacotes inventados/falsos** — bibliotecas perigosas
9. **RLS** — Row Level Security (Supabase)
10. **Sistema de error 403** — permissões e alertas se algo passar por alto

## Que as webs tenham

**Legal y seguridad**
- Aviso legal + info generada por IA
- Política de privacidad
- Aviso de cookies
- Forçar HTTPS

**Para que Google a encontre**
- Meta títulos e descrições
- Dados estruturados
- Sitemap e robots.txt
- Ficha de Google
- Favicon

**Que se veja bem**
- Texto alternativo nas imagens
- Imagens comprimidas
- Velocidade de carga otimizada
- Contraste de cores
- Que se veja bem no móvel

**Que funcione de verdade**
- Página 404 personalizada
- Links quebrados consertados
- Formulários protegidos contra spam
- Botão de WhatsApp visível
- Analítica instalada
- Uma só chamada à ação

**Sobre o trabalho**
- Respeitar acima de tudo o prompt e o design passados

## Como usar
- Toda revisão/sweep de projeto web (Nexo ou cliente) inclui este checklist completo.
- Achados viram solicitação/pedido com prioridade de segurança.
