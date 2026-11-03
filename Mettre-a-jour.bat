@echo off
rem Force la mise a jour de MyProxmox depuis GitHub, sans lancer l'app.
title MyProxmox - mise a jour
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\update.ps1" -Force & pause & exit /b
