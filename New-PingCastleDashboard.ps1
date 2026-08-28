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

.PARAMETER Logo
    Logo affiché dans le bandeau et sur la couverture du PDF, embarqué en base64
    dans le rapport. Par défaut : .\data\logo.png

.PARAMETER Pdf
    Sans effet : le PDF est produit par défaut. Conservé pour ne pas casser les
    commandes et tâches planifiées existantes.

.PARAMETER NoPdf
    N'génère aucun PDF. Le tableau de bord reste léger, mais son bouton n'a plus
    de PDF à ouvrir et retombe sur la boîte d'impression du navigateur.

.PARAMETER PdfSummary
    Limite le PDF au dernier rapport de chaque domaine, au lieu de détailler
    chaque passe.

.PARAMETER NoEmbedPdf
    N'embarque pas le PDF dans le HTML. Le fichier .pdf est bien produit, mais le
    tableau de bord reste léger et son bouton retombe sur l'impression.

.PARAMETER DoNotShow
    N'ouvre rien à la fin de la génération.

.EXAMPLE
    .\New-PingCastleDashboard.ps1 -XMLPath .\xml

    Produit le tableau de bord HTML et le rapport PDF.

.EXAMPLE
    .\New-PingCastleDashboard.ps1 -XMLPath .\xml -NoPdf

    Tableau de bord seul, génération plus rapide.

.EXAMPLE
    .\New-PingCastleDashboard.ps1 -XMLPath \\srv\pingcastle$ -SplitPerDomain -DoNotShow
#>

#Requires -Version 5.1
[CmdletBinding()]
param(
    [System.IO.DirectoryInfo]$XMLPath,
    [System.IO.DirectoryInfo]$OutputPath,
    [string]$FileName = 'PingCastleDashboard.html',
    [string]$Title = 'PingCastle Trend',
    [string]$DateFormat = 'yyyy-MM-dd',
    [switch]$SplitPerDomain,
    [string]$ExceptionsFile,
    [string]$RulesFile,
    [string]$Logo,
    [switch]$Pdf,
    [switch]$NoPdf,
    [switch]$PdfSummary,
    [switch]$NoEmbedPdf,
    [switch]$DoNotShow
)

$ErrorActionPreference = 'Stop'

# --------------------------------------------------------------------------- #
# 0. Racine du script
# --------------------------------------------------------------------------- #

# $PSScriptRoot est vide dans certains modes de lancement (script collé dans la
# console, éditeur, hôte PowerShell tiers). Les chemins par défaut deviennent
# alors "\data\..." et "\output", que Windows résout à la racine du lecteur
# courant : les fichiers de données ne sont plus trouvés et la sortie atterrit
# dans C:\output. On résout donc la racine explicitement, avec des replis.
$ScriptRoot = $PSScriptRoot
if (-not $ScriptRoot -and $MyInvocation.MyCommand.Path) {
    $ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
}
if (-not $ScriptRoot) {
    $ScriptRoot = (Get-Location).Path
    Write-Warning @"
Emplacement du script indéterminé : les chemins par défaut seront résolus depuis
le dossier courant ($ScriptRoot). Si les fichiers de data\ ne sont pas trouvés,
lancez le script par son chemin — .\New-PingCastleDashboard.ps1 — plutôt qu'en
collant son contenu dans la console.
"@
}

# Chemins par défaut, relatifs au script (résolus ici et non dans param(),
# où $PSScriptRoot n'est pas fiable).
if (-not $OutputPath) { $OutputPath = Join-Path $ScriptRoot 'output' }
if (-not $ExceptionsFile) { $ExceptionsFile = Join-Path $ScriptRoot 'data\exceptions.csv' }
if (-not $RulesFile) { $RulesFile = Join-Path $ScriptRoot 'data\HCRules.csv' }
if (-not $Logo) { $Logo = Join-Path $ScriptRoot 'data\logo.png' }

# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #

function Select-XmlFile {
    param([string]$Directory = $ScriptRoot)

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

function ConvertTo-DataUri {
    param([string]$Path)

    $ext = [System.IO.Path]::GetExtension($Path).TrimStart('.').ToLowerInvariant()
    $mime = switch ($ext) {
        'png' { 'image/png' }
        'jpg' { 'image/jpeg' }
        'jpeg' { 'image/jpeg' }
        'gif' { 'image/gif' }
        'webp' { 'image/webp' }
        'svg' { 'image/svg+xml' }
        default { 'application/octet-stream' }
    }
    'data:{0};base64,{1}' -f $mime, [Convert]::ToBase64String([System.IO.File]::ReadAllBytes($Path))
}

function Get-BrowserPath {
    # Edge est présent par défaut sur Windows ; Chrome sert de repli.
    $candidates = @(
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe"
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe"
        "${env:ProgramFiles(x86)}\Google\Chrome\Application\chrome.exe"
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    )
    foreach ($candidate in $candidates) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    $null
}

function Export-DashboardPdf {
    <#
        Rend le tableau de bord en PDF via Edge/Chrome en mode headless.
        La page est chargée avec ?print=1, ce qui bascule l'application en
        document linéaire paginé (page de garde, sauts de page, tableaux complets).
    #>
    param(
        [Parameter(Mandatory)][string]$HtmlPath,
        [Parameter(Mandatory)][string]$PdfPath,
        [switch]$SummaryOnly
    )

    $browser = Get-BrowserPath
    if (-not $browser) {
        Write-Warning @'
Aucun navigateur Edge ou Chrome trouvé : le PDF n'a pas été généré.
Le HTML reste exploitable — ouvrez-le et utilisez le bouton « Exporter en PDF ».
'@
        return $null
    }

    $uri = ([uri]$HtmlPath).AbsoluteUri + '?print=1'
    if ($SummaryOnly) { $uri += '&all=0' }

    $userData = Join-Path ([System.IO.Path]::GetTempPath()) ('pcd-' + [guid]::NewGuid().ToString('N'))
    $null = New-Item -Path $userData -ItemType Directory -Force
    $arguments = @(
        '--headless=new'
        '--disable-gpu'
        '--no-first-run'
        '--no-default-browser-check'
        '--disable-extensions'
        '--disable-sync'
        '--disable-logging'
        '--log-level=3'
        '--run-all-compositor-stages-before-draw'
        '--virtual-time-budget=30000'
        '--no-pdf-header-footer'
        "--user-data-dir=$userData"
        "--print-to-pdf=$PdfPath"
        $uri
    )

    if (Test-Path -LiteralPath $PdfPath) { Remove-Item -LiteralPath $PdfPath -Force }

    Write-Host "[*] Rendu PDF via $(Split-Path $browser -Leaf)…" -ForegroundColor Cyan
    try {
        # Edge écrit sur la console des avertissements sans rapport avec le rendu
        # (USB, synchronisation, task manager) : on les capture hors de la vue.
        $process = Start-Process -FilePath $browser -ArgumentList $arguments -NoNewWindow -PassThru `
            -RedirectStandardOutput (Join-Path $userData 'out.log') `
            -RedirectStandardError (Join-Path $userData 'err.log')
        if (-not $process.WaitForExit(180000)) {
            $process.Kill()
            Write-Warning 'Le rendu PDF a dépassé 3 minutes et a été interrompu.'
        }
    }
    finally {
        Remove-Item -LiteralPath $userData -Recurse -Force -ErrorAction SilentlyContinue
    }

    if (Test-Path -LiteralPath $PdfPath) {
        $size = [math]::Round((Get-Item -LiteralPath $PdfPath).Length / 1KB)
        Write-Host "[>] $PdfPath ($size Ko)" -ForegroundColor Yellow
        return $PdfPath
    }

    Write-Warning "Le PDF n'a pas été produit. Ouvrez le HTML et utilisez le bouton « Exporter en PDF »."
    $null
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
    $xmlFiles = Select-XmlFile -Directory $ScriptRoot | ForEach-Object { Get-Item -LiteralPath $_ }
}

if (-not $xmlFiles) {
    Write-Warning 'Aucun fichier XML sélectionné. Arrêt.'
    return
}

# Les chemins par défaut (data\, output\) sont relatifs à l'emplacement du script.
# On les affiche : c'est la première chose à vérifier si les fichiers n'arrivent
# pas là où on les attend, ou si une copie périmée du script est utilisée.
Write-Host "[*] Script    : $ScriptRoot" -ForegroundColor DarkGray
Write-Host "[*] Sortie    : $($OutputPath.FullName)" -ForegroundColor DarkGray
Write-Host "[*] $(($xmlFiles | Measure-Object).Count) fichier(s) XML à analyser" -ForegroundColor Cyan

# --------------------------------------------------------------------------- #
# 2. Référentiel des règles (criticité ANSSI) et exceptions
# --------------------------------------------------------------------------- #

$ruleLevel = @{}
if (Test-Path -LiteralPath $RulesFile) {
    Import-Csv -Path $RulesFile -Delimiter ';' -Encoding UTF8 | ForEach-Object {
        if ($_.RiskId) { $ruleLevel[$_.RiskId] = [int]$_.Level }
    }
    if ($ruleLevel.Count) {
        Write-Host "[*] $($ruleLevel.Count) règles connues chargées depuis HCRules.csv" -ForegroundColor Cyan
    }
    else {
        Write-Warning @"
'$RulesFile' n'a produit aucune règle exploitable.
Le fichier doit être un CSV à séparateur point-virgule avec les colonnes RiskId;Level.
Sans lui, toutes les criticités s'afficheront comme inconnues.
"@
    }
}
else {
    Write-Warning @"
Fichier de règles introuvable : '$RulesFile'
Toutes les criticités s'afficheront comme inconnues. Récupérez data\HCRules.csv,
ou régénérez-le avec .\Update-HCRules.ps1
"@
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
# 3b. Granularité des libellés et de l'axe temporel
# --------------------------------------------------------------------------- #

# Plusieurs passes le même jour (avant / après une remédiation) : sans l'heure,
# les rapports porteraient le même libellé et se superposeraient dans les
# graphiques et la matrice d'évolution.
if (-not $PSBoundParameters.ContainsKey('DateFormat')) {
    $collisions = $reports | Group-Object -Property domain, label | Where-Object { $_.Count -gt 1 }
    if ($collisions) {
        $DateFormat = "$DateFormat HH:mm"
        foreach ($report in $reports) { $report.label = Get-Date $report.date -Format $DateFormat }
        Write-Host "[*] Plusieurs rapports le même jour : l'heure est ajoutée aux libellés" -ForegroundColor Cyan
    }
}

# La vue globale (multi-domaines) doit regrouper les rapports dans des intervalles
# communs pour superposer les courbes. On resserre la maille sur les périodes
# courtes, sans quoi tout se retrouverait dans un unique point mensuel.
$dates = $reports.date | Sort-Object
$spanDays = ($dates[-1] - $dates[0]).TotalDays
$bucketUnit = if ($spanDays -lt 62) { 'jour' } else { 'mois' }
$bucketFormat = if ($bucketUnit -eq 'jour') { 'yyyy-MM-dd' } else { 'yyyy-MM' }
foreach ($report in $reports) {
    $report | Add-Member -NotePropertyName bucket -NotePropertyValue (Get-Date $report.date -Format $bucketFormat) -Force
}

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

# Une règle sans criticité connue s'affiche « — » dans le rapport. C'est presque
# toujours le signe d'un HCRules.csv en retard sur la version de PingCastle utilisée.
$seenIds = $reports.rules.id | Sort-Object -Unique
$unknown = @($seenIds | Where-Object { -not $ruleLevel.ContainsKey($_) })
if ($unknown.Count) {
    $sample = ($unknown | Select-Object -First 5) -join ', '
    if ($unknown.Count -gt 5) { $sample += ", …" }
    Write-Warning @"
$($unknown.Count) règle(s) sur $(($seenIds | Measure-Object).Count) sans criticité connue : $sample
Ces règles apparaîtront sans niveau (—) et se trieront en fin de tableau.
Mettez le référentiel à jour avec .\Update-HCRules.ps1
"@
}

# --------------------------------------------------------------------------- #
# 6. Rendu HTML
# --------------------------------------------------------------------------- #

$templateFile = Join-Path $ScriptRoot 'data\template.html'
$appFile = Join-Path $ScriptRoot 'data\app.js'
foreach ($f in @($templateFile, $appFile)) {
    if (-not (Test-Path -LiteralPath $f)) { throw "Fichier manquant : $f" }
}
$template = [System.IO.File]::ReadAllText($templateFile, [System.Text.Encoding]::UTF8)
$appJs = [System.IO.File]::ReadAllText($appFile, [System.Text.Encoding]::UTF8)

# Police et logo sont embarqués en base64 : le rapport doit rester fidèle à la
# charte même ouvert hors ligne, sur un poste sans Poppins installée.
$fontsFile = Join-Path $ScriptRoot 'data\fonts.css'
$fontCss = if (Test-Path -LiteralPath $fontsFile) {
    [System.IO.File]::ReadAllText($fontsFile, [System.Text.Encoding]::UTF8)
}
else {
    Write-Warning "data\fonts.css absent : repli sur les polices système."
    ''
}

if (Test-Path -LiteralPath $Logo) {
    $logoUri = ConvertTo-DataUri -Path $Logo
    $brandMarkup = '<img src="{0}" alt="Add-On">' -f $logoUri
}
else {
    # Pas de balise <img> vide : elle afficherait une icône d'image brisée.
    # On bascule sur un logotype typographique aux couleurs de la charte.
    Write-Warning "Logo introuvable ($Logo) : repli sur le logotype typographique."
    $logoUri = ''
    $brandMarkup = '<span class="wordmark">Add<em>-</em>On</span>'
}

if (-not (Test-Path -Path $OutputPath.FullName -PathType Container)) {
    $null = New-Item -Path $OutputPath.FullName -ItemType Directory -Force
}

function New-Dashboard {
    param(
        [Parameter(Mandatory)][array]$Domains,
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)][string]$PageTitle,
        # PDF embarqué (base64) : rend le bouton « Télécharger le PDF » opérationnel
        [string]$PdfBase64 = '',
        [string]$PdfFileName = '',
        [switch]$Quiet
    )

    $payload = [PSCustomObject]@{
        generated   = Get-Date $now -Format 'dd/MM/yyyy HH:mm'
        title       = $PageTitle
        reportCount = ($Domains.reports | Measure-Object).Count
        bucketUnit  = $bucketUnit
        domains     = $Domains
    }

    $html = $template.
        Replace('__PCD_TITLE__', [System.Net.WebUtility]::HtmlEncode($PageTitle)).
        Replace('__PCD_FONTS__', $fontCss).
        Replace('__PCD_BRAND__', $brandMarkup).
        Replace('__PCD_LOGO__', $logoUri).
        Replace('__PCD_PDF__', $PdfBase64).
        Replace('__PCD_PDFNAME__', $PdfFileName).
        Replace('__PCD_DATA__', (ConvertTo-SafeJson -InputObject $payload)).
        Replace('__PCD_APP__', $appJs)

    Write-Utf8File -Path $Path -Content $html
    if (-not $Quiet) {
        Write-Host "[>] $Path ($([math]::Round((Get-Item -LiteralPath $Path).Length / 1KB)) Ko)" -ForegroundColor Yellow
    }
    $Path
}

# Liste des rapports à produire : un seul consolidé, ou un par domaine.
$jobs = if ($SplitPerDomain) {
    foreach ($d in $domains) {
        $safe = ($d.name -replace '[^\w\.\-]', '_')
        @{
            Domains = @($d)
            Path    = Join-Path $OutputPath.FullName "dashboard_$safe.html"
            Title   = "$Title - $($d.name)"
        }
    }
}
else {
    @{
        Domains = $domains
        Path    = Join-Path $OutputPath.FullName $FileName
        Title   = $Title
    }
}

$generated = @()
$pdfFiles = @()

# Le PDF est produit par défaut : sans lui, le bouton du tableau de bord n'aurait
# rien à ouvrir et retomberait sur la boîte d'impression du navigateur.
$wantPdf = -not $NoPdf
if ($NoPdf -and $PdfSummary) {
    Write-Warning '-NoPdf et -PdfSummary sont contradictoires : aucun PDF ne sera produit.'
    $wantPdf = $false
}
if ($NoPdf) {
    Write-Host '[*] PDF désactivé (-NoPdf) : le bouton du rapport ouvrira la boîte d''impression' -ForegroundColor DarkGray
}

foreach ($job in @($jobs)) {

    $html = New-Dashboard -Domains $job.Domains -Path $job.Path -PageTitle $job.Title
    $generated += $html

    if (-not $wantPdf) { continue }

    # --------------------------------------------------------------------- #
    # Export PDF : le rendu se fait depuis le HTML qu'on vient d'écrire.
    # --------------------------------------------------------------------- #
    $pdfPath = [System.IO.Path]::ChangeExtension($html, 'pdf')
    $result = Export-DashboardPdf -HtmlPath $html -PdfPath $pdfPath -SummaryOnly:$PdfSummary
    if (-not $result) { continue }
    $pdfFiles += $result

    if ($NoEmbedPdf) { continue }

    # Seconde passe : on réécrit le HTML avec le PDF embarqué en base64, pour que
    # le bouton « Télécharger le PDF » livre le fichier sans boîte d'impression.
    $bytes = [System.IO.File]::ReadAllBytes($result)
    $null = New-Dashboard -Domains $job.Domains -Path $job.Path -PageTitle $job.Title -Quiet `
        -PdfBase64 ([Convert]::ToBase64String($bytes)) `
        -PdfFileName (Split-Path $result -Leaf)

    Write-Host ("[>] {0} ({1} Ko, PDF embarqué)" -f `
            $html, [math]::Round((Get-Item -LiteralPath $html).Length / 1KB)) -ForegroundColor Yellow
}

if (-not $DoNotShow) {
    # On ouvre le tableau de bord : c'est le livrable principal, et son bouton
    # « Ouvrir le PDF » donne accès au rapport imprimable.
    $generated | ForEach-Object { Start-Process $_ }
}

Write-Host ''
Write-Host "Terminé : $($generated.Count) HTML$(if ($pdfFiles.Count) { " + $($pdfFiles.Count) PDF" }) dans $($OutputPath.FullName)" -ForegroundColor Cyan
