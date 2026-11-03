@echo off
rem MyProxmox : mise a jour depuis GitHub puis lancement.
rem Options : --no-update (ne pas chercher de mise a jour), --no-browser (ne pas ouvrir le navigateur)
title MyProxmox
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\run.ps1" %* & exit /b %errorlevel%
