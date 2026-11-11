# GéoMaurice — Accessibilité, risques et signalements citoyens

Application cartographique de l'île Maurice : accessibilité aux services, simulateur d'inondation et, depuis 2026, **signalements citoyens validés par le CEDTI**. Projet du module RSE ENV 5001 (Télécom SudParis × CEDTI). La base est le dépôt `geo-maurice` des étudiants de l'an dernier.

## Nouveautés 2026

- **Signalements citoyens.** Bouton « Signaler », onglet « Signalements », en anglais, français et créole mauricien. L'envoi est anonyme. La photo est compressée sur l'appareil et ses métadonnées (dont la position GPS) sont supprimées.
- **Modération par le CEDTI.** Tout signalement arrive **en attente** et n'est **visible qu'après validation manuelle** dans `/admin`, photo comprise. Un signalement validé reste sur la carte jusqu'à son retrait manuel. Le rejet et le retrait suppriment définitivement le signalement et sa photo.
- **Croisement avec le simulateur.** Les signalements validés restent visibles en mode « Risques », ce qui permet de les comparer au modèle d'inondation.
- **Pensée pour le mobile, en vue de l'application :**
  - mise en page mobile : panneau repliable en bas de l'écran, formulaire en feuille du bas, GPS, appareil photo ;
  - application installable sur l'écran d'accueil (PWA), utilisable hors ligne après une première visite ;
  - **signalement hors connexion** : il est gardé sur l'appareil et envoyé automatiquement au retour du réseau. Si le serveur demande d'attendre (limite d'envois atteinte), il reste dans la file et l'envoi est retenté toutes les 5 minutes ;
  - **API versionnée** `/api/v1`, avec des codes d'erreur lisibles par une app et un CORS configurable : une future application native (Capacitor, React Native…) pourra utiliser la même API.
- **Fond de carte local**, limité à Maurice et Rodrigues (`maurice.pmtiles`). Il ne dépend plus des serveurs de tuiles d'OpenStreetMap, ce qui supprime les tuiles manquantes. Repli automatique sur OSM en ligne si le fichier est absent.
- **Serveur Node** (`server/`) : API, modération, photos, fond de carte, application construite.
- **Docker** + **Caddy** (HTTPS automatique) pour la production.

## Démarrage rapide (Docker)

```bash
cp .env.example .env                         # changer ADMIN_PASSWORD (obligatoire : la valeur d'exemple est refusée)
docker compose up -d --build                 # http://localhost:3000
docker compose run --rm app npm run tiles    # une seule fois : fond de carte de Maurice
```

- Carte : http://localhost:3000
- Modération : http://localhost:3000/admin

| Commande | Effet |
|---|---|
| `docker compose logs -f app` | Voir les journaux |
| `docker compose down` | Arrêter (les données sont conservées) |
| `docker compose up -d --build` | Mettre à jour après une modification |
| `docker compose exec -T app tar czf - -C /app data > sauvegarde.tgz` | Sauvegarder la base et les photos |

**Où sont les données ?** Dans des volumes Docker :
- `geomaurice_data` : la base SQLite et les photos. **C'est celui-là qu'il faut sauvegarder.**
- `geomaurice_tiles` : le fond de carte.

`docker compose down -v` **efface ces volumes, donc toutes les données**.

### Production (serveur du CEDTI)

1. Faire pointer le nom de domaine vers le serveur et ouvrir les ports 80 et 443.
2. Dans `.env`, renseigner `DOMAIN`, `TRUST_PROXY=1` et un mot de passe admin fort.
3. Lancer `docker compose --profile prod up -d --build`.

```
Téléphone / navigateur ──HTTPS──▶ Caddy ──▶ app:3000 ──▶ volume data (SQLite + photos)
                                   │                  └─▶ volume tiles (fond de carte)
                       compression gzip/zstd (population.json : 10 Mo → beaucoup moins)
```

## Développement (sans Docker)

Il faut Node.js 22.13 ou plus récent.

```bash
cd server && npm install && cp ../.env.example .env && npm start   # API + admin, port 3000
cd geo-maurice-app && npm install && npm run dev                   # application, port 5173
```

Vite redirige `/api`, `/admin` et `/tiles` vers le serveur du port 3000. Pour le fond de carte local hors Docker, installer l'outil `pmtiles` (`brew install pmtiles`, ou l'exécutable Windows depuis https://github.com/protomaps/go-pmtiles/releases), puis lancer `cd server && npm run tiles`.

Tests de l'API : `cd server && npm test`.

## API v1

| Méthode | Route | Accès | Rôle |
|---|---|---|---|
| GET | `/api/v1/reports` | public | Signalements **validés**, en GeoJSON (le connecteur : QGIS, carte GéoMaurice, application mobile) |
| POST | `/api/v1/reports` | public | Nouveau signalement (multipart : `category`, `description`, `lat`, `lng`, `photo` facultative). Réponse `{ id, status: "pending" }` |
| GET | `/api/v1/photos/:id` | public si validé, sinon admin | Photo d'un signalement |
| GET | `/api/v1/categories` | public | Types de problèmes et couleurs |
| POST | `/api/v1/admin/login` | — | `{ "password": "…" }` → jeton de session (8 h) |
| GET | `/api/v1/admin/reports?status=pending\|published` | admin | File de modération |
| POST | `/api/v1/admin/reports/:id/approve` | admin | Valider (rendre public) |
| DELETE | `/api/v1/admin/reports/:id` | admin | Rejeter ou retirer (suppression définitive, photo comprise) |
| GET | `/api/v1/admin/stats` | admin | En attente, publiés, volume de photos |

Les erreurs ont la forme `{ "error": "invalid_position", "message": "…" }`.

## Structure

```
geo-maurice-app/   application React (Vite + Leaflet)
  src/reports/            API, compression photo, file hors connexion
  src/components/Reports/ formulaire et onglet Signalements
  src/components/Map/     BaseMapLayer (fond local), ReportsLayer
  public/sw.js, manifest  application installable / hors ligne
server/            serveur Node : API v1, modération, admin (server/admin), fond de carte
scripts/           scripts Python de récupération des données (voir plus bas)
Dockerfile, compose.yaml, Caddyfile
```

## Choix d'écoconception et de protection des données

| Choix | Pourquoi |
|---|---|
| Photo compressée sur l'appareil (1280 px, JPEG 0,7) | Une photo de 9,5 Mo est envoyée en 255 Ko (mesuré) : moins de données mobiles et de stockage |
| Métadonnées supprimées (appareil + serveur) | L'EXIF contient la position GPS et le modèle du téléphone |
| Aucune donnée personnelle stockée | Ni nom, ni e-mail, ni IP. L'IP sert seulement, en mémoire, à limiter le spam (30 envois par heure par défaut, réglable avec `REPORTS_PER_HOUR`) |
| Validation manuelle avant publication | Fiabilité de la carte et protection des personnes (visages, plaques) |
| Photos en attente non publiques | Même avec le lien, seule une session admin peut les voir |
| Rejet ou retrait = suppression réelle | Pas de stockage inutile |
| Fond de carte local limité à Maurice et Rodrigues | Pas de serveur de tuiles tiers ni de quota. Tuiles vectorielles plus légères |
| Cache long pour les fichiers construits, 7 jours pour les données, compression par Caddy | Moins de transferts répétés |
| Hors ligne (service worker + file d'envoi) | Pensé pour les cyclones et les zones mal couvertes |

## Limites connues

- **Poids des données** : environ 45 Mo (`hazards/` 25 Mo, `population.json` et `roads_friction.json` environ 10 Mo chacun) et un calcul lourd sur l'appareil. C'est la **priorité d'écoconception** suivante : formats binaires, découpage par zone, calcul côté serveur.
- **Créole mauricien** : les nouveaux textes en créole doivent être **relus par un locuteur natif**.
- **Modération** : un seul compte admin partagé, et des sessions gardées en mémoire (un redémarrage déconnecte). Il faudra prévoir des comptes nominatifs et un journal des décisions.
- **Hors ligne** : le fond de carte local n'est pas mis en cache par le service worker, qui ne gère pas les lectures partielles. Sans réseau, on garde l'interface et les données déjà vues, mais pas forcément le fond de carte.
- **Profils enregistrés** : la fonction « Enregistrer un profil » du dépôt d'origine écrit des fichiers via le serveur de développement Vite. Elle **ne fonctionne pas sur le site publié**.
- **Outils de développement** : une alerte de sécurité concerne le serveur de développement de Vite 5 (esbuild). Elle ne touche pas le site publié, et la corriger demande de passer à Vite 6 ou 7. La configuration ESLint du dépôt d'origine est aussi à réparer.
- **Simulateur d'inondation** : méthode simplifiée (HAND), à présenter comme indicative, pas comme une carte officielle des risques.

---

# Partie données (dépôt d'origine)

## Structure du projet de données

```
geo-maurice-app/     # Application React (Vite + Leaflet)
scripts/             # Scripts Python pour récupérer les données
data/                # Données brutes (CSV, Shapefiles)
```

## Prérequis

- **Node.js** v18+
- **Python** 3.8+
- **pip** pour les packages Python

## Installation Rapide (avec Makefile)

```bash
# Installation complète (venv + données + app)
make all

# Lancer l'application
make run
```

Ouvrir http://localhost:5173 dans le navigateur.

### Commandes Makefile disponibles

| Commande | Description |
|----------|-------------|
| `make install` | Crée le venv Python et installe les dépendances |
| `make data` | Télécharge toutes les données (OSM, population, routes) |
| `make install-app` | Installe les dépendances Node.js |
| `make run` | Lance l'application en développement |
| `make build` | Build de production |
| `make clean` | Nettoie les fichiers générés |
| `make all` | Installation complète |
| `make help` | Affiche l'aide |

---

## Installation Manuelle

### 1. Environnement Python

```bash
python -m venv .venv
source .venv/bin/activate  # Linux/Mac
pip install -r requirements.txt
```

### 2. Télécharger les données

```bash
python scripts/fetch_osm.py          # Points OSM (~5-10 min)
python scripts/fetch_population.py   # Population (~2 min)
python scripts/fetch_roads_friction.py  # Routes (~5-10 min)
```

### 3. Application

```bash
cd geo-maurice-app
npm install
npm run dev
```

---

## Description des Scripts

| Script | Description | Fichier généré |
|--------|-------------|----------------|
| `fetch_osm.py` | Points OSM (écoles, hôpitaux, etc.) | `public/data/osm/*.geojson` |
| `fetch_population.py` | Densité de population WorldPop | `public/data/population.json` |
| `fetch_roads_friction.py` | Grille de friction routière | `public/data/roads_friction.json` |

---

## Fichiers de données attendus

```
geo-maurice-app/public/data/
├── osm/                    # Points OSM par catégorie
│   ├── hospital.geojson
│   ├── school.geojson
│   └── ...
├── population.json         # Grille de densité de population
├── roads_friction.json     # Grille de friction routière (optionnel)
└── districts_mauritius.geojson  # Frontières des districts
```

---

## Utilisation

### Lancer en développement
```bash
cd geo-maurice-app && npm run dev
```

### Build production
```bash
cd geo-maurice-app && npm run build
```

Les fichiers sont générés dans `dist/`.

---

## Sources de données

Cette application utilise plusieurs sources de données ouvertes :

- **Population** : Données de densité de population provenant de [WorldPop](https://www.worldpop.org/).
  - Fichier : Global 2000-2020 1km UNadj (2020) - `mus_ppp_2020_1km_Aggregated_UNadj.tif`
  - URL source : `https://data.worldpop.org/GIS/Population/Global_2000_2020_1km_UNadj/2020/MUS/`
- **Points d'intérêt (POI)** : Écoles, hôpitaux et autres services extraits d'OpenStreetMap (OSM) via l'API Overpass.
- **Risques & Hydrographie** : Rivières, lacs, réservoirs et zones humides extraits d'OpenStreetMap.
- **Altitude (MNT)** : Modèle Numérique de Terrain provenant des [AWS Terrain Tiles](https://registry.opendata.aws/terrain-tiles/) (s3.amazonaws.com/elevation-tiles-prod).
- **Réseau Routier** : Données extraites d'OpenStreetMap pour le calcul de friction et l'accessibilité.

---

## Paramètres avancés

L'application supporte :
- **3 fonctions de score** : Linéaire, Exponentielle, Constante
- **2 sources de friction** : Population ou Routes OSM
- **Filtrage par type de route** : Autoroutes, Principales, Secondaires, Locales
- **Profils personnalisables** : Famille, Tourisme, Seniors, etc.

Consultez le bouton **Aide** dans l'application pour plus de détails.
