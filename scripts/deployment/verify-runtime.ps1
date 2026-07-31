param(
  [int]$Port = 3199
)

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$env:AUTOFLOW_VERIFY_PORT = [string]$Port

Push-Location $root
try {
  & node (Join-Path $root 'scripts\deployment\verify-runtime.mjs')
  if ($LASTEXITCODE -ne 0) {
    throw "Deployment runtime verification failed with exit code $LASTEXITCODE."
  }
} finally {
  Pop-Location
}
