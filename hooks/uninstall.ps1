param(
    [string]$Agent,
    [switch]$All,
    [string]$UserHome = $env:USERPROFILE
)

$ErrorActionPreference = "Stop"

if (-not $UserHome) {
    throw "UserHome is empty; pass -UserHome or set USERPROFILE."
}

if (-not $All -and -not $Agent) {
    throw "Pass -Agent <id> or -All."
}

$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "Hook uninstaller requires node on PATH, but node was not found."
    exit 2
}

$manage = Join-Path $PSScriptRoot "lib\manage.cjs"
if ($All) {
    & node $manage uninstall --all --user-home $UserHome
} else {
    & node $manage uninstall --agent $Agent --user-home $UserHome
}
exit $LASTEXITCODE
