@echo off
rem ===========================================================================
rem  Community app card creator -- Windows one-click entry (ASCII only:
rem  cmd.exe reads .cmd in the OEM code page, so keep this file non-Chinese).
rem  It calls PowerShell with -ExecutionPolicy Bypass so the machine policy
rem  ("running scripts is disabled on this system") cannot block the .ps1.
rem  Usage: scripts\create-app-cards.cmd            (interactive)
rem         scripts\create-app-cards.cmd -DryRun    (preview only)
rem ===========================================================================
setlocal
set "SCRIPT=%~dp0create-app-cards.ps1"
if not exist "%SCRIPT%" (
  echo [ERROR] cannot find "%SCRIPT%"
  pause
  exit /b 1
)
where pwsh >nul 2>nul
if %errorlevel%==0 (
  pwsh -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT%" %*
) else (
  powershell -NoProfile -NoLogo -ExecutionPolicy Bypass -File "%SCRIPT%" %*
)
set "CODE=%errorlevel%"
rem keep the window open when launched by double-click (no arguments)
if "%~1"=="" pause
endlocal & exit /b %CODE%
