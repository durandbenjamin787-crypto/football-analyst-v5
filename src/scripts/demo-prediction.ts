/**
 * Script de démonstration — lance une prédiction directement sans serveur HTTP.
 * Usage : npm run predict:demo
 */
import { PredictionService } from '../services/prediction.service';

async function runDemo(): Promise<void> {
  const service = new PredictionService();

  const matchups = [
    { homeTeamId: 'psg',       awayTeamId: 'marseille', label: '🏆 Classique — PSG vs OM' },
    { homeTeamId: 'monaco',    awayTeamId: 'lyon',       label: '⚔️  Monaco vs Lyon' },
    { homeTeamId: 'lille',     awayTeamId: 'psg',        label: '💪 Lille vs PSG (déplacement)' },
    { homeTeamId: 'barcelona', awayTeamId: 'realmadrid', label: '🌍 El Clásico — Barça vs Real' },
  ];

  for (const m of matchups) {
    console.log('\n' + '═'.repeat(60));
    console.log(m.label);
    console.log('═'.repeat(60));

    const prediction = await service.predict({
      homeTeamId: m.homeTeamId,
      awayTeamId: m.awayTeamId,
      competition: 'Demo',
      matchDate: new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString(),
    });

    const p = prediction.probabilities;
    const g = prediction.goalProbabilities;
    const c = prediction.confidence;

    console.log(`\n📊 PROBABILITÉS`);
    console.log(`  Victoire ${prediction.match.homeTeam.padEnd(22)} ${pct(p.homeWin)}`);
    console.log(`  Match nul                      ${pct(p.draw)}`);
    console.log(`  Victoire ${prediction.match.awayTeam.padEnd(22)} ${pct(p.awayWin)}`);

    console.log(`\n⚽ BUTS ATTENDUS`);
    console.log(`  ${prediction.match.homeTeam} : ${g.expectedHomeGoals}`);
    console.log(`  ${prediction.match.awayTeam} : ${g.expectedAwayGoals}`);
    console.log(`  BTTS : ${pct(g.btts)}  |  +2.5 : ${pct(g.over25)}  |  -2.5 : ${pct(g.under25)}`);

    console.log(`\n🎯 CONFIANCE : ${c.level} (${pct(c.overall)})`);
    if (c.warnings.length) {
      console.log(`  ⚠️  Avertissements :`);
      c.warnings.forEach(w => console.log(`     - ${w}`));
    }

    console.log(`\n🔑 FACTEURS CLÉS`);
    prediction.keyFactors.slice(0, 3).forEach(f => {
      const arrow = f.impact === 'POSITIVE_HOME' ? '→ DOM' : f.impact === 'POSITIVE_AWAY' ? '→ EXT' : '⇄';
      console.log(`  ${arrow} [${pct(f.weight)}] ${f.name} : ${f.description}`);
    });

    console.log(`\n📋 SCÉNARIOS`);
    prediction.scenarios.slice(0, 3).forEach(s => {
      console.log(`  ${pct(s.probability)} — ${s.label}`);
    });
  }

  console.log('\n' + '─'.repeat(60));
  console.log('⚠️  DISCLAIMER');
  console.log('Ces analyses sont des outils d\'aide à la réflexion,');
  console.log('pas des prédictions certaines. Le football est imprévisible.');
  console.log('─'.repeat(60) + '\n');
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

runDemo().catch(console.error);
