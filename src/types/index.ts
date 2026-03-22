export interface Team { id: string; name: string; shortName: string; league: string; country: string; }
export interface MatchResult { homeGoals: number; awayGoals: number; outcome: 'HOME_WIN' | 'DRAW' | 'AWAY_WIN'; }
export interface Match { id: string; date: string; homeTeam: Team; awayTeam: Team; result?: MatchResult; competition: string; season: string; venue: string; homeXG?: number; awayXG?: number; homeShots?: number; awayShots?: number; homePossession?: number; }

export interface SplitStats { played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; xGFor?: number; xGAgainst?: number; cleanSheets: number; }
export interface TeamStats { teamId: string; season: string; played: number; wins: number; draws: number; losses: number; goalsFor: number; goalsAgainst: number; xGFor?: number; xGAgainst?: number; cleanSheets: number; failedToScore: number; leaguePosition: number; homeStats?: SplitStats; awayStats?: SplitStats; }

export interface FormMatch { date: string; isHome: boolean; goalsFor: number; goalsAgainst: number; xGFor?: number; xGAgainst?: number; outcome: 'W' | 'D' | 'L'; opponent: string; weight: number; }
export interface WeightedForm { teamId: string; recentMatches: FormMatch[]; weightedFormRating: number; weightedHomeRating: number; weightedAwayRating: number; weightedGoalsFor: number; weightedGoalsAgainst: number; weightedXGFor?: number; weightedXGAgainst?: number; trend: 'IMPROVING' | 'DECLINING' | 'STABLE'; currentStreak: { type: 'W' | 'D' | 'L'; count: number }; }

export interface HeadToHead { homeTeamId: string; awayTeamId: string; totalMatches: number; homeWins: number; draws: number; awayWins: number; avgHomeGoals: number; avgAwayGoals: number; avgTotalGoals: number; bttsRate: number; over25Rate: number; lastMeetings: Match[]; }

export interface PlayerAbsence { playerId: string; playerName: string; teamId: string; position: 'GK' | 'DEF' | 'MID' | 'FWD'; reason: 'INJURY' | 'SUSPENSION' | 'INTERNATIONAL' | 'OTHER'; importance: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'; returnDate?: string; estimatedImpact: number; }
export interface FatigueContext { teamId: string; matchesLast7Days: number; matchesLast14Days: number; daysSinceLastMatch: number; longDistanceTravel: boolean; fatigueScore: number; }

export interface MatchFeatures { matchId: string; homeFormRating: number; awayFormRating: number; homeFormTrend: number; awayFormTrend: number; homeHomeAttack: number; homeHomeDefense: number; awayAwayAttack: number; awayAwayDefense: number; homeLastGoalsFor: number; homeLastGoalsAgainst: number; awayLastGoalsFor: number; awayLastGoalsAgainst: number; homeXGAvg: number; awayXGAvg: number; homeXGAAvg: number; awayXGAAvg: number; homeLeaguePosition: number; awayLeaguePosition: number; homeAdvantage: number; h2hHomeWinRate: number; h2hDrawRate: number; h2hAwayWinRate: number; h2hAvgGoals: number; h2hMatchesPlayed: number; h2hBttsRate: number; homeAbsenceImpact: number; awayAbsenceImpact: number; homeFatigueScore: number; awayFatigueScore: number; homeAttackRating: number; awayAttackRating: number; homeDefenseRating: number; awayDefenseRating: number; homeLambda: number; awayLambda: number; }

export type ModelName = 'POISSON' | 'DIXON_COLES' | 'WEIGHTED_SCORING' | 'ENSEMBLE';
export interface OutcomeProbabilities { homeWin: number; draw: number; awayWin: number; }
export interface GoalProbabilities { expectedHomeGoals: number; expectedAwayGoals: number; over15: number; over25: number; over35: number; under15: number; under25: number; under35: number; btts: number; bttsNo: number; cleanSheetHome: number; cleanSheetAway: number; }
export interface ExactScore { home: number; away: number; probability: number; label: string; }
export interface ScoreMatrix { matrix: number[][]; topScores: ExactScore[]; mostLikelyScore: string; }
export interface ModelPrediction { model: ModelName; probabilities: OutcomeProbabilities; goalProbabilities: GoalProbabilities; scoreMatrix?: ScoreMatrix; weight?: number; confidence?: number; }

export interface MatchContext { homeTeam: string; homeTeamId: string; awayTeam: string; awayTeamId: string; competition: string; date: string; venue: string; }
export interface FinalPrediction { probabilities: OutcomeProbabilities; goalProbabilities: GoalProbabilities; scoreMatrix: ScoreMatrix; predictedOutcome: string; predictedScore: string; }
export interface ConfidenceScore { overall: number; dataQuality: number; modelAgreement: number; sampleSize: number; level: 'VERY_LOW' | 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH'; warnings: string[]; }
export interface PredictionFactor { name: string; category: 'FORM' | 'STATS' | 'H2H' | 'CONTEXT' | 'ABSENCE' | 'TACTICAL'; impact: 'POSITIVE_HOME' | 'POSITIVE_AWAY' | 'NEUTRAL'; magnitude: number; description: string; data?: Record<string, unknown>; }
export interface MatchScenario { label: string; probability: number; score?: string; description: string; type: 'OUTCOME' | 'GOALS' | 'SCORE'; }

export interface TeamContext { teamId: string; teamName: string; recentForm: WeightedForm; seasonStats: TeamStats; absences: PlayerAbsence[]; fatigue: FatigueContext; leaguePosition: number; }
export interface MatchAnalysis { id: string; createdAt: string; modelVersion: string; match: MatchContext; features: MatchFeatures; modelPredictions: ModelPrediction[]; finalPrediction: FinalPrediction; confidence: ConfidenceScore; keyFactors: PredictionFactor[]; scenarios: MatchScenario[]; homeContext: TeamContext; awayContext: TeamContext; disclaimer: string; }

export interface BacktestConfig { season: string; league?: string; models: ModelName[]; minConfidence?: number; }
export interface CalibrationBucket { range: string; avgPredicted: number; actualFrequency: number; count: number; calibrationError: number; }
export interface CalibrationData { buckets: CalibrationBucket[]; overallCalibrationError: number; }
export interface LeaguePerformance { league: string; total: number; correct: number; accuracy: number; avgBrier: number; }
export interface ConfidencePerformance { level: string; total: number; correct: number; accuracy: number; }
export interface ModelBacktestResult { model: ModelName; totalMatches: number; correct1N2: number; accuracy1N2: number; brierScore: number; logLoss: number; baselineAccuracy: number; lift: number; byLeague: LeaguePerformance[]; byConfidence: ConfidencePerformance[]; overUnderAccuracy: number; bttsAccuracy: number; }
export interface BacktestResult { config: BacktestConfig; totalMatches: number; byModel: ModelBacktestResult[]; calibration: CalibrationData; disclaimer: string; }

export interface AnalyzeRequest { homeTeamId: string; awayTeamId: string; competition: string; matchDate: string; venue?: string; models?: ModelName[]; }
export interface ApiResponse<T> { success: boolean; data?: T; error?: string; timestamp: string; duration?: number; }
