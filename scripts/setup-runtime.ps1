#requires -Version 7.2
param([switch]$SkipSpeech)
$ErrorActionPreference='Stop'
$projectRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runtimeRoot=Join-Path $projectRoot '.desktop-runtime'
$modelRoot=Join-Path $runtimeRoot 'models'
New-Item -ItemType Directory -Path $runtimeRoot,$modelRoot -Force | Out-Null
& npm install --prefix (Join-Path $runtimeRoot 'vision') --ignore-scripts --no-audit --no-fund @mediapipe/tasks-vision@1.1.1
if($LASTEXITCODE){throw 'MediaPipe installation failed.'}
foreach($kind in @('hand','face')){
  $target=Join-Path $modelRoot ($kind+'_landmarker.task')
  if(-not(Test-Path -LiteralPath $target)){
    $uri="https://storage.googleapis.com/mediapipe-models/$($kind)_landmarker/$($kind)_landmarker/float16/1/$($kind)_landmarker.task"
    Invoke-WebRequest -Uri $uri -OutFile ($target+'.download')
    Move-Item -LiteralPath ($target+'.download') -Destination $target
  }
}
if(-not $SkipSpeech){
  $venvRoot=Join-Path $runtimeRoot 'venv'
  $pythonExe=Join-Path $venvRoot 'Scripts\python.exe'
  if(-not(Test-Path -LiteralPath $pythonExe)){
    & python -m venv $venvRoot
    if($LASTEXITCODE){throw 'Python venv creation failed.'}
  }
  & $pythonExe -m pip install -r (Join-Path $projectRoot 'desktop-app\requirements-tts.txt') numpy sherpa-onnx
  if($LASTEXITCODE){throw 'Python dependencies failed.'}
  $modelName='sherpa-onnx-sense-voice-zh-en-ja-ko-yue-2024-07-17'
  if(-not(Test-Path -LiteralPath (Join-Path $modelRoot ($modelName+'\model.int8.onnx')))){
    $archivePath=Join-Path $runtimeRoot ($modelName+'.tar.bz2')
    Invoke-WebRequest -Uri ('https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/'+$modelName+'.tar.bz2') -OutFile $archivePath
    & tar -xf $archivePath -C $modelRoot
    if($LASTEXITCODE){throw 'SenseVoice extraction failed.'}
  }
}
Get-ChildItem -LiteralPath $modelRoot -File | Get-FileHash -Algorithm SHA256 | Select-Object Path,Hash
Write-Output 'Runtime prepared. Configure DSH and its target session before starting the desktop.'
