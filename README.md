# PCR — PingCastle Trend

Tableau de bord HTML et rapport PDF pour suivre **l'évolution d'un Active Directory** dans
le temps, à partir des rapports XML produits par
[PingCastle](https://github.com/netwrix/pingcastle). Aux couleurs d'**Add-On**.

Vous lancez PingCastle régulièrement (chaque mois, après chaque campagne de remédiation…),
vous accumulez les `ad_hc_<domaine>_<date>.xml` dans un dossier, et ce script les compare
entre eux : ce qui s'est amélioré, ce qui s'est dégradé, et ce qui ne bouge pas.

> Réécriture modernisée de [leobouard/PingCastleDashboard](https://github.com/leobouard/PingCastleDashboard).
> **Aucun module PowerShell, aucun CDN, aucun accès Internet.** Le logo et la police Poppins
> sont embarqués dans le fichier : le HTML généré est autonome — ouvrable hors ligne,
> envoyable par mail, consultable depuis un partage réseau.

---

## Démarrage rapide

```powershell
.\New-PingCastleDashboard.ps1 .\xml
```

Vous obtenez **deux fichiers** dans `.\output\` : le tableau de bord
`PingCastleDashboard.html` et le rapport `PingCastleDashboard.pdf`. Le PDF est aussi
embarqué dans le HTML, dont le bouton « Ouvrir le PDF » l'affiche en un clic.

Si le PDF ne vous sert pas, `-NoPdf` accélère la génération :

```powershell
.\New-PingCastleDashboard.ps1 .\xml -NoPdf
```

Avec `-XMLPath`, sélection automatique des XML dans le dossier XML.

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

### Comparer avant / après une remédiation, le jour même

Rien n'oblige à attendre un mois entre deux passes. Deux scans espacés de quelques heures
fonctionnent exactement pareil — c'est même le meilleur moyen de vérifier qu'une action
corrective a bien produit l'effet attendu :

```powershell
# 9h00 — état des lieux
.\PingCastle.exe --healthcheck --server monbureau.corp.local
Move-Item .\ad_hc_*.xml C:\PingCastle\historique\

#   … application des correctifs …

# 12h00 — vérification
.\PingCastle.exe --healthcheck --server monbureau.corp.local
Move-Item .\ad_hc_*.xml C:\PingCastle\historique\

.\New-PingCastleDashboard.ps1 -XMLPath C:\PingCastle\historique
```

Le script **détecte tout seul** que plusieurs rapports tombent le même jour et bascule les
libellés en `yyyy-MM-dd HH:mm`, sinon les deux passes porteraient la même étiquette et se
superposeraient dans les graphiques et la matrice :

```
[*] Plusieurs rapports le même jour : l'heure est ajoutée aux libellés
[+] corp.local     2 rapport(s)  2026-08-28 09:00 → 2026-08-28 12:00
```

La vue rapport du scan de 12h00 affiche alors directement le résultat de votre matinée :
les règles passées dans « ✓ Règles résolues », les éventuelles régressions dans
« ⚠ Nouvelles règles », et le delta en points sur chaque KPI.

Attention toutefois : PingCastle lit l'état de l'annuaire à l'instant du scan. Certains
indicateurs ne bougeront pas dans la même journée — réplication entre DC, `S-DC-Inactive`
et les règles fondées sur une ancienneté (mots de passe, comptes dormants) ont besoin de
temps. Un scan trop rapproché peut donc afficher une règle encore déclenchée alors que le
correctif est appliqué.

Deux passes le même jour ne posent pas de problème non plus si vous suivez **plusieurs
domaines** : la vue globale resserre automatiquement sa maille temporelle sur le jour
lorsque l'historique couvre moins de deux mois (le mois au-delà).

---

## Ce que le tableau de bord montre

### Vue « domaine » — l'évolution dans le temps

C'est le cœur de l'outil, et la page d'accueil. **Une barre = un rapport PingCastle.**

| Bloc | Contenu |
|---|---|
| **Rapports détaillés** | La frise des rapports, en tête de page : un clic ouvre le détail d'une passe |
| **Synthèse** | Score global, points cumulés, maturité ANSSI, règles déclenchées, règles résolues au total, nouvelles règles — chacun avec son écart vs le rapport précédent |
| **Tendances** | Total de points non plafonné, niveau de maturité, et les règles déclenchées en **barres empilées par criticité** (N1→N5) |
| **Évolution par catégorie** | Anomalies, Comptes à privilèges, Objets obsolètes, Approbations |
| **Historique** | Un tableau ligne = un rapport, avec tous les scores |
| **Évolution des règles** | La matrice `RiskId` × date — voir ci-dessous |
| **Remédiations** | Toutes les règles résolues depuis le premier rapport, avec leur date de dernière apparition |

Les tendances sont en **histogrammes** plutôt qu'en courbes : sur une poignée de rapports,
comparer des hauteurs se lit plus vite qu'une ligne, et la valeur est écrite au-dessus de
chaque barre. Au-delà d'une vingtaine de rapports, les étiquettes s'effacent
automatiquement et le survol prend le relais. La vue globale multi-domaines, elle, reste en
courbes : c'est la forme qui permet de superposer plusieurs domaines sans les confondre.

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

Accessible via la frise « Rapports détaillés » en haut de la vue domaine, ou depuis
n'importe quelle vue rapport. Elle contient :

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
| `-DateFormat` | `yyyy-MM-dd` | Format des dates. L'heure est ajoutée automatiquement si plusieurs rapports tombent le même jour — sauf si vous passez ce paramètre explicitement |
| `-SplitPerDomain` | *(désactivé)* | Un fichier `dashboard_<domaine>.html` par domaine |
| `-NoPdf` | *(désactivé)* | Ne produit aucun PDF. Le bouton du rapport retombe alors sur l'impression |
| `-PdfSummary` | *(désactivé)* | PDF condensé : couverture, vue globale, évolution par domaine et dernier rapport seulement |
| `-NoEmbedPdf` | *(désactivé)* | N'embarque pas le PDF dans le HTML : le fichier `.pdf` est produit, mais le tableau de bord reste léger |
| `-Pdf` | *(sans effet)* | Le PDF est produit par défaut. Conservé pour ne pas casser les commandes existantes |
| `-Logo` | `.\data\logo.png` | Logo affiché dans le bandeau et sur la couverture du PDF |
| `-ExceptionsFile` | `.\data\exceptions.csv` | Règles à exclure du calcul |
| `-RulesFile` | `.\data\HCRules.csv` | Référentiel des criticités |
| `-DoNotShow` | *(désactivé)* | N'ouvre rien à la fin (PDF ou navigateur) |

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

## Export PDF

**Le PDF est produit par défaut**, sans drapeau à passer :

```powershell
.\New-PingCastleDashboard.ps1 -XMLPath .\xml
```

Il est déposé à côté du HTML (`output\PingCastleDashboard.pdf`) **et** embarqué dedans. Le
rendu est confié à **Edge en mode headless** (Chrome sert de repli) : Edge est installé
d'office sur Windows, il n'y a donc rien à ajouter sur le poste. Si aucun des deux
navigateurs n'est trouvé, le script le signale et le HTML reste exploitable.

Dans le tableau de bord, le bouton **« Ouvrir le PDF »** en haut à droite l'affiche
directement dans le lecteur du navigateur, d'où vous pouvez l'enregistrer ou l'imprimer.
Pas de boîte d'impression, pas de destination à choisir. C'est le même fichier, au bit
près, que celui écrit dans `output\`. Le bouton « Imprimer » disparaît alors : le lecteur
PDF fait déjà les deux, et deux boutons voisins prêtaient à confusion.

Avec `-NoPdf` ou `-NoEmbedPdf`, le HTML ne contient aucun PDF à ouvrir : le bouton devient
« Imprimer / PDF » et ouvre la boîte d'impression du navigateur, où il faut choisir
*Enregistrer au format PDF* comme destination — ce que le bouton rappelle au moment du
clic. Aucune page web ne peut écrire un fichier PDF sans passer par là ; c'est précisément
pourquoi le PDF est pré-rendu côté script.

### Poids du fichier

Embarquer le PDF fait grossir le HTML : 253 Ko à vide, **3,4 Mo** avec le PDF de 55 pages du
jeu d'exemple. C'est le prix de l'ouverture en un clic depuis un fichier autonome.

| Mode | HTML | PDF produit | Bouton |
|---|---|---|---|
| *(défaut)* | 3,4 Mo | 2,3 Mo · 55 pages | Ouvrir le PDF |
| `-PdfSummary` | 1,4 Mo | 0,9 Mo · 13 pages | Ouvrir le PDF |
| `-NoEmbedPdf` | 253 Ko | 2,3 Mo · 55 pages | Imprimer / PDF |
| `-NoPdf` | 253 Ko | — | Imprimer / PDF |

Si le tableau de bord doit rester léger — publication sur un partage, envoi par mail —
`-NoEmbedPdf` produit quand même le `.pdf` à côté :

```powershell
.\New-PingCastleDashboard.ps1 -XMLPath .\xml -NoEmbedPdf
```

### Ce que contient le PDF

Le document est linéaire et paginé en A4, pas une capture du tableau de bord :

1. **une page de couverture** — logo, périmètre, période couverte, date de génération ;
2. **la vue globale**, si plusieurs domaines sont suivis ;
3. **pour chaque domaine** : la page d'évolution complète (KPI, histogrammes, matrice des
   règles, remédiations) ;
4. **pour chaque domaine** : le détail de chacun de ses rapports.

Les tableaux y sont **dépaginés** — aucune ligne n'est masquée, contrairement à l'affichage
écran — et les sauts de page tombent entre les sections, jamais au milieu d'une carte.

Comptez environ 8 pages par rapport analysé. Sur le jeu d'exemple : 55 pages pour 1 domaine
et 7 rapports, 113 pages pour 2 domaines. Pour un livrable de synthèse, `-PdfSummary`
retient la couverture, la vue globale, l'évolution par domaine et le dernier rapport
uniquement — 13 pages sur le même jeu.

```powershell
.\New-PingCastleDashboard.ps1 -XMLPath .\xml -PdfSummary
```

---

## Identité visuelle

L'interface reprend la charte du site [addon.fr](https://www.addon.fr/) :

| | |
|---|---|
| Violet primaire | `#3E2C87` — navigation active, séries de graphiques, boutons |
| Rouge | `#D60929` — criticité N1, valeurs en dégradation |
| Bleu | `#0095EB` — criticité N5, liens |
| Anthracite | `#292B33` — infobulles, titres de couverture |
| Police | **Poppins** (400/500/600/700), embarquée en base64 |

L'échelle de criticité est ancrée sur ces couleurs : N1 rouge Add-On, N5 bleu Add-On, et
les niveaux intermédiaires interpolés. Le thème clair est celui de la charte et reste le
défaut, y compris pour le PDF ; le bouton « Thème » propose un mode sombre dérivé, mémorisé
dans le navigateur.

Si `data\logo.png` est absent, le rapport bascule sur un logotype typographique
« Add-On » aux couleurs de la charte — jamais sur une image brisée.

Pour adapter le rendu :

- **le logo** — remplacez `data\logo.png` (une hauteur de 80 px suffit, le fichier est
  encodé en base64 dans chaque rapport, donc gardez-le léger) ou passez `-Logo` ;
- **les couleurs** — les variables CSS sont regroupées en tête de `data\template.html`,
  dans le bloc `:root` ;
- **la police** — `data\fonts.css` contient les `@font-face` Poppins déjà encodés. Videz ce
  fichier pour revenir aux polices système, ou remplacez-le par une autre fonte embarquée.

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
jour le CSV. **Nécessite un accès Internet.**

Une règle absente du référentiel s'affiche sans niveau (`—`) et se trie en fin de tableau ;
le reste du rapport reste exploitable. À chaque génération, le script vous dit combien de
règles sont dans ce cas :

```
AVERTISSEMENT : 12 règle(s) sur 48 sans criticité connue : A-DsHeuristicsLDAPSecInterval, …
Mettez le référentiel à jour avec .\Update-HCRules.ps1
```

**Si *toutes* vos règles remontent sans criticité**, ce n'est pas votre AD : c'est que
`data\HCRules.csv` n'a pas été lu. Vérifiez qu'il est bien présent à côté du script — les
vues ventilées par niveau (donut de répartition, points par criticité) sont alors
remplacées par un message explicite plutôt que par des zéros, qui se liraient à tort comme
une absence de risque.

---

## Arborescence

```
PCR\
├── New-PingCastleDashboard.ps1   ← le script principal
├── Update-HCRules.ps1            ← rafraîchit le référentiel de criticités
├── data\
│   ├── template.html             ← structure, charte et mise en page PDF
│   ├── app.js                    ← rendu (graphiques SVG, tableaux, navigation, mode PDF)
│   ├── fonts.css                 ← Poppins embarquée en base64
│   ├── logo.png                  ← logo Add-On
│   ├── HCRules.csv               ← RiskId → niveau de criticité ANSSI
│   └── exceptions.csv            ← règles à exclure des scores
├── xml\                          ← rapports PingCastle (jeu d'exemple fourni)
└── output\                       ← HTML et PDF générés
```

`template.html`, `app.js`, `fonts.css` et `logo.png` sont assemblés dans le fichier final à
chaque génération : pour retoucher l'apparence ou ajouter un indicateur, on édite ces
fichiers, jamais le HTML de sortie.

## Prérequis

- **Windows PowerShell 5.1** ou **PowerShell 7+**
- Aucun module externe
- Un navigateur récent (Edge, Chrome, Firefox) pour consulter le rapport
- **Pour le PDF** : Edge ou Chrome installé — Edge l'est par défaut sur Windows. Sans lui, seul le HTML est produit

Les fichiers `.ps1` sont encodés en **UTF-8 avec BOM** : c'est nécessaire pour que
Windows PowerShell 5.1 lise correctement les accents. Conservez le BOM si vous les modifiez.

## Interface

- **Thème clair / sombre** — bouton en haut à droite. Le clair (charte Add-On) est le
  défaut ; le choix est mémorisé dans le navigateur.
- **Tableaux triables et filtrables** — clic sur un en-tête pour trier, champ de recherche
  au-dessus des grands tableaux.
- **Graphiques interactifs** — survol pour la valeur exacte, clic sur une entrée de légende
  pour masquer une série.
- **Ouverture du PDF** — le bouton « Ouvrir le PDF » affiche le rapport dans
  le lecteur du navigateur, sans boîte d'impression. Avec `-NoPdf`, le bouton devient
  « Imprimer / PDF » et ouvre l'impression (destination *Enregistrer au format PDF*).

## Crédits

Basé sur le travail de [leobouard](https://github.com/leobouard/PingCastleDashboard) et de
ses contributeurs (METSYS), dont proviennent la logique d'analyse des rapports, le
référentiel `HCRules.csv` et le mécanisme d'exceptions.

- [netwrix/pingcastle](https://github.com/netwrix/pingcastle) — l'outil d'audit à l'origine des rapports
