<#
.SYNOPSIS
    Met à jour le référentiel des criticités des règles PingCastle (HCRules.csv).

.DESCRIPTION
    Les niveaux de criticité (1 à 5) ne figurent pas dans les rapports XML : ils sont
    déclarés dans le code source de PingCastle, via les attributs [RuleDurANSSI(...)]
    ou [RuleMaturityLevel(...)] de chaque règle.

    Ce script parcourt le dépôt GitHub netwrix/pingcastle, extrait le couple
    RiskId / niveau de chaque règle et met à jour le fichier CSV utilisé par
    New-PingCastleDashboard.ps1.

    Nécessite un accès Internet vers api.github.com et raw.githubusercontent.com.

.PARAMETER Path
    Fichier CSV à mettre à jour. Par défaut : .\data\HCRules.csv

.PARAMETER Branch
    Branche du dépôt PingCastle à interroger. Par défaut : master

.PARAMETER Token
    Jeton GitHub (facultatif). L'API GitHub anonyme est limitée à 60 requêtes par
    heure, ce qui peut être insuffisant : un jeton porte la limite à 5000.

.EXAMPLE
    .\Update-HCRules.ps1

.EXAMPLE
    .\Update-HCRules.ps1 -Token $env:GITHUB_TOKEN
#>

#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess)]
param(
    [string]$Path = "$PSScriptRoot\data\HCRules.csv",
    [string]$Branch = 'master',
    [string]$Token
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$headers = @{ 'User-Agent' = 'PCR-PingCastleDashboard' }
if ($Token) { $headers['Authorization'] = "token $Token" }

$apiUri = "https://api.github.com/repos/netwrix/pingcastle/contents/PingCastleCommon/Healthcheck/Rules?ref=$Branch"

Write-Host "[*] Interrogation du dépôt netwrix/pingcastle (branche $Branch)…" -ForegroundColor Cyan

try {
    # NB : en Windows PowerShell 5.1, Invoke-RestMethod redirigé directement dans un
    # pipeline émet le tableau JSON comme un objet unique. On stocke avant de filtrer.
    $response = Invoke-RestMethod -Method GET -Uri $apiUri -Headers $headers
    $files = @($response | Where-Object { $_.name -like '*.cs' })
}
catch {
    Write-Error @"
Impossible de contacter l'API GitHub : $($_.Exception.Message)

Causes fréquentes :
  - pas d'accès Internet depuis cette machine ;
  - quota de l'API GitHub atteint (60 requêtes/heure en anonyme) → relancez avec -Token ;
  - chemin des règles modifié dans le dépôt PingCastle.

Le fichier '$Path' n'a pas été modifié.
"@
    return
}

if (-not $files.Count) { throw "Aucun fichier de règle trouvé à l'adresse $apiUri" }
Write-Host "[*] $($files.Count) fichier(s) de règle à analyser" -ForegroundColor Cyan

$i = 0
$rules = foreach ($file in $files) {

    $i++
    Write-Progress -Activity 'Extraction des règles PingCastle' -Status $file.name `
        -PercentComplete (($i / $files.Count) * 100)

    try { $code = Invoke-RestMethod -Method GET -Uri $file.download_url -Headers $headers }
    catch { Write-Warning "$($file.name) : téléchargement impossible, fichier ignoré."; continue }

    $riskId = [regex]::Match($code, '\[RuleModel\s*\(\s*"([^"]+)"').Groups[1].Value
    if (-not $riskId) { continue }

    # Le niveau ANSSI prime sur le niveau de maturité quand les deux sont présents.
    $level = [regex]::Match($code, '\[RuleDurANSSI\s*\(\s*(\d)').Groups[1].Value
    if (-not $level) { $level = [regex]::Match($code, '\[RuleMaturityLevel\s*\(\s*(\d)').Groups[1].Value }
    if (-not $level) { Write-Warning "$riskId : aucun niveau de criticité trouvé."; continue }

    [PSCustomObject]@{ RiskId = $riskId; Level = $level }
}
Write-Progress -Activity 'Extraction des règles PingCastle' -Completed

$rules = @($rules | Sort-Object RiskId -Unique)
if (-not $rules.Count) { throw 'Aucune règle exploitable extraite : mise à jour annulée.' }

# ----------------------------------------------------------------------- #
# Comparaison avec le référentiel actuel
# ----------------------------------------------------------------------- #

$existing = @{}
if (Test-Path -LiteralPath $Path) {
    Import-Csv -Path $Path -Delimiter ';' -Encoding UTF8 |
        ForEach-Object { if ($_.RiskId) { $existing[$_.RiskId] = $_.Level } }
}

$added = @($rules | Where-Object { -not $existing.ContainsKey($_.RiskId) })
$changed = @($rules | Where-Object { $existing.ContainsKey($_.RiskId) -and $existing[$_.RiskId] -ne $_.Level })
$removed = @($existing.Keys | Where-Object { $_ -notin $rules.RiskId })

Write-Host ''
Write-Host "  $($rules.Count) règle(s) extraite(s) — $($existing.Count) dans le fichier actuel" -ForegroundColor Cyan
Write-Host "  + $($added.Count) ajoutée(s)   ~ $($changed.Count) modifiée(s)   - $($removed.Count) retirée(s)" -ForegroundColor Cyan
Write-Host ''

if ($added.Count) {
    Write-Host 'Nouvelles règles :' -ForegroundColor Green
    $added | ForEach-Object { Write-Host ("  + {0,-42} N{1}" -f $_.RiskId, $_.Level) -ForegroundColor Green }
}
if ($changed.Count) {
    Write-Host 'Criticités modifiées :' -ForegroundColor Yellow
    $changed | ForEach-Object {
        Write-Host ("  ~ {0,-42} N{1} → N{2}" -f $_.RiskId, $existing[$_.RiskId], $_.Level) -ForegroundColor Yellow
    }
}
if ($removed.Count) {
    Write-Host 'Règles disparues du dépôt :' -ForegroundColor DarkGray
    $removed | Sort-Object | ForEach-Object { Write-Host "  - $_" -ForegroundColor DarkGray }
}

if (-not ($added.Count -or $changed.Count -or $removed.Count)) {
    Write-Host 'Le référentiel est déjà à jour.' -ForegroundColor Green
    return
}

if ($PSCmdlet.ShouldProcess($Path, 'Mettre à jour le référentiel de criticités')) {
    $dir = Split-Path -Path $Path -Parent
    if ($dir -and -not (Test-Path -LiteralPath $dir)) { $null = New-Item -Path $dir -ItemType Directory -Force }

    $csv = $rules | ConvertTo-Csv -Delimiter ';' -NoTypeInformation
    [System.IO.File]::WriteAllLines($Path, $csv, (New-Object System.Text.UTF8Encoding($false)))

    Write-Host ''
    Write-Host "[>] $Path mis à jour ($($rules.Count) règles)" -ForegroundColor Yellow
}
