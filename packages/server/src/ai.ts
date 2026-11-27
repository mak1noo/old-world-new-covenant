import { cardById, cardBySerial } from '../../shared/src/cards';
import { applyIntent, attackOptions, definition, maxHp, other, units, type Game, type Intent, type Side, type Unit } from '../../shared/src/game';
import { battleIntents, developmentOptions } from '../../shared/src/legal';
import { visibleSimulation, type PublicBoard } from '../../shared/src/view';

export type Difficulty = 'easy' | 'hard';
type ModelCard = NonNullable<ReturnType<typeof cardById.get>>;
function cardValue(card: ModelCard, star = 1): number {
  const attack = card.attack;
  const tier = star - 1;
  const ordinary = attack?.damageByStar?.[tier] ?? (attack?.percent ? card.hpByStar[tier] * attack.percent / 100 : 0);
  const real = attack?.trueDamageByStar?.[tier] ?? 0;
  const flexible = attack?.targets?.some(target => target === 'any' || target === 'all') ? 1.2 : 1;
  return card.hpByStar[tier] * 0.42 + (ordinary + real * 1.3) * flexible + card.apByStar[tier] * 0.13
    + (card.category === 'base' ? 0 : 2);
}
function prepValue(game: Game, side: Side, intent: Intent, hard: boolean): number {
  const own = game.players[side];
  const field = units(own);
  const inventory = [...own.bench, ...field];
  switch (intent.type) {
    case 'ready': return 0;
    case 'sum': return hard ? 10 + 1 / intent.ids.length : 3;
    case 'place': {
      const unit = own.bench.find(unit => unit.id === intent.id)!;
      if (!hard) return 20 - intent.slot * 0.1;
      const simulation = structuredClone(game);
      const place = simulation.players[side].bench.find(item => item.id === unit.id)!;
      simulation.players[side].field[intent.slot] = place;
      const enemies = units(simulation.players[other(side)]);
      const attacks = attackOptions(simulation, side, place);
      const immediate = enemies.length && !attacks.targets.length && definition(place).attack ? -6 : attacks.targets.length * 0.45;
      const coverage = intent.slot === 2 ? 0.9 : Math.abs(intent.slot - 2) === 1 ? 0.5 : 0;
      const center = definition(place).attack?.alternate && intent.slot === 2 ? 0.9 : 0;
      return 20 + cardValue(definition(unit), unit.star) + immediate + coverage + center;
    }
    case 'sublimate': {
      const card = cardBySerial.get(intent.serial)!;
      const cost = 3 - intent.ids.length;
      if (!hard) return 7 - cost * 3 + (field.length ? 0 : 2);
      return 10 + cardValue(card) * 0.8 - cost * 5 - Math.max(0, inventory.length - 6);
    }
    case 'buy': {
      const raw = own.shop[intent.slot]!;
      const card = cardBySerial.get(raw.serial)!;
      if (!hard) return inventory.length < 5 ? 2 : -1;
      return inventory.length < 6 ? 1 + cardValue(card) * 0.65 - own.bench.length : -1;
    }
    case 'star': {
      const [unit] = inventory.filter(unit => intent.ids.includes(unit.id));
      return hard ? (inventory.length >= 4 ? 45 : 6) + cardValue(definition(unit), unit.star + 1) : 9;
    }
    case 'fuse':
      return hard ? 55 + cardValue(cardById.get(intent.card)!) : 10;
    default: return -1;
  }
}
function boardValue(game: Game, side: Side): number {
  const score = (owner: Side) => {
    const player = game.players[owner];
    return player.hp * 70 + units(player).reduce((sum, unit) => sum + 4 + unit.hp * 0.7
      + cardValue(definition(unit), unit.star) * 0.45 - (unit.acted ? 0.4 : 0), 0);
  };
  return score(side) - score(other(side));
}
function attackValue(game: Game, side: Side, intent: Intent): number {
  if (intent.type === 'skip') return -80;
  if (intent.type === 'arcane') return -10;
  if (intent.type !== 'attack') return -4;
  const unit = units(game.players[side]).find(unit => unit.id === intent.id)!;
  const options = attackOptions(game, side, unit);
  const targets = options.all ? options.targets : options.targets.filter(foe => foe.id === intent.target);
  return targets.reduce((total, target) => {
    const potential = options.normal + options.trueDamage;
    return total + Math.min(potential, target.hp) + (potential >= target.hp ? 15 : 0);
  }, 0);
}
function resolvePrediction(game: Game, side: Side, intent: Intent): Game {
  let next = applyIntent(game, side, intent);
  while (next.pending) {
    const choice = next.pending;
    next = applyIntent(next, choice.side, { type: 'choose', value: choice.options.find(option => option.value === 1)?.value ?? choice.options.at(-1)!.value });
  }
  return next;
}
export function aiIntent(game: Game, side: Side, difficulty: Difficulty, snapshot: PublicBoard): Intent | undefined {
  if (game.pending) {
    if (game.pending.side !== side) return;
    const options = game.pending.options;
    const choice = options.find(option => option.value === 1) ?? options.at(-1);
    return choice && { type: 'choose', value: choice.value };
  }
  if (game.phase === 'finished' || game.phase === 'prep' && game.players[side].ready) return;
  const visible = visibleSimulation(game, side, snapshot);
  const hard = difficulty === 'hard';
  if (game.phase === 'prep') {
    const options = developmentOptions(visible, side);
    const sorted = options.map(intent => ({ intent, score: prepValue(visible, side, intent, hard) }))
      .sort((left, right) => right.score - left.score);
    return sorted[0]?.intent;
  }
  const legal = battleIntents(visible, side);
  if (!legal.length) return;
  const quick = legal.map(intent => ({ intent, score: attackValue(visible, side, intent) }))
    .sort((left, right) => right.score - left.score);
  if (!hard) return quick[0].intent;
  const deadline = performance.now() + 180;
  let best = quick[0].intent;
  let bestScore = -Infinity;
  for (const candidate of quick.slice(0, 16)) {
    if (performance.now() > deadline) break;
    try {
      const next = resolvePrediction(visible, side, candidate.intent);
      let score = boardValue(next, side);
      if (next.phase === 'battle' && next.active !== side) {
        const reply = battleIntents(next, other(side))
          .sort((left, right) => attackValue(next, other(side), right) - attackValue(next, other(side), left))
          .slice(0, 4);
        let lowest = Infinity;
        for (const response of reply) {
          try { lowest = Math.min(lowest, boardValue(resolvePrediction(next, other(side), response), side)); } catch { /* illegal simulated branch */ }
        }
        if (Number.isFinite(lowest)) score = 0.35 * score + 0.65 * lowest;
      }
      score += candidate.score * 0.3;
      if (score > bestScore) {
        best = candidate.intent;
        bestScore = score;
      }
    } catch { /* illegal simulated branch */ }
  }
  return best;
}
