param(
  [switch]$RunChecks
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path

function Invoke-Checked {
  param([string]$Command, [string[]]$Arguments)
  & $Command @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Command failed with exit code $LASTEXITCODE."
  }
}

Push-Location $root
try {
  Invoke-Checked 'npm.cmd' @('ci')
  if ($RunChecks) {
    Invoke-Checked 'npm.cmd' @('run', 'ci:local')
  } else {
    Invoke-Checked 'npm.cmd' @('run', 'build')
  }
  Write-Output "AutoFlow source installation and build completed: $root"
} finally {
  Pop-Location
}
