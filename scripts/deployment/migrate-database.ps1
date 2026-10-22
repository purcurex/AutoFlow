param(
  [ValidateSet('show', 'run', 'revert')]
  [string]$Action = 'show',
  [switch]$ConfirmRevert
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$arguments = @((Join-Path $root 'scripts\deployment\migrate-compiled.mjs'), $Action)
if ($ConfirmRevert) {
  $arguments += '--confirm-revert'
}

Push-Location $root
try {
  & node @arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Database migration action failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
