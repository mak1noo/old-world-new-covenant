import { cardBySerial, cards, constants, type Card, type Recipe } from './cards';
import { applyIntent, attackOptions, canSublimate, definition, isNumberOnly, other, units, type Game, type Intent, type Side, type Unit } from './game';

const fusionCards = cards.filter((card): card is Card & { recipe: Recipe } => card.recipe !== undefined);
export type FusionOption = { card: Card; recipe: Recipe; materials: Unit[][]; craftable: boolean };

export function fusionOptions(inventory: readonly Unit[], lp: number): FusionOption[] {
  return fusionCards.map(card => {
    const recipe = card.recipe;
    const materials = recipe.materials.map(material => inventory.filter(unit => unit.card === material.id));
    const craftable = recipe.lpCost <= lp &&
      materials.every((group, index) => group.length >= recipe.materials[index].count);
    return { card, recipe, materials, craftable };
  });
}

export function battleIntents(game: Game, side: Side): Intent[] {
  if (game.pending) return side === game.pending.side ? game.pending.options.map(({ value }) => ({ type: 'choose', value })) : [];
  if (game.phase !== 'battle' || game.active !== side) return [];
  const friendly = units(game.players[side]);
  const enemies = units(game.players[other(side)]);
  const intents: Intent[] = [];
  for (const unit of friendly) {
    const { targets, all } = attackOptions(game, side, unit);
    const id = unit.id;
    const free = definition(unit).abilities.find(ability => ability.effect === 'swap_two_allies_once' && unit.star === ability.condition?.selfStar);
    if (free && !unit.onceUsed && !unit.flipped) for (let left = 0; left < friendly.length; left++) {
      for (const right of friendly.slice(left + 1)) intents.push({ type: 'arcane', id, first: friendly[left].id, second: right.id });
    }
    if (unit.acted || unit.flipped) continue;
    if (!targets.length) intents.push({ type: 'skip', id });
    else if (all) intents.push({ type: 'attack', id });
    else intents.push(...targets.map(target => ({ type: 'attack' as const, id, target: target.id })));
    for (const ability of definition(unit).abilities.filter(ability => ability.kind === 'active')) {
      const emit = (target?: Unit, ally?: Unit) => intents.push({ type: 'ability', id, target: target?.id, ally: ally?.id });
      const teammates = friendly.filter(candidate => candidate !== unit);
      switch (ability.effect) {
        case 'active_spiral_double_sweep':
          if (targets.length) emit();
          break;
        case 'active_self_hp_heal_allies':
        case 'active_self_hp_cost_aoe':
          if (unit.hp > Number(ability.params.selfHpCost)) emit();
          break;
        case 'active_damage_or_heal':
          for (const target of [...friendly, ...enemies]) emit(target);
          break;
        case 'active_damage_then_self_destroy':
          for (const target of enemies) {
            const ownIndex = game.players[side].field.indexOf(unit);
            const targetIndex = constants.fieldSlots - 1 - game.players[other(side)].field.indexOf(target);
            if (Math.abs(ownIndex - targetIndex) <= 1) emit(target);
          }
          break;
        case 'active_true_damage_self_destroy':
          for (const enemy of enemies) emit(enemy);
          break;
        case 'active_swap_hp_with_ally':
        case 'active_swap_position':
          for (const ally of teammates) emit(ally);
          break;
        case 'active_grant_extra_attack':
          for (const ally of teammates) {
            const options = attackOptions(game, side, ally);
            for (const target of options.all ? options.targets.slice(0, 1) : options.targets) emit(ally, target);
          }
          break;
      }
    }
  }
  return intents;
}
export function developmentOptions(game: Game, side: Side): Intent[] {
  const player = game.players[side];
  const candidates: Intent[] = [{ type: 'ready' }];
  const inventory = [...player.bench, ...units(player)];
  const hand = player.hand;
  for (let i = 0; i < hand.length; i++) for (let j = i + 1; j < hand.length; j++) {
    for (let k = j + 1; k < hand.length; k++) {
      const subset = [hand[i], hand[j], hand[k]];
      for (const serial of constants.serials) if (canSublimate(subset, serial)) {
        candidates.push({ type: 'sublimate', ids: subset.map(raw => raw.id), serial });
      }
    }
  }
  for (const raw of hand) {
    const matching = hand.filter(card => card.serial === raw.serial && (raw.serial !== 'a' || !isNumberOnly(card)));
    const original = matching.find(card => !isNumberOnly(card));
    if (!original) continue;
    const same = [original, ...matching.filter(card => card !== original).slice(0, 1)];
    if (player.lp >= 3 - same.length && canSublimate(same, raw.serial)) {
      candidates.push({ type: 'sublimate', ids: same.map(card => card.id), serial: raw.serial });
    }
  }
  for (const target of [10, ...(player.skills.some(id => id === 'skill_blood_star') ? [7] : [])] as (7 | 10)[]) {
    const find = (start: number, total: number, ids: number[]): number[] | undefined => {
      if (total === 0 && ids.length) return ids;
      for (let index = start; index < hand.length; index++) {
        const raw = hand[index];
        if (raw.serial === 'a') return [...ids, raw.id];
        const value = Number(raw.serial);
        if (value > 0 && value <= total) {
          const match = find(index + 1, total - value, [...ids, raw.id]);
          if (match) return match;
        }
      }
    };
    const match = find(0, target, []);
    if (match) candidates.push({ type: 'sum', ids: match, total: target });
  }
  for (const [slot, card] of player.shop.entries()) if (card && player.lp >= constants.shopBuyCostLp) candidates.push({ type: 'buy', slot });
  for (const unit of player.bench) for (const [slot, occupant] of player.field.entries()) {
    const card = definition(unit);
    if (!occupant && (card.category === 'base' || !player.field.some(other => other?.card === unit.card))) {
      candidates.push({ type: 'place', id: unit.id, slot });
    }
  }
  const seen = new Set<string>();
  for (const unit of inventory) {
    const key = `${unit.card}:${unit.star}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (unit.star >= definition(unit).maxStar) continue;
    const pair = inventory.find(ally => ally !== unit && ally.card === unit.card && ally.star === unit.star);
    if (pair) candidates.push({ type: 'star', ids: [unit.id, pair.id] });
  }
  for (const card of cards) {
    const recipe = card.recipe;
    if (!recipe || recipe.lpCost > player.lp) continue;
    const materials = recipe.materials.map(material => inventory.filter(unit => unit.card === material.id)
      .sort((a, b) => a.star - b.star).slice(0, material.count));
    if (materials.every((matches, index) => matches.length === recipe.materials[index].count)) {
      candidates.push({ type: 'fuse', card: card.id, ids: materials.flat().map(unit => unit.id) });
    }
  }
  return candidates;
}
export function cardForSublimation(serial: string) {
  return cardBySerial.get(serial)!;
}
export function isLegal(game: Game, side: Side, intent: Intent): boolean {
  try {
    applyIntent(game, side, intent);
    return true;
  } catch {
    return false;
  }
}
