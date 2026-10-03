@echo off
rem Nexo Digital - Luna stack auto-start (decreto owner 03/10/2026)
rem 1) sobe Docker Desktop  2) espera o daemon  3) pm2 resurrect
rem Idempotente: se rodar 2x, pm2 reclama "process already launched" e segue.
rem So dispara no LOGON do usuario — boot parado na tela de bloqueio nao sobe nada.
start "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
:waitdocker
timeout /t 10 /nobreak >nul
docker info >nul 2>&1
if errorlevel 1 goto waitdocker
timeout /t 5 /nobreak >nul
call "C:\Users\Abner\AppData\Roaming\npm\pm2.cmd" resurrect
