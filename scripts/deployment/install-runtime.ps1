param()

$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$envPath = Join-Path $root 'backend\.env'

if (-not (Test-Path -LiteralPath $envPath)) {
  throw "Missing backend/.env. Copy deployment/.env.production.example and configure it first."
}

Push-Location $root
try {
  & npm.cmd ci --omit=dev
  if ($LASTEXITCODE -ne 0) {
    throw "npm ci --omit=dev failed with exit code $LASTEXITCODE."
  }
  New-Item -ItemType Directory -Path (Join-Path $root 'backend\uploads') -Force | Out-Null
  Write-Output "Production runtime dependencies installed."
} finally {
  Pop-Location
}
