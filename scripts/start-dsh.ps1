#requires -Version 7.2
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$env:WHALEGIRL_ROOT=$projectRoot
$env:QQ_BRIDGE_ASR_PYTHON=Join-Path $projectRoot '.desktop-runtime\venv\Scripts\python.exe'
$env:QQ_BRIDGE_TTS_SCRIPT=Join-Path $projectRoot 'desktop-app\tts.py'
$env:MEET_MODELS=Join-Path $projectRoot '.desktop-runtime\models'
Push-Location $projectRoot
try { & dsh web } finally { Pop-Location }
