/**
 * Swagger / OpenAPI 3.0 — spécification complète de l'API Football Analyst.
 * Servie sur /api/docs (UI) et /api/docs.json (spec brute).
 */
export const swaggerSpec = {
  openapi: '3.0.0',
  info: {
    title: 'Football Analyst API',
    version: '3.0.0',
    description: `
Moteur d'analyse probabiliste de matchs de football.

**⚠️ Avertissement** : Cet outil est un aide à l'analyse statistique.
Les probabilités calculées ne constituent pas des certitudes.
Ne jamais utiliser seules pour des décisions financières.
    `,
    contact: { name: 'Football Analyst', url: 'http://localhost:3000/dashboard' },
  },
  servers: [
    { url: 'http://localhost:3000', description: 'Développement local' },
  ],
  tags: [
    { name: 'Prédictions', description: 'Génération et historique des analyses' },
    { name: 'Équipes',     description: 'Données sur les équipes' },
    { name: 'Matchs',      description: 'Matchs à venir et résultats' },
    { name: 'Métriques',   description: 'Performance du modèle' },
    { name: 'Backtesting', description: 'Évaluation historique du modèle' },
    { name: 'Système',     description: 'Health check et infos système' },
  ],
  paths: {
    '/api/health': {
      get: {
        tags: ['Système'],
        summary: 'Status du serveur',
        responses: {
          '200': { description: 'Serveur opérationnel', content: { 'application/json': { schema: { $ref: '#/components/schemas/HealthResponse' } } } },
        },
      },
    },
    '/api/teams': {
      get: {
        tags: ['Équipes'],
        summary: 'Liste toutes les équipes disponibles',
        responses: {
          '200': { description: 'Liste des équipes groupées par ligue', content: { 'application/json': { schema: { $ref: '#/components/schemas/TeamsResponse' } } } },
        },
      },
    },
    '/api/predict': {
      post: {
        tags: ['Prédictions'],
        summary: 'Génère une analyse complète pour un match',
        description: 'Exécute le pipeline complet : collecte → features → modèle → confiance → explication',
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/PredictRequest' },
              examples: {
                psgOm: {
                  summary: 'PSG vs Marseille',
                  value: { homeTeamId: 'psg', awayTeamId: 'marseille', competition: 'Ligue 1', matchDate: '2025-04-20' },
                },
                clasico: {
                  summary: 'El Clásico',
                  value: { homeTeamId: 'barcelona', awayTeamId: 'realmadrid', competition: 'La Liga', matchDate: '2025-04-27' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Prédiction générée avec succès', content: { 'application/json': { schema: { $ref: '#/components/schemas/PredictionResponse' } } } },
          '400': { description: 'Paramètres invalides', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
          '404': { description: 'Équipe introuvable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorResponse' } } } },
        },
      },
    },
    '/api/predictions/history': {
      get: {
        tags: ['Prédictions'],
        summary: 'Historique des prédictions',
        parameters: [
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 50, maximum: 200 }, description: 'Nombre de prédictions à retourner' },
          { name: 'competition', in: 'query', schema: { type: 'string' }, description: 'Filtrer par compétition (ex: Ligue 1)' },
        ],
        responses: {
          '200': { description: 'Liste des prédictions', content: { 'application/json': { schema: { $ref: '#/components/schemas/HistoryResponse' } } } },
        },
      },
    },
    '/api/predictions/{id}/result': {
      patch: {
        tags: ['Prédictions'],
        summary: 'Enregistre le résultat réel d\'un match',
        description: 'Permet le backtesting en comparant prédiction et résultat réel',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/UpdateResultRequest' },
              example: { actualOutcome: 'HOME_WIN', actualHomeGoals: 2, actualAwayGoals: 0 },
            },
          },
        },
        responses: {
          '200': { description: 'Résultat enregistré' },
          '400': { description: 'Paramètres invalides' },
        },
      },
    },
    '/api/model/metrics': {
      get: {
        tags: ['Métriques'],
        summary: 'Métriques de performance du modèle',
        description: 'Précision 1N2, Brier Score, performance par ligue et niveau de confiance',
        responses: {
          '200': { description: 'Métriques calculées', content: { 'application/json': { schema: { $ref: '#/components/schemas/MetricsResponse' } } } },
        },
      },
    },
    '/api/backtest': {
      post: {
        tags: ['Backtesting'],
        summary: 'Lance un backtesting sur données simulées',
        description: 'Teste le modèle sur les matchs historiques simulés et retourne les métriques complètes',
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  season:  { type: 'string', example: '2023-24', description: 'Saison à tester (défaut: 2023-24)' },
                  league:  { type: 'string', example: 'Ligue 1', description: 'Filtrer par ligue (optionnel)' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'Résultats du backtesting', content: { 'application/json': { schema: { $ref: '#/components/schemas/BacktestResponse' } } } },
        },
      },
    },
    '/api/matches/upcoming': {
      get: {
        tags: ['Matchs'],
        summary: 'Matchs à venir',
        responses: {
          '200': { description: 'Liste des prochains matchs', content: { 'application/json': { schema: { type: 'object' } } } },
        },
      },
    },
  },
  components: {
    schemas: {
      PredictRequest: {
        type: 'object', required: ['homeTeamId', 'awayTeamId', 'competition', 'matchDate'],
        properties: {
          homeTeamId:  { type: 'string', example: 'psg', description: 'ID de l\'équipe domicile' },
          awayTeamId:  { type: 'string', example: 'marseille', description: 'ID de l\'équipe extérieure' },
          competition: { type: 'string', example: 'Ligue 1' },
          matchDate:   { type: 'string', format: 'date', example: '2025-04-20' },
          venue:       { type: 'string', example: 'Parc des Princes' },
        },
      },
      UpdateResultRequest: {
        type: 'object', required: ['actualOutcome', 'actualHomeGoals', 'actualAwayGoals'],
        properties: {
          actualOutcome:   { type: 'string', enum: ['HOME_WIN', 'DRAW', 'AWAY_WIN'] },
          actualHomeGoals: { type: 'integer', minimum: 0, maximum: 30 },
          actualAwayGoals: { type: 'integer', minimum: 0, maximum: 30 },
        },
      },
      PredictionResponse: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          data: {
            type: 'object',
            properties: {
              id: { type: 'string', format: 'uuid' },
              probabilities: {
                type: 'object',
                properties: {
                  homeWin: { type: 'number', minimum: 0, maximum: 1 },
                  draw:    { type: 'number', minimum: 0, maximum: 1 },
                  awayWin: { type: 'number', minimum: 0, maximum: 1 },
                },
              },
              goalProbabilities: { type: 'object' },
              confidence: {
                type: 'object',
                properties: {
                  overall:  { type: 'number' },
                  level:    { type: 'string', enum: ['VERY_LOW','LOW','MEDIUM','HIGH','VERY_HIGH'] },
                  warnings: { type: 'array', items: { type: 'string' } },
                },
              },
              keyFactors: { type: 'array' },
              scenarios:  { type: 'array' },
              disclaimer: { type: 'string' },
            },
          },
          timestamp: { type: 'string', format: 'date-time' },
        },
      },
      HealthResponse:   { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { status: { type: 'string' }, uptime: { type: 'integer' }, version: { type: 'string' } } } } },
      TeamsResponse:    { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { teams: { type: 'array' }, byLeague: { type: 'object' }, count: { type: 'integer' } } } } },
      HistoryResponse:  { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { predictions: { type: 'array' }, count: { type: 'integer' } } } } },
      MetricsResponse:  { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object' } } },
      BacktestResponse: { type: 'object', properties: { success: { type: 'boolean' }, data: { type: 'object', properties: { totalMatches: { type: 'integer' }, accuracy1N2: { type: 'number' }, brierScore: { type: 'number' }, logLoss: { type: 'number' } } } } },
      ErrorResponse:    { type: 'object', properties: { success: { type: 'boolean', example: false }, error: { type: 'string' }, timestamp: { type: 'string' } } },
    },
  },
};
