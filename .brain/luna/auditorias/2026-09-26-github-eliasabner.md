# Auditoria GitHub — conta eliasabner (pedido de Enoque via handoff, 26/09/2026)

autor: Luna · 2026-09-26 · referência: handoff Enoque "fechar repos públicos"

## Resultado da auditoria

- A conta citada ("org elias-abner") **não existe** — a conta real é **`eliasabner`** (User, desde 2017).
- **18 repositórios 100% PÚBLICOS**, todos de 2017–2020: trabalhos de curso (Senac/Xamarin/Ionic/Android) + aulas de Git. Lista: OdontoApp, HoraCertaIonic, ProjetoMobile, CrudAndroidXamarim, Crud_Android_Mysql, MobileXamarin, ProjetoXamarim, Mobile_Noite, xamarimMobile, eliasabner.github.io, GitIgnore, ProjetoSenac, AulaGItInit2, AulaGit2, AulaGit-1, AulaGitilnit, AulaGit, eliasabner_diretorio.
- **Varredura de credenciais no histórico completo dos 18 repos (git log --all -p): NENHUMA credencial real exposta.** Achados avaliados e descartados: `PublicKeyToken=` (chaves públicas do boilerplate .NET), `Test123!` (exercício de md5/sha1 em AulaGit2), SQL com interpolação (ProjetoMobile, sem valor hardcoded), section declarations de connectionStrings (machine.config padrão). → **Não há credencial a rotacionar.**

## BLOQUEIO de execução (ação humana designada)

- **Privar os repos: NÃO EXECUTADO — token GitHub ativo (Jhin1v9) tem pull-only nos repos** (permissions.admin=false). Quem abriu a solicitação já designou a execução ao owner (Abner) ou Jhin com acesso de dono.
- Caminho de execução (dono da conta `eliasabner`, logado):
  `gh repo list eliasabner --limit 100 --json name --jq '.[].name' | xargs -I{} gh repo edit eliasabner/{} --visibility private --accept-visibility-change-consequences`
  (ou GitHub Web → Settings → Danger Zone → Change visibility, repo por repo).
- Recomendação: privar **todos os 18** (são trampo/curso antigos; nenhum é portfólio ativo). O pages `eliasabner.github.io` deixa de servir ao privar (avisar o Elias).
- **Reforço de segurança (regra do time): NUNCA subir contrasenha/token/credencial em repo (nem privado) nem no brain — o brain é memória de contexto, não cofre.** Enoque segurou o envio; manter assim.
