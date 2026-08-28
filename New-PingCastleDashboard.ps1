<#
.SYNOPSIS
    Génère un tableau de bord HTML moderne à partir de rapports PingCastle (XML).

.DESCRIPTION
    Le script analyse les fichiers XML produits par PingCastle (ad_hc_*.xml), les
    regroupe par domaine, calcule l'évolution des scores et produit un tableau de
    bord HTML autonome : aucune dépendance externe, aucun CDN, aucun module
    PowerShell tiers. Le fichier généré peut être ouvert hors ligne ou envoyé par
    mail tel quel.

.PARAMETER XMLPath
    Dossier contenant les rapports XML PingCastle. Si omis, une boîte de dialogue
    de sélection de fichiers est affichée.

.PARAMETER OutputPath
    Dossier de destination du ou des fichiers HTML. Par défaut : .\output

.PARAMETER FileName
    Nom du fichier HTML généré en mode consolidé. Par défaut : PingCastleDashboard.html

.PARAMETER Title
    Titre affiché dans l'onglet du navigateur.

.PARAMETER DateFormat
    Format des dates dans les graphiques et tableaux. Par défaut : yyyy-MM-dd

.PARAMETER SplitPerDomain
    Génère un fichier HTML distinct par domaine (dashboard_<domaine>.html) au lieu
    d'un fichier unique regroupant tous les domaines.

.PARAMETER ExceptionsFile
    Chemin du CSV des exceptions. Par défaut : .\data\exceptions.csv

.PARAMETER RulesFile
    Chemin du CSV des règles PingCastle (criticités). Par défaut : .\data\HCRules.csv

.PARAMETER DoNotShow
    N'ouvre pas le rapport dans le navigateur à la fin de la génération.

.EXAMPLE
    .\New-PingCastleDashboard.ps1 -XMLPath .\xml

.EXAMPLE
    .\New-PingCastleDashboard.ps1 -XMLPath \\srv\pingcastle$ -SplitPerDomain -DoNotShow
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
    [System.IO.DirectoryInfo]$XMLPath,
    [System.IO.DirectoryInfo]$OutputPath = "$PSScriptRoot\output",
    [string]$FileName = 'PingCastleDashboard.html',
    [string]$Title = 'PingCastle Trend',
    [string]$DateFormat = 'yyyy-MM-dd',
    [switch]$SplitPerDomain,
    [string]$ExceptionsFile = "$PSScriptRoot\data\exceptions.csv",
    [string]$RulesFile = "$PSScriptRoot\data\HCRules.csv",
    [switch]$DoNotShow
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

function Select-XmlFile {
    param([string]$Directory = $PSScriptRoot)

    $null = [System.Reflection.Assembly]::LoadWithPartialName('System.Windows.Forms')
    $dialog = New-Object System.Windows.Forms.OpenFileDialog
    $dialog.InitialDirectory = (Get-Item $Directory).FullName
    $dialog.Filter = 'Rapports PingCastle (*.xml)|*.xml'
    $dialog.Multiselect = $true
    $dialog.Title = 'Sélectionnez les rapports PingCastle à analyser'
    $null = $dialog.ShowDialog()
    $dialog.FileNames
}

function ConvertTo-SafeJson {
    param([Parameter(Mandatory)]$InputObject)

    $json = $InputObject | ConvertTo-Json -Depth 12 -Compress
    # Neutralise les caractères pouvant casser le bloc <script> du template.
    $json = $json.Replace('<', '\u003c').Replace('>', '\u003e').Replace('&', '\u0026')
    $json.Replace([string][char]0x2028, '\u2028').Replace([string][char]0x2029, '\u2029')
}

function Write-Utf8File {
    param([string]$Path, [string]$Content)

    $utf8 = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($Path, $Content, $utf8)
}

# Niveaux fonctionnels AD, indexés par la valeur du XML PingCastle
$FunctionalLevels = @(
    'Windows 2000', 'Windows 2003 interim', 'Windows Server 2003', 'Windows Server 2008',
    'Windows Server 2008 R2', 'Windows Server 2012', 'Windows Server 2012 R2',
    'Windows Server 2016', 'Windows Server 2025'
)

# --------------------------------------------------------------------------- #
# 1. Collecte des fichiers XML
# --------------------------------------------------------------------------- #

if ($XMLPath) {
    if (-not (Test-Path -Path $XMLPath.FullName -PathType Container)) {
        throw "Le dossier '$($XMLPath.FullName)' est introuvable."
    }
    $xmlFiles = Get-ChildItem -Path $XMLPath.FullName -Filter '*.xml' -Recurse -File
}
else {
    $xmlFiles = Select-XmlFile -Directory $PSScriptRoot | ForEach-Object { Get-Item -LiteralPath $_ }
}

if (-not $xmlFiles) {
    Write-Warning 'Aucun fichier XML sélectionné. Arrêt.'
    return
}

Write-Host "[*] $(($xmlFiles | Measure-Object).Count) fichier(s) XML à analyser" -ForegroundColor Cyan

# --------------------------------------------------------------------------- #
# 2. Référentiel des règles (criticité ANSSI) et exceptions
# --------------------------------------------------------------------------- #

$ruleLevel = @{}
if (Test-Path -LiteralPath $RulesFile) {
    Import-Csv -Path $RulesFile -Delimiter ';' -Encoding UTF8 | ForEach-Object {
        if ($_.RiskId) { $ruleLevel[$_.RiskId] = [int]$_.Level }
    }
    Write-Host "[*] $($ruleLevel.Count) règles connues chargées depuis HCRules.csv" -ForegroundColor Cyan
}
else {
    Write-Warning "Fichier de règles introuvable ($RulesFile) : les criticités ne seront pas affichées."
}

$exceptions = @()
if (Test-Path -LiteralPath $ExceptionsFile) {
    $exceptions = @(Import-Csv -Path $ExceptionsFile -Delimiter ';' -Encoding UTF8 |
        Where-Object { $_.RiskId })
    if ($exceptions.Count) {
        Write-Host "[*] $($exceptions.Count) exception(s) chargée(s)" -ForegroundColor Cyan
    }
}

# --------------------------------------------------------------------------- #
# 3. Analyse des rapports
# --------------------------------------------------------------------------- #

$now = Get-Date
$i = 0
$total = ($xmlFiles | Measure-Object).Count

$reports = foreach ($file in $xmlFiles) {

    $i++
    Write-Progress -Activity 'Analyse des rapports PingCastle' -Status $file.Name `
        -PercentComplete (($i / $total) * 100)

    try { $xml = [xml](Get-Content -LiteralPath $file.FullName -Raw -Encoding UTF8) }
    catch { Write-Warning "$($file.Name) : XML illisible, fichier ignoré."; continue }

    $hc = $xml.HealthcheckData
    if (-not $hc -or -not $hc.DomainFQDN) {
        Write-Warning "$($file.Name) : ce n'est pas un rapport HealthCheck PingCastle, fichier ignoré."
        continue
    }

    $date = [datetime]::Parse($hc.GenerationDate, [Globalization.CultureInfo]::InvariantCulture)

    $rules = @(
        foreach ($rule in $hc.RiskRules.HealthcheckRiskRule) {
            $lvl = $null
            if ($ruleLevel.ContainsKey($rule.RiskId)) { $lvl = $ruleLevel[$rule.RiskId] }
            [PSCustomObject]@{
                id        = [string]$rule.RiskId
                points    = [int]$rule.Points
                level     = $lvl
                category  = [string]$rule.Category
                model     = [string]$rule.Model
                rationale = [string]$rule.Rationale
            }
        }
    )

    $domainLevel = 0
    $forestLevel = 0
    if ($hc.DomainFunctionalLevel) { $domainLevel = [int]$hc.DomainFunctionalLevel }
    if ($hc.ForestFunctionalLevel) { $forestLevel = [int]$hc.ForestFunctionalLevel }

    [PSCustomObject]@{
        domain     = [string]$hc.DomainFQDN
        date       = $date
        label      = Get-Date $date -Format $DateFormat
        dateLong   = Get-Date $date -Format 'D'
        month      = Get-Date $date -Format 'yyyy-MM'
        age        = [int]([math]::Max(0, ($now - $date).TotalDays))
        version    = [string]$hc.EngineVersion
        maturity   = if ($hc.MaturityLevel) { [int]$hc.MaturityLevel } else { $null }
        domainMode = $FunctionalLevels[$domainLevel]
        forestMode = $FunctionalLevels[$forestLevel]
        dcCount    = if ($hc.NumberOfDC) { [int]$hc.NumberOfDC } else { $null }
        file       = $file.Name
        scores     = [PSCustomObject]@{
            global     = [int]$hc.GlobalScore
            stale      = [int]$hc.StaleObjectsScore
            privileged = [int]$hc.PrivilegiedGroupScore
            trust      = [int]$hc.TrustScore
            anomaly    = [int]$hc.AnomalyScore
        }
        rules      = $rules
        ignored    = @()
    }
}
Write-Progress -Activity 'Analyse des rapports PingCastle' -Completed

if (-not $reports) { throw 'Aucun rapport PingCastle exploitable trouvé.' }
$reports = @($reports)

# --------------------------------------------------------------------------- #
# 4. Exceptions : on sort les règles exclues du calcul
# --------------------------------------------------------------------------- #

foreach ($report in $reports) {
    $excluded = @($exceptions |
        Where-Object { $_.Domain -eq $report.domain -or $_.Domain -eq '*' } |
        ForEach-Object { $_.RiskId })

    if ($excluded.Count) {
        $report.ignored = @($report.rules | Where-Object { $excluded -contains $_.id })
        $report.rules = @($report.rules | Where-Object { $excluded -notcontains $_.id })
    }
}

# --------------------------------------------------------------------------- #
# 5. Regroupement par domaine
# --------------------------------------------------------------------------- #

$domains = foreach ($name in ($reports.domain | Sort-Object -Unique)) {
    $set = @($reports | Where-Object { $_.domain -eq $name } | Sort-Object date)
    [PSCustomObject]@{
        name    = $name
        reports = @($set | Select-Object -Property * -ExcludeProperty domain, date)
    }
}
$domains = @($domains)

foreach ($d in $domains) {
    Write-Host ("[+] {0,-38} {1} rapport(s)  {2} → {3}" -f `
            $d.name, $d.reports.Count, $d.reports[0].label, $d.reports[-1].label) -ForegroundColor Green
}

# --------------------------------------------------------------------------- #
# 6. Rendu HTML
# --------------------------------------------------------------------------- #

$templateFile = "$PSScriptRoot\data\template.html"
$appFile = "$PSScriptRoot\data\app.js"
foreach ($f in @($templateFile, $appFile)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Fichier manquant : $f" }
}
$template = [System.IO.File]::ReadAllText($templateFile, [System.Text.Encoding]::UTF8)
$appJs = [System.IO.File]::ReadAllText($appFile, [System.Text.Encoding]::UTF8)

if (-not (Test-Path -Path $OutputPath.FullName -PathType Container)) {
    $null = New-Item -Path $OutputPath.FullName -ItemType Directory -Force
}

function New-Dashboard {
    param(
        [Parameter(Mandatory)][array]$Domains,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$PageTitle
    )

    $payload = [PSCustomObject]@{
        generated   = Get-Date $now -Format 'dd/MM/yyyy HH:mm'
        title       = $PageTitle
        reportCount = ($Domains.reports | Measure-Object).Count
        domains     = $Domains
    }

    $html = $template.
        Replace('__PCD_TITLE__', [System.Net.WebUtility]::HtmlEncode($PageTitle)).
        Replace('__PCD_DATA__', (ConvertTo-SafeJson -InputObject $payload)).
        Replace('__PCD_APP__', $appJs)

    Write-Utf8File -Path $Path -Content $html
    Write-Host "[>] $Path ($([math]::Round((Get-Item -LiteralPath $Path).Length / 1KB)) Ko)" -ForegroundColor Yellow
    $Path
}

$generated = @()

if ($SplitPerDomain) {
    foreach ($d in $domains) {
        $safe = ($d.name -replace '[^\w\.\-]', '_')
        $generated += New-Dashboard -Domains @($d) `
            -Path (Join-Path $OutputPath.FullName "dashboard_$safe.html") `
            -PageTitle "$Title - $($d.name)"
    }
}
else {
    $generated += New-Dashboard -Domains $domains `
        -Path (Join-Path $OutputPath.FullName $FileName) `
        -PageTitle $Title
}

if (-not $DoNotShow) { $generated | ForEach-Object { Start-Process $_ } }

Write-Host ''
Write-Host "Terminé : $($generated.Count) fichier(s) généré(s) dans $($OutputPath.FullName)" -ForegroundColor Cyan
