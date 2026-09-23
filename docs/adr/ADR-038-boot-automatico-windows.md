# ADR-038 — Cadeia de boot automático no Windows (login → Luna no ar)

Data: 2026-09-23
Status: aceito

## Contexto

Os 4 daemons pm2 estavam com ~50 restarts acumulados por sessão e o owner
relatava "pm2 dando erro pra startar". Diagnóstico ao vivo:

1. `luna-postgres` (container Docker) tinha restart policy `no` — **não subia
   sozinho** com o Docker Desktop. No boot, a porta 5433 nunca ficava pronta.
2. `pm2-windows-startup` (chave `HKCU\...\Run\PM2`) já esperava a porta 5433,
   mas com teto de só 180s e, pior, com o banco inatingível o
   `pm2 resurrect` crashava os serviços em loop de qualquer forma.
3. Os erros antigos de `pino-pretty`/`createRequire` nos `.err.log` eram
   réguas históricas (corrigidos antes — o código atual importa
   `createRequire` e o módulo está instalado).

## Decisão

Cadeia de boot (tudo a nível de usuário, sem serviço Windows, sem admin):

1. **Login do Windows** → `HKCU\...\Run` dispara:
   - `Docker Desktop` (Docker Desktop.exe) → sobe o engine WSL.
2. Com o engine no ar, **`luna-postgres` (restart=`always`)** sobe sozinho e
   libera a porta 5433.
3. `HKCU\...\Run\PM2` (pm2-windows-startup, via `invisible.vbs` — janela
   oculta, ADR-028) executa `pm2_resurrect.cmd`, que **espera a porta 5433
   por até 600s** (WSL frio no boot pode demorar minutos) e só então roda
   `pm2 resurrect` a partir do `~/.pm2/dump.pm2` (`pm2 save` feito).

pm2 continua ressobindo processos que caem; watchdog supervisiona por cima.
Dump atualizado em todo `pm2 save` — **nunca editar o dump à mão**.

## Consequências

- Boot → Luna completa (Postgres + 4 serviços) sem toque humano.
- Serviços não nascem mais antes do banco: fim do crash loop.
- Se o Docker Desktop falhar inteiro, os serviços não sobem (falha explícita,
  recuperação manual) — aceito: sem Docker não há banco, sem banco não há Luna.
- Itens 1 e 2 de "Ações manuais do owner" do README ficam resolvidos por
   esta cadeia (pm2 no boot; sem janelas de CMD — resurrect roda oculto).

## Verificação

- `docker inspect luna-postgres --format '{{.HostConfig.RestartPolicy.Name}}'`
  → `always`
- `reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run"` →
  entradas `Docker Desktop` e `PM2` presentes.
- Boot real testado pelo owner no próximo login.
