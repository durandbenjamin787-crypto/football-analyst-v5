# ⚽ Football Analyst

Moteur d'analyse probabiliste de matchs de football — Node.js + TypeScript.

> **Avertissement** : Cet outil est un aide à l'analyse statistique. Les probabilités calculées reflètent des tendances historiques et ne constituent en aucun cas des certitudes. Le football est imprévisible par nature. N'utilisez jamais ces données seules pour des décisions financières.

---

## Architecture

```
football-analyst/
├── src/
│   ├── index.ts                        # Point d'entrée (serveur HTTP)
│   ├── app.ts                          # Configuration Express
│   ├── config/                         # Variables d'environnement centralisées
│   │   └── index.ts
│   ├── types/                          # Définitions TypeScript (source de vérité)
│   │   └── index.ts
│   ├── utils/
│   │   └── logger.ts                   # Winston logger
│   ├── core/                           # Pipeline de traitement
│   │   ├── data-collector/             # Accès aux données (API / mock)
│   │   │   └── index.ts
│   │   ├── feature-engineering/        # Normalisation et calcul des features
│   │   │   └── index.ts
│   │   ├── prediction-engine/          # Modèle probabiliste
│   │   │   └── index.ts
│   │   └── confidence-scorer/          # Score de fiabilité de la prédiction
│   │       └── index.ts
│   ├── services/
│   │   └── prediction.service.ts       # Orchestrateur du pipeline
│   ├── api/
│   │   ├── routes/
│   │   │   └── prediction.routes.ts    # Endpoints Express
│   │   └── middleware/
│   │       └── error-handler.ts        # Gestion d'erreurs centralisée
│   └── scripts/
│       └── demo-prediction.ts          # Script de démo CLI
├── tests/
│   └── unit/
│       └── prediction-engine.test.ts
├── data/
│   ├── raw/                            # Données brutes (futures API)
│   ├── processed/                      # Données pré-traitées
│   └── predictions/                    # Historique persisté (futur)
├── logs/                               # Fichiers de logs (auto-créés)
├── .env.example                        # Template de configuration
├── package.json
└── tsconfig.json
```

---

## Pipeline de traitement

```
Requête POST /api/predict
        │
        ▼
  DataCollector          ← Charge équipes, stats, forme, H2H, blessures
        │
        ▼
  FeatureEngineer        ← Normalise tout en features 0–1
        │
        ▼
  PredictionEngine       ← Calcule probabilités (scoring pondéré + Poisson)
        │
        ▼
  ConfidenceScorer       ← Évalue la fiabilité de la prédiction
        │
        ▼
  MatchPrediction JSON   ← Réponse structurée avec explication des facteurs
```

---

## Installation

```bash
# 1. Cloner et installer les dépendances
npm install

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env selon vos besoins (PORT, LOG_LEVEL, etc.)

# 3. Lancer en développement (hot-reload)
npm run dev

# 4. Ou tester directement en CLI
npm run predict:demo
```

---

## Utilisation de l'API

### `POST /api/predict`

```bash
curl -X POST http://localhost:3000/api/predict \
  -H "Content-Type: application/json" \
  -d '{
    "homeTeamId": "psg",
    "awayTeamId": "marseille",
    "competition": "Ligue 1",
    "matchDate": "2025-04-20",
    "venue": "Parc des Princes"
  }'
```

**Réponse :**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "probabilities": {
      "homeWin": 0.5821,
      "draw": 0.2104,
      "awayWin": 0.2075
    },
    "goalProbabilities": {
      "expectedHomeGoals": 1.87,
      "expectedAwayGoals": 0.98,
      "btts": 0.48,
      "over25": 0.52
    },
    "confidence": {
      "overall": 0.634,
      "level": "MEDIUM",
      "warnings": []
    },
    "keyFactors": [...],
    "scenarios": [...],
    "disclaimer": "..."
  },
  "timestamp": "2025-04-13T10:00:00.000Z"
}
```

### `GET /api/teams` — Liste des équipes disponibles
### `GET /api/history` — Historique des prédictions de session
### `GET /api/health` — Status du serveur

---

## Scripts npm

| Commande | Description |
|---|---|
| `npm run dev` | Serveur en mode développement (hot-reload) |
| `npm run build` | Compilation TypeScript → `dist/` |
| `npm start` | Serveur de production (`dist/`) |
| `npm test` | Tests unitaires |
| `npm run predict:demo` | Démo CLI sans serveur |

---

## Variables d'environnement

| Variable | Défaut | Description |
|---|---|---|
| `PORT` | `3000` | Port du serveur |
| `NODE_ENV` | `development` | Environnement |
| `LOG_LEVEL` | `info` | Niveau de logs Winston |
| `CONFIDENCE_THRESHOLD` | `0.6` | Seuil d'affichage des avertissements |
| `MIN_MATCHES_REQUIRED` | `5` | Minimum de matchs pour analyse fiable |

---

## Équipes disponibles (MVP)

**Ligue 1** : `psg`, `marseille`, `lyon`, `monaco`, `lille`, `nice`, `lens`, `rennes`

**La Liga** : `realmadrid`, `barcelona`

**Premier League** : `arsenal`, `mancity`

**Bundesliga** : `bayern`, `dortmund`

---

## Prochaines étapes

### Court terme
- [ ] Intégration API réelle (football-data.org — gratuit jusqu'à 10 req/min)
- [ ] Persistance des prédictions (SQLite ou PostgreSQL)
- [ ] Validation des résultats réels + calcul de précision historique

### Moyen terme
- [ ] Dashboard HTML/React (`/dashboard`)
- [ ] Modèle Dixon-Coles (amélioration du modèle de Poisson)
- [ ] Support multi-saisons
- [ ] Backtesting automatisé

### Long terme
- [ ] Modèle ML (régression logistique ou gradient boosting) entraîné sur données historiques
- [ ] Alertes sur matchs à haute confiance
- [ ] Comparaison de modèles (A/B testing)

---

## Philosophie du projet

Ce projet est construit sur la **transparence** et **l'honnêteté analytique** :

1. **Pas de boîte noire** : chaque facteur est explicable et auditable
2. **Score de confiance** : toujours communiquer l'incertitude
3. **Disclaimer systématique** : rappel que probabilité ≠ certitude
4. **Données d'abord** : aucune prédiction sans données suffisantes
