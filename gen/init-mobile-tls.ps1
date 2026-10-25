$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..\.mobile-gateway'))
New-Item -ItemType Directory -Path $root -Force | Out-Null
& (Join-Path $PSScriptRoot 'protect-mobile-secrets.ps1')
$file = Join-Path $root 'tls.json'
if (Test-Path -LiteralPath $file) { Write-Output 'Existing mobile certificate preserved.'; exit 0 }
$rsa = [Security.Cryptography.RSA]::Create(2048)
$request = [Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=WhaleGirl Mobile', $rsa, [Security.Cryptography.HashAlgorithmName]::SHA256, [Security.Cryptography.RSASignaturePadding]::Pkcs1)
$certificate = $request.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-5), [DateTimeOffset]::UtcNow.AddYears(1))
$values = @{ key = $rsa.ExportPkcs8PrivateKeyPem(); cert = $certificate.ExportCertificatePem() }
[IO.File]::WriteAllText($file, ($values | ConvertTo-Json), [Text.UTF8Encoding]::new($false))
$certificate.Dispose(); $rsa.Dispose()
Write-Output 'Mobile HTTPS certificate created locally. App trusts only the paired certificate fingerprint.'
