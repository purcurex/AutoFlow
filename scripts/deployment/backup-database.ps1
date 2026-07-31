param(
  [string]$Container = 'hyperzone',
  [string]$Database = 'autoflow',
  [string]$Username = 'autoflow',
  [string]$OutputDirectory = '.\backups'
)

$ErrorActionPreference = 'Stop'
$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$filename = "autoflow-$timestamp.dump"
$outputRoot = [IO.Path]::GetFullPath($OutputDirectory)
$destination = Join-Path $outputRoot $filename
$containerPath = "/tmp/$filename"

New-Item -ItemType Directory -Path $outputRoot -Force | Out-Null

& docker inspect $Container | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Docker container '$Container' is unavailable."
}

& docker exec $Container pg_dump -U $Username -d $Database -Fc -f $containerPath
if ($LASTEXITCODE -ne 0) {
  throw "pg_dump failed with exit code $LASTEXITCODE."
}

& docker cp "${Container}:$containerPath" $destination
if ($LASTEXITCODE -ne 0) {
  throw "docker cp failed with exit code $LASTEXITCODE."
}

& docker exec $Container rm -f $containerPath | Out-Null

$hash = (Get-FileHash -Algorithm SHA256 -LiteralPath $destination).Hash.ToLowerInvariant()
Set-Content -LiteralPath "$destination.sha256" -Value "$hash  $filename" -Encoding ascii

Write-Output "Database backup: $destination"
Write-Output "SHA256: $hash"
