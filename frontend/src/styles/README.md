# Organisation des styles

`../index.css` est le point d'entrée chargé par React. Il importe les fichiers ci-dessous dans un ordre volontaire : les variables et le socle sont chargés avant les composants et les styles propres aux pages.

| Fichier | Contenu |
| --- | --- |
| `tokens.css` | Couleurs, typographie, largeur maximale, gouttières et arrondis communs. |
| `base.css` | Règles globales HTML, fond de page et typographie de base. |
| `layout.css` | Conteneurs, en-tête, navigation et pied de page. |
| `components.css` | Panneaux, boutons, badges, notices et pagination partagés. |
| `dashboard.css` | Statistiques, tableau des joueurs, classements et graphiques génériques. |
| `authentication.css` | Connexion et actions de session. |
| `anathas.css` | Captures automatiques et tableaux Anathas. |
| `forms.css` | Champs, formulaires et éditeur de scénarios. |
| `player-details.css` | Fiche joueur, historique détaillé et hypothèses du tour. |
| `admin.css` | Administration des comptes et sélecteur de tour. |
| `responsive.css` | Tous les ajustements pour les écrans plus petits. |

Pour modifier l'apparence générale, commencer par `tokens.css`. Pour ajuster la présentation mobile, consulter `responsive.css` plutôt que d'ajouter une nouvelle media query au milieu d'un fichier de page.
