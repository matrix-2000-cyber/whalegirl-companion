#requires -Version 7.2
param([string]$Address = '', [ValidateSet('owner','friend')][string]$Role = 'owner', [string]$Name = '')
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (-not $Name) { $Name = if ($Role -eq 'owner') { '爸爸' } else { '朋友' } }
if (-not $Address) {
  $addressInfo = Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.InterfaceAlias -match 'WLAN|Wi-Fi|Ethernet|以太网' -and $_.IPAddress -match '^(192\.168\.|10\.|172\.(1[6-9]|2[0-9]|3[01])\.)' } | Select-Object -First 1
  if (-not $addressInfo) { throw 'No LAN address found. Supply -Address with the computer LAN IP.' }
  $Address = $addressInfo.IPAddress
}
$parsed = $null
if (-not [Net.IPAddress]::TryParse($Address, [ref]$parsed) -or $parsed.AddressFamily -ne [Net.Sockets.AddressFamily]::InterNetwork) { throw 'Address must be an IPv4 address.' }
Push-Location $root
try {
  & (Join-Path $PSScriptRoot 'init-mobile-tls.ps1')
  $listen = Get-NetTCPConnection -LocalPort 3091 -State Listen -ErrorAction SilentlyContinue
  if (-not $listen) {
    $node = (Get-Command node).Source
    $process = Start-Process -FilePath $node -ArgumentList @('mobile-gateway/server.mjs','--lan') -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput (Join-Path $root '.mobile-gateway\gateway.log') -RedirectStandardError (Join-Path $root '.mobile-gateway\gateway-error.log') -PassThru
    $process.Id | Set-Content (Join-Path $root '.mobile-gateway\gateway.pid') -Encoding ASCII
    Start-Sleep -Seconds 2
    if ($process.HasExited) { throw 'Mobile gateway failed to start. Check .mobile-gateway/gateway-error.log.' }
  }
  & node mobile-gateway/manage.mjs invite $Role $Name ('https://' + $Address + ':3091')
  if ($LASTEXITCODE) { throw 'Pairing page could not be created.' }
  Write-Output ('Open locally: ' + (Join-Path $root ('.mobile-gateway\invite-' + $Role + '.html')))
  Write-Output 'Use the same Wi-Fi for the first phone test. This script does not change Windows Firewall.'
} finally { Pop-Location }
