#requires -Version 7.2
param([switch]$NoOpen,[switch]$Lan)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
function Test-WhalePort([int]$Port) {
  $probe=[Net.Sockets.TcpClient]::new()
  try { return $probe.ConnectAsync('127.0.0.1',$Port).Wait(1200) -and $probe.Connected }
  catch { return $false } finally { $probe.Dispose() }
}
$env:WHALEGIRL_ROOT=$root
$env:QQ_BRIDGE_ASR_PYTHON=Join-Path $root '.desktop-runtime/venv/Scripts/python.exe'
$env:MEET_MODELS=Join-Path $root '.desktop-runtime/models'
Push-Location $root
try {
  if (-not (Test-Path -LiteralPath (Join-Path $root '.mobile-gateway/tls.json'))) { & (Join-Path $PSScriptRoot 'init-mobile-tls.ps1') }
  $node = (Get-Command node).Source
  foreach ($service in @(@{Port=3091;File='mobile-gateway/server.mjs';Name='gateway'},@{Port=3092;File='desktop-app/server.mjs';Name='desktop'})) {
    if (-not (Test-WhalePort $service.Port)) {
      $arguments=@($service.File);if($service.Name -eq 'gateway' -and $Lan){$arguments+='--lan'}
      $child = Start-Process -FilePath $node -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root ('.mobile-gateway\'+$service.Name+'.log')) -RedirectStandardError (Join-Path $root ('.mobile-gateway\'+$service.Name+'-error.log')) -PassThru
      $child.Id | Set-Content (Join-Path $root ('.mobile-gateway\'+$service.Name+'.pid')) -Encoding ASCII
      Start-Sleep -Seconds 2
      if ($child.HasExited) { throw ('Unable to start '+$service.Name+'; check its local log.') }
    }
  }
  $ready=Invoke-RestMethod 'http://127.0.0.1:3092/health' -NoProxy -TimeoutSec 5
  if (-not $ready.ok) { throw 'Desktop service is not ready.' }
  if (-not $NoOpen) {
    $edge='C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
    if (Test-Path -LiteralPath $edge) { Start-Process -FilePath $edge -ArgumentList @('--app=http://127.0.0.1:3092') -WindowStyle Normal }
    else { Start-Process 'http://127.0.0.1:3092' }
  }
  Write-Output 'WhaleGirl desktop is ready: http://127.0.0.1:3092 (no QR pairing required).'
} finally { Pop-Location }
