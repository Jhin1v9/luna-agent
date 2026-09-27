@echo off
setlocal
rem luna-stack.bat — liga/desliga a stack Luna (Docker Postgres + pm2)
rem Uso: luna on | luna off | luna status
rem Origem: luna-agent\scripts\luna-stack.bat (manter em sync com a skill luna-off-on)

set REPO=C:\Users\Abner\Documents\Luna cto\luna-agent
set DOCKER="C:\Program Files\Docker\Docker\resources\bin\docker.exe"
set PM2=%APPDATA%\npm\pm2.cmd

if "%~1"=="on" goto ON
if "%~1"=="off" goto OFF
if "%~1"=="status" goto STATUS
echo Uso: luna on ^| luna off ^| luna status
exit /b 1

:ON
echo [luna] verificando Docker...
%DOCKER% ps >nul 2>&1
if errorlevel 1 (
  echo [luna] Docker Desktop nao responde — abrindo...
  start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
  timeout /t 60 /nobreak >nul
  %DOCKER% ps >nul 2>&1
  if errorlevel 1 (
    echo [luna] ERRO: Docker nao respondeu. Abra o Docker Desktop e tente de novo.
    exit /b 1
  )
)
echo [luna] subindo Postgres...
%DOCKER% ps --format "{{.Names}}" | findstr /c:"luna-postgres" >nul 2>&1
if not errorlevel 1 goto PGOK
%DOCKER% ps -a --format "{{.Names}}" | findstr /c:"luna-postgres" >nul 2>&1
if errorlevel 1 (
  %DOCKER% run --name luna-postgres -e POSTGRES_USER=luna -e POSTGRES_PASSWORD=luna -e POSTGRES_DB=luna -p 5433:5432 -d postgres:16
) else (
  %DOCKER% start luna-postgres
)
set /a PGT=0
:PGWAIT
%DOCKER% exec luna-postgres pg_isready -U luna >nul 2>&1
if not errorlevel 1 goto PGOK
set /a PGT+=1
if %PGT% GEQ 30 goto PGFALHA
timeout /t 1 /nobreak >nul
goto PGWAIT
:PGFALHA
echo [luna] ERRO: postgres nao respondeu em 30s
exit /b 1
:PGOK
echo [luna] postgres pronto (localhost:5433)
echo [luna] subindo pm2...
call %PM2% jlist 2>nul | findstr /c:"luna-orchestrator" >nul 2>&1
if errorlevel 1 (
  call %PM2% start "%REPO%\ecosystem.config.cjs"
  call %PM2% save
) else (
  call %PM2% restart all
)
echo [luna] aguardando health...
set /a TENT=0
:AGUARDA
curl -s -o nul -w "%%{http_code}" http://localhost:3100/ready 2>nul | findstr /c:"200" >nul 2>&1
if not errorlevel 1 goto PRONTO
set /a TENT+=1
if %TENT% GEQ 30 goto FALHA
timeout /t 2 /nobreak >nul
goto AGUARDA
:FALHA
echo [luna] ERRO: /ready nao respondeu em 60s — veja: call %PM2% logs
exit /b 1
:PRONTO
call %PM2% status
echo [luna] pronto — stack no ar (postgres 5433 + pm2 + /ready 200)
exit /b 0

:OFF
echo [luna] parando pm2...
call %PM2% stop all
echo [luna] parando postgres...
%DOCKER% stop luna-postgres
echo [luna] stack desligada. (pm2 save NAO executado de proposito)
exit /b 0

:STATUS
call %PM2% status
%DOCKER% ps --filter "name=luna-postgres"
curl -s -o nul -w "health:%%{http_code} " http://localhost:3100/health
curl -s -o nul -w "ready:%%{http_code}\n" http://localhost:3100/ready
exit /b 0
