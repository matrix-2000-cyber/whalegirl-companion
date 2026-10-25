param([Parameter(Mandatory)][string]$Source,[Parameter(Mandatory)][string]$Output)
$ErrorActionPreference='Stop'
$sourceRoot=(Resolve-Path -LiteralPath $Source).Path
if(!(Test-Path -LiteralPath (Join-Path $sourceRoot 'README.md'))){throw 'Pass an audited public source export'}
$outputRoot=[IO.Path]::GetFullPath($Output)
New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
function Make-Zip([string]$Base,[string]$Target,[object[]]$Files){
 if(Test-Path -LiteralPath $Target){Remove-Item -LiteralPath $Target}
 $zip=[IO.Compression.ZipFile]::Open($Target,[IO.Compression.ZipArchiveMode]::Create)
 try{foreach($file in $Files){$relative=[IO.Path]::GetRelativePath($Base,$file.FullName).Replace('\','/');$entry=$zip.CreateEntry($relative,[IO.Compression.CompressionLevel]::Optimal);$entry.LastWriteTime=[DateTimeOffset]::new(2026,10,26,0,0,0,[TimeSpan]::Zero);$inputFile=[IO.File]::OpenRead($file.FullName);$outputFile=$entry.Open();try{$inputFile.CopyTo($outputFile)}finally{$inputFile.Dispose();$outputFile.Dispose()}}}finally{$zip.Dispose()}
}
$files=@(Get-ChildItem -LiteralPath $sourceRoot -Recurse -File -Force | Where-Object { $_.Name -ne 'PACKAGE-MANIFEST.json' -and !$_.FullName.StartsWith($outputRoot+[IO.Path]::DirectorySeparatorChar,[StringComparison]::OrdinalIgnoreCase) } | Sort-Object FullName)
foreach($file in $files){
 $relative=[IO.Path]::GetRelativePath($sourceRoot,$file.FullName).Replace('\','/')
 if($relative -match '(^|/)(\.git|node_modules|\.env(?:\.[^/]+)?|\.mobile-gateway|\.desktop-runtime|\.dsh|\.dsh-meow|\.memsearch|logs|backups|out)(/|$)|\.(pem|key|pfx|p12|db|sqlite|log|keystore|jks)$|cookie|credential|local\.properties|key\.properties'){throw "Private/runtime file in source; build refused: $relative"}
 if(($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0){throw 'Linked source file refused'}
}
$manifest=@(foreach($file in $files){@{path=[IO.Path]::GetRelativePath($sourceRoot,$file.FullName).Replace('\','/');sha256=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()}})
[IO.File]::WriteAllText((Join-Path $sourceRoot 'PACKAGE-MANIFEST.json'),($manifest | ConvertTo-Json -Depth 5),[Text.UTF8Encoding]::new($false))
$files+=Get-Item -LiteralPath (Join-Path $sourceRoot 'PACKAGE-MANIFEST.json')
$appZip=Join-Path $outputRoot 'app.zip';Make-Zip $sourceRoot $appZip $files
$installer=Join-Path $sourceRoot 'installer'
$scripts=Join-Path $outputRoot 'scripts.zip';Make-Zip $installer $scripts @(Get-ChildItem -LiteralPath $installer -File | Where-Object Extension -in '.mjs','.json','.py' | Sort-Object Name)
$compiler=Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
$exe=Join-Path $outputRoot 'WhaleGirl-Setup-0.4.0-win-x64.exe'
& $compiler /nologo /target:winexe /platform:x64 /optimize+ /debug- /codepage:65001 /r:System.Windows.Forms.dll /r:System.Drawing.dll /r:System.IO.Compression.dll /r:System.IO.Compression.FileSystem.dll /r:System.Web.Extensions.dll /r:Microsoft.CSharp.dll "/win32manifest:$(Join-Path $installer 'app.manifest')" "/resource:$appZip,app.zip" "/resource:$scripts,scripts.zip" "/out:$exe" (Join-Path $installer 'Bootstrap.cs')
if($LASTEXITCODE){throw 'Native setup compilation failed'}
$sum=(Get-FileHash -LiteralPath $exe -Algorithm SHA256).Hash.ToLowerInvariant()
[IO.File]::WriteAllText((Join-Path $outputRoot 'SHA256SUMS.txt'),"$sum  $([IO.Path]::GetFileName($exe))`n",[Text.UTF8Encoding]::new($false))
Write-Host "Built $([IO.Path]::GetFileName($exe)) ($((Get-Item -LiteralPath $exe).Length) bytes)"
