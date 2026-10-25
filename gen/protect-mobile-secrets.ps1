#requires -Version 7.2
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$principals = @([Security.Principal.WindowsIdentity]::GetCurrent().User, [Security.Principal.SecurityIdentifier]::new('S-1-5-18'))
foreach ($relative in @('.mobile-gateway', 'mobile-app\android\key.properties')) {
  $path = Join-Path $root $relative
  if (-not (Test-Path -LiteralPath $path)) { continue }
  $item = Get-Item -LiteralPath $path
  $acl = Get-Acl -LiteralPath $path
  $acl.SetAccessRuleProtection($true, $false)
  $inherit = if ($item.PSIsContainer) { [Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit' } else { [Security.AccessControl.InheritanceFlags]::None }
  foreach ($sid in $principals) {
    $acl.AddAccessRule([Security.AccessControl.FileSystemAccessRule]::new($sid, [Security.AccessControl.FileSystemRights]::FullControl, $inherit, [Security.AccessControl.PropagationFlags]::None, [Security.AccessControl.AccessControlType]::Allow))
  }
  Set-Acl -LiteralPath $path -AclObject $acl
}
