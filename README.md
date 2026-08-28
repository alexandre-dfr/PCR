# PCR — PingCastle Trend

Tableau de bord HTML pour suivre **l'évolution d'un Active Directory** dans le temps, à
partir des rapports XML produits par [PingCastle](https://github.com/netwrix/pingcastle).

Vous lancez PingCastle régulièrement (chaque mois, après chaque campagne de remédiation…),
vous accumulez les `ad_hc_<domaine>_<date>.xml` dans un dossier, et ce script les compare
entre eux : ce qui s'est amélioré, ce qui s'est dégradé, et ce qui ne bouge pas.

> Réécriture modernisée de [leobouard/PingCastleDashboard](https://github.com/leobouard/PingCastleDashboard).
> **Aucune dépendance** : ni PSWriteHTML, ni CDN, ni accès Internet. Le HTML généré est
> autonome — ouvrable hors ligne, envoyable par mail, consultable depuis un partage réseau.

---

## Démarrage rapide

```powershell
.\New-PingCastleDashboard.ps1 -XMLPath .\xml
```

Le rapport est écrit dans `.\output\PingCastleDashboard.html` et s'ouvre dans le navigateur.

Sans `-XMLPath`, une boîte de dialogue vous laisse sélectionner les fichiers à la main.

### Le workflow au fil de l'eau

C'est le cas d'usage principal : vous relancez le script à chaque nouveau rapport.

```powershell
# 1. Nouvelle passe PingCastle
.\PingCastle.exe --healthcheck --server monbureau.corp.local --no-enum-limit

# 2. On dépose le XML à côté des précédents
Copy-Item .\ad_hc_*.xml C:\PingCastle\historique\

# 3. On régénère le tableau de bord — il reprend tout l'historique
.\New-PingCastleDashboard.ps1 -XMLPath C:\PingCastle\historique
```

Le script est **idempotent** : il relit l'intégralité du dossier à chaque exécution et
réécrit le HTML. Rien n'est mis en cache, rien ne s'accumule, aucun état à maintenir.
Ajoutez, retirez ou remplacez des XML dans le dossier, le tableau de bord suit.

Le tri se fait sur la `GenerationDate` contenue **dans le XML**, pas sur le nom du fichier
ni sur la date de modification : vous pouvez renommer les fichiers librement.

---

## Ce que le tableau de bord montre

### Vue « domaine » — l'évolution dans le temps

C'est le cœur de l'outil. Chaque point de chaque courbe correspond à un rapport PingCastle.

| Bloc | Contenu |
|---|---|
| **Bandeau KPI** | Score global, points cumulés, maturité ANSSI, règles déclenchées, règles résolues au total, nouvelles règles — chacun avec son écart vs le rapport précédent |
| **Tendances** | Total de points non plafonné, niveau de maturité, nombre de règles par criticité (N1→N5) |
| **Évolution par catégorie** | Anomalies, Comptes à privilèges, Objets obsolètes, Approbations |
| **Historique** | Un tableau ligne = un rapport, avec tous les scores |
| **Évolution des règles** | La matrice `RiskId` × date — voir ci-dessous |
| **Remédiations** | Toutes les règles résolues depuis le premier rapport, avec leur date de dernière apparition |

La **matrice d'évolution** est le tableau qui répond à « qu'est-ce qui a bougé, et quand ? ».
Une ligne par règle jamais déclenchée sur la période, une colonne par rapport, la valeur
étant les points à cette date :

```
Crit.  RiskId                 2020-08  2020-09  2020-10  2020-11  2020-12  2021-01  2021-02
N1     A-LMHashAuthorized        5        5        5        5        5        5        5      ← jamais traitée
N1     A-PwdGPO                 60       60       60       60       60        ·        ·      ← résolue en janvier
N1     T-SIDFiltering           50       50       50        ·        ·        ·        ·      ← résolue en novembre
N2     A-Krbtgt                 20        ·        ·        ·        ·        ·        ·      ← résolue dès septembre
```

`·` = règle non déclenchée à cette date. Les lignes dont la dernière colonne est vide
(règles résolues) sont grisées. Cliquez sur un en-tête pour trier, y compris sur une date.

### Vue « rapport » — la photo à une date donnée

Accessible via la frise chronologique en bas de la vue domaine, ou depuis n'importe quelle
vue rapport. Elle contient :

- les informations du rapport (version PingCastle, âge, niveaux fonctionnels, nombre de DC) ;
- la jauge de score global et la répartition des règles par criticité ;
- les points par niveau de criticité, **avec le delta vs le rapport précédent** ;
- les 4 jauges de scores PingCastle (0-100) ;
- des barres comparatives **Initial / Précédent / Actuel** pour chaque catégorie ;
- **les deux tableaux de diff** : règles résolues ✓ et nouvelles règles ⚠ depuis la passe
  précédente — c'est le résultat direct de votre travail de remédiation entre les deux dates ;
- la répartition des points par modèle de règle ;
- le détail de toutes les règles déclenchées, triable et filtrable ;
- les règles ignorées via `exceptions.csv`, le cas échéant.

### Vue « globale » — plusieurs domaines

Elle apparaît automatiquement dès que le dossier contient les rapports de **plusieurs
domaines**. Les courbes des domaines sont superposées (agrégation au mois, dernier rapport
de chaque mois retenu), avec une synthèse et une matrice `RiskId` × domaine pour repérer
les faiblesses communes à tout le parc.

Un domaine sans rapport sur un mois donné produit une rupture dans sa courbe — pas un zéro,
qui laisserait croire à un score parfait.

---

## Paramètres

| Paramètre | Défaut | Rôle |
|---|---|---|
| `-XMLPath` | *(dialogue)* | Dossier des rapports XML, parcouru récursivement |
| `-OutputPath` | `.\output` | Dossier de destination |
| `-FileName` | `PingCastleDashboard.html` | Nom du fichier généré |
| `-Title` | `PingCastle Trend` | Titre de la page |
| `-DateFormat` | `yyyy-MM-dd` | Format des dates dans les graphiques et tableaux |
| `-SplitPerDomain` | *(désactivé)* | Un fichier `dashboard_<domaine>.html` par domaine |
| `-ExceptionsFile` | `.\data\exceptions.csv` | Règles à exclure du calcul |
| `-RulesFile` | `.\data\HCRules.csv` | Référentiel des criticités |
| `-DoNotShow` | *(désactivé)* | N'ouvre pas le navigateur à la fin |

Exemples :

```powershell
# Un fichier par domaine, sans ouvrir le navigateur (exécution planifiée)
.\New-PingCastleDashboard.ps1 -XMLPath \\srv\pingcastle$ -SplitPerDomain -DoNotShow

# Dates au format français, publication sur un partage
.\New-PingCastleDashboard.ps1 -XMLPath .\xml -DateFormat 'dd/MM/yy' -OutputPath \\srv\web$\ad
```

### Génération planifiée

```powershell
$action  = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument `
  '-NoProfile -ExecutionPolicy Bypass -File "C:\PCR\New-PingCastleDashboard.ps1" -XMLPath "C:\PingCastle\historique" -OutputPath "\\srv\web$\ad" -DoNotShow'
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday -At 07:00
Register-ScheduledTask -TaskName 'PingCastle Dashboard' -Action $action -Trigger $trigger
```

---

## Exceptions

PingCastle est parfois trop sévère, ou une règle est acceptée comme risque résiduel.
`data\exceptions.csv` permet de les sortir des scores :

```csv
Domain;RiskId
test.mysmartlogon.com;S-DC-NotUpdated
*;S-FictionalRiskRule
```

- `Domain` accepte le caractère générique `*` pour appliquer l'exception à tous les domaines.
- Les règles exclues restent visibles, dans un tableau « Règles ignorées » en bas de chaque
  vue rapport — elles sont écartées du calcul, pas dissimulées.
- La liste complète des `RiskId` se trouve dans `data\HCRules.csv`.

**Conséquence à connaître** : les totaux de points affichés sont *non plafonnés* et tiennent
compte des exceptions. Ils diffèrent donc volontairement du score PingCastle officiel, qui
est plafonné à 100. Les 4 jauges « Scores PingCastle » de la vue rapport, elles, affichent
les valeurs brutes du XML, sans retraitement.

## Mise à jour du référentiel de criticités

Les niveaux de criticité (N1 à N5) ne sont pas dans le XML : ils viennent de
`data\HCRules.csv`, extrait du code source de PingCastle. Pour le rafraîchir après une
nouvelle version de PingCastle :

```powershell
.\Update-HCRules.ps1
```

Le script interroge le dépôt GitHub `netwrix/pingcastle`, affiche les différences et met à
jour le CSV. **Nécessite un accès Internet.** Une règle absente du référentiel s'affiche
avec la criticité `?` — le reste du tableau de bord reste exploitable.

---

## Arborescence

```
PCR\
├── New-PingCastleDashboard.ps1   ← le script principal
├── Update-HCRules.ps1            ← rafraîchit le référentiel de criticités
├── data\
│   ├── template.html             ← structure et feuille de style du rapport
│   ├── app.js                    ← rendu (graphiques SVG, tableaux, navigation)
│   ├── HCRules.csv               ← RiskId → niveau de criticité ANSSI
│   └── exceptions.csv            ← règles à exclure des scores
├── xml\                          ← rapports PingCastle (jeu d'exemple fourni)
└── output\                       ← HTML généré
```

`template.html` et `app.js` sont assemblés dans le fichier final à chaque génération : pour
retoucher l'apparence ou ajouter un indicateur, on édite ces deux fichiers, jamais le HTML
de sortie.

## Prérequis

- **Windows PowerShell 5.1** ou **PowerShell 7+**
- Aucun module externe
- Un navigateur récent (Edge, Chrome, Firefox)

Les fichiers `.ps1` sont encodés en **UTF-8 avec BOM** : c'est nécessaire pour que
Windows PowerShell 5.1 lise correctement les accents. Conservez le BOM si vous les modifiez.

## Interface

- **Thème sombre / clair** — bouton en haut à droite, aligné par défaut sur le thème du
  système, choix mémorisé dans le navigateur.
- **Tableaux triables et filtrables** — clic sur un en-tête pour trier, champ de recherche
  au-dessus des grands tableaux.
- **Graphiques interactifs** — survol pour la valeur exacte, clic sur une entrée de légende
  pour masquer une série.
- **Impression / export PDF** — le bouton « Imprimer » applique une mise en page adaptée
  (navigation masquée, cartes non coupées) ; imprimez vers PDF pour un livrable figé.

## Crédits

Basé sur le travail de [leobouard](https://github.com/leobouard/PingCastleDashboard) et de
ses contributeurs (METSYS), dont proviennent la logique d'analyse des rapports, le
référentiel `HCRules.csv` et le mécanisme d'exceptions.

- [netwrix/pingcastle](https://github.com/netwrix/pingcastle) — l'outil d'audit à l'origine des rapports
