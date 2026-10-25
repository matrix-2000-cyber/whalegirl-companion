@echo off
cd /d "%~dp0"
where pwsh >nul 2>nul
if errorlevel 1 (
  echo Please install PowerShell 7.2 or later, then try again.
  pause
  exit /b 1
)
pwsh -NoProfile -File "%~dp0gen\start-desktop.ps1" %*
if errorlevel 1 pause
