# Texto pra colar nos prompts dos crons do Kimi Work (Geral, Voz, Varredura, Cérebro 24/7)

Acrescenta isso no final do prompt de cada automação:

---
## BRAIN CANÔNICO (obrigatório toda rodada)
O brain de verdade é o repo https://github.com/Jhin1v9/principal-brain (deploy: vps.nexo-digital.app/brain). A CADA rodada: rode `git -C C:/Users/Abner/Documents/principal-brain pull` (se não existir, clone uma vez: `git clone https://github.com/Jhin1v9/principal-brain`) e veja o diff (`git diff HEAD~1 --stat` ou `git log --oneline -5`). Tudo sobre clientes, projetos e decisões da Luna CTO está na pasta `luna/` (clients/, luna/synapses/, system/). Diff relevante = contexto novo: considere ação (atualizar ficha, avisar o grupo, criar solicitação). Leia a skill `.kimi-code/skills/brain-principal/SKILL.md` pra detalhes. Conhecimento que ficar só no PC local NÃO existe — brain canônico é a fonte.
---
