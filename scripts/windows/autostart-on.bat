@echo off
rem Lance MyProxmox (avec mise a jour) a chaque ouverture de session Windows.
set "LAUNCHER=%~dp0..\..\MyProxmox.bat"
for %%I in ("%LAUNCHER%") do set "LAUNCHER=%%~fI"
schtasks /Create /TN "MyProxmox" /TR "\"%LAUNCHER%\" --no-browser" /SC ONLOGON /DELAY 0000:30 /RL LIMITED /F
if errorlevel 1 (
  echo.
  echo  Impossible de creer la tache planifiee.
) else (
  echo.
  echo  C'est fait : MyProxmox demarrera 30 secondes apres chaque ouverture de session,
  echo  apres avoir recupere la derniere version sur GitHub.
  echo  Pour annuler : autostart-off.bat
)
pause
