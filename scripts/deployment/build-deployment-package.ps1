param(
  [string]$Version = (Get-Date -Format 'yyyyMMdd-HHmmss'),
  [switch]$SkipBuild,
  [switch]$AllowWorkingTree
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Push-Location $root
try {
  if (-not $SkipBuild) {
    & npm.cmd run build
    if ($LASTEXITCODE -ne 0) { throw 'Build failed.' }
  }
  $arguments = @('scripts/deployment/build-production-package.mjs', $Version)
  if ($AllowWorkingTree) { $arguments += '--allow-working-tree' }
  & node @arguments
  if ($LASTEXITCODE -ne 0) { throw 'Deployment packaging failed.' }
} finally { Pop-Location }
