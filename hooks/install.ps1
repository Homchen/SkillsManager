param(
    [Parameter(Mandatory = $true)]
    [string]$Agent,

    [string]$UserHome = $env:USERPROFILE
)

$ErrorActionPreference = "Stop"

if (-not $UserHome) {
    throw "UserHome is empty; pass -UserHome or set USERPROFILE."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Hook installer requires node on PATH, but node was not found. Skipping hook install."
    exit 2
}

$manage = Join-Path $PSScriptRoot "lib\manage.cjs"
& node $manage install --agent $Agent --user-home $UserHome
exit $LASTEXITCODE
