import { cardById, cardBySerial, constants, positions, purchasedUpgrade, skillById, validateCards, type Card } from './cards';

export type Side = 0 | 1;
export type RawCard = { id: number; printed: string; serial: string; changed?: true };
export type Unit = { id: number; card: string; star: number; hp: number; acted: boolean; auraHp?: number; defense?: number; stack?: number;
  onceUsed?: boolean; temporary?: boolean; bonusHp?: number; sweep?: { column: number; step: number }; flipped?: boolean };
export type Player = {
  hp: number; lp: number; deck: RawCard[]; hand: RawCard[]; shop: (RawCard | null)[];
  bench: Unit[]; field: (Unit | null)[]; aSlot: null; skills: string[];
  ready: boolean; won: boolean; loveUsed: boolean; resetUsed: boolean;
};
export type LogEntry = {
  battle: number; round: number;
  kind: 'damage' | 'heal' | 'destroy' | 'summon' | 'move' | 'result' | 'action' | 'effect' | 'round' | 'opening' | 'closing';
  text: string; unit?: number; source?: number; player?: Side; before?: number; after?: number; amount?: number;
  summoned?: { slot: number; unit: Unit };
  swap?: [number, number];
  acted?: true;
};
export type Game = {
  rng: number; nextId: number; nextUnitId: [number, number]; players: [Player, Player]; phase: 'prep' | 'battle' | 'finished';
  playerHpLimit: number; battle: number; round: number; first: Side; active: Side; progress: boolean; noDamageRounds: number; winner: Side | null;
  log: LogEntry[]; pending?: PendingChoice;
};
type Choice = { side: Side; label: string; options: { value: number; label: string }[] };
type PendingChoice = Choice & { originalSide: Side; originalIntent: Intent; answers: number[] };
type Resolution = { answers: number[]; cursor: number };
class NeedChoice extends Error {
  constructor(readonly choice: Choice) { super(choice.label); }
}
function choose(resolution: Resolution, choice: Choice): number {
  const answer = resolution.answers[resolution.cursor++];
  if (answer === undefined) throw new NeedChoice(choice);
  rule(choice.options.some(option => option.value === answer), '效果选择无效');
  return answer;
}
export type Intent =
  | { type: 'ready' | 'unready' | 'refresh' }
  | { type: 'surrender'; battle: number }
  | { type: 'buy'; slot: number }
  | { type: 'sublimate'; ids: number[]; serial: string }
  | { type: 'sum'; ids: number[]; total: 7 | 10 }
  | { type: 'place'; id: number; slot: number }
  | { type: 'bench' | 'sell' | 'alchemy' | 'decompose'; id: number }
  | { type: 'fuse'; card: string; ids: number[] }
  | { type: 'star' | 'reset'; ids: number[] }
  | { type: 'skill'; skill: string }
  | { type: 'change'; skill: string; id: number; serial: string }
  | { type: 'attack'; id: number; target?: number }
  | { type: 'skip'; id: number }
  | { type: 'ability'; id: number; target?: number; ally?: number }
  | { type: 'choose'; value: number }
  | { type: 'arcane'; id: number; first: number; second: number };
export type ForecastIntent = Extract<Intent, { type: 'attack' | 'ability' | 'arcane' }>;
export type CombatForecast = {
  events: Pick<LogEntry, 'kind' | 'text' | 'player' | 'before' | 'after' | 'amount'>[];
  decision?: string;
};
export const other = (side: Side): Side => side === 0 ? 1 : 0;
export const units = (player: Pick<Player, 'field'>): Unit[] => player.field.filter((unit): unit is Unit => unit !== null);
export const definition = (unit: Unit): Card => cardById.get(unit.card)!;
export const maxHp = (unit: Unit): number => definition(unit).hpByStar[unit.star - 1] + (unit.auraHp ?? 0) + (unit.bonusHp ?? 0);
const abilityOf = (unit: Unit, effect: string) => definition(unit).abilities.find(ability =>
  ability.effect === effect && !unit.flipped && (ability.condition?.selfStar === undefined || ability.condition.selfStar === unit.star));
function activeSpirit(player: Player, opening = false): Unit | undefined {
  return units(player).find(unit => (opening || unit.hp > 0) && abilityOf(unit, 'on_kill_gain_lp'));
}
const numberAt = (value: unknown, unit: Unit): number => Array.isArray(value) ? Number(value[unit.star - 1]) : Number(value);
function adjacent(player: Player, unit: Unit): Unit[] {
  const index = player.field.indexOf(unit);
  return index < 0 ? [] : [player.field[index - 1], player.field[index + 1]].filter((card): card is Unit => !!card);
}
export function protectingFishman(field: readonly (Unit | null)[], target: Unit): Unit | undefined {
  if (target.hp <= 0 || target.card === 'base_8_fishman') return;
  return field.find(source => {
    if (!source || source.hp <= 0) return false;
    const aura = abilityOf(source, 'protect_non_fishman_allies_low_hp');
    return !!aura && target.hp <= Number(aura.params.threshold);
  }) ?? undefined;
}
function updateAuras(state: Game): void {
  for (const player of state.players) for (const unit of units(player)) {
    const prior = unit.auraHp ?? 0;
    const next = adjacent(player, unit).reduce((total, ally) =>
      total + (numberAt(abilityOf(ally, 'adjacent_allies_hp_max')?.params.valueByStar, ally) || 0), 0);
    unit.auraHp = next;
    unit.hp = Math.min(maxHp(unit), unit.hp + Math.max(0, next - prior));
  }
}
function changeHealth(state: Game, player: Side, unit: Unit, next: number, text: string): void {
  const before = unit.hp;
  if (before === next) return;
  unit.hp = next;
  state.log.push({ kind: next > before ? 'heal' : 'damage', battle: state.battle, round: state.round,
    text, player, unit: unit.id, before, after: next, amount: Math.abs(next - before) });
}
function heal(state: Game, side: Side, unit: Unit, amount: number, source: Unit): void {
  if (abilityOf(unit, 'cannot_heal_self')) return;
  changeHealth(state, side, unit, Math.min(maxHp(unit), unit.hp + amount),
    `${definition(source).name}为${unit === source ? '自己' : definition(unit).name}回复生命`);
}
function attackBoost(player: Player, unit: Unit): number {
  const adjacentBonus = adjacent(player, unit).reduce((total, ally) =>
    total + (numberAt(abilityOf(ally, 'adjacent_allies_attack')?.params.valueByStar, ally) || 0), 0);
  const midBonus = player.field[2] === unit ? Number(abilityOf(unit, 'mid_position_bonus_damage')?.params.bonus ?? 0) : 0;
  const card = definition(unit);
  const capped = abilityOf(unit, 'stack_attack_on_defeat');
  const stack = capped ? Math.min(unit.stack ?? 0, Number(capped.params.cap) - (card.attack?.damageByStar?.[unit.star - 1] ?? 0))
    : abilityOf(unit, 'stack_damage_on_kill') ? unit.stack ?? 0 : 0;
  const pure = card.abilities.find(ability => ability.effect === 'conditional_damage_bonus' && ability.params.condition);
  const pureBonus = !unit.flipped && pure && units(player).every(ally => definition(ally).race === card.race)
    ? Number(pure.params.bonus) : 0;
  return adjacentBonus + midBonus + stack + (card.attack?.true ? 0 : pureBonus);
}
export const speed = (player: Pick<Player, 'field'>): number => units(player).reduce((total, unit) => total + definition(unit).apByStar[unit.star - 1], 0);
function rule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
function random(state: Game): number {
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let value = state.rng;
  value = Math.imul(value ^ (value >>> 15), value | 1);
  value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
  return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
}
function shuffle(state: Game, deck: RawCard[]): void {
  for (let index = deck.length - 1; index > 0; index--) {
    const swap = Math.floor(random(state) * (index + 1));
    [deck[index], deck[swap]] = [deck[swap], deck[index]];
  }
}
function putBack(state: Game, player: Player, cards: RawCard[]): void {
  player.deck.push(...cards.map(({ id, printed }) => ({ id, printed, serial: printed })));
  shuffle(state, player.deck);
}
function activeSkills(player: Player, effect: string) {
  return player.skills.map(id => skillById.get(id)!).filter(skill =>
    skill.effect === effect && !purchasedUpgrade(player.skills, skill.id));
}
function prep(state: Game): void {
  state.phase = 'prep';
  state.round = 0;
  for (const player of state.players) {
    for (const skill of activeSkills(player, 'lp_income_per_5_lp')) {
      player.lp += Math.min(Number(skill.params.capLp),
        Math.floor(player.lp / Number(skill.params.divisor)) * Number(skill.params.lpPerUnit));
    }
    const bonuses = [...activeSkills(player, 'draw_bonus'),
      ...(player.won ? activeSkills(player, 'win_draw_bonus_next_prep') : [])];
    const count = bonuses.reduce((sum, skill) => sum + Number(skill.params.bonus), constants.handDrawBase);
    player.hand = player.deck.splice(0, count);
    player.shop = player.deck.splice(0, constants.shopSize);
    player.ready = player.loveUsed = player.resetUsed = false;
  }
}
export function createGame({ seed = 1, playerHp = constants.playerHp }: { seed?: number; playerHp?: number } = {}): Game {
  rule(Number.isSafeInteger(playerHp) && playerHp > 0, '初始生命必须为正整数');
  const state: Game = {
    rng: seed >>> 0, nextId: 1, nextUnitId: [101, 102], players: [] as unknown as Game['players'], phase: 'prep', playerHpLimit: playerHp, battle: 1,
    round: 0, first: 0, active: 0, progress: false, noDamageRounds: 0, winner: null, log: [],
  };
  const createPlayer = (): Player => {
    const deck = constants.serials.flatMap(printed => Array.from({ length: constants.deckSerialCopies },
      () => ({ id: state.nextId++, printed, serial: printed })));
    shuffle(state, deck);
    return { deck, hp: playerHp, lp: constants.startingLp, hand: [], shop: [], bench: [],
      field: Array.from({ length: constants.fieldSlots }, () => null), aSlot: null,
      skills: [], ready: false, won: false, loveUsed: false, resetUsed: false };
  };
  state.players = [createPlayer(), createPlayer()];
  prep(state);
  return state;
}
function allocateUnit(state: Game, side: Side): number {
  const id = state.nextUnitId[side];
  state.nextUnitId[side] += 2;
  return id;
}
export function addUnit(state: Game, side: Side, card: string, star = 1): Unit {
  const unit = { id: allocateUnit(state, side), card, star, hp: 0, acted: false };
  unit.hp = maxHp(unit);
  state.players[side].bench.push(unit);
  return unit;
}
function select<T extends { id: number }>(pool: T[], ids: number[]): T[] {
  rule(ids.length > 0 && new Set(ids).size === ids.length, '请选择不同的卡牌');
  return ids.map(id => {
    const item = pool.find(card => card.id === id);
    rule(item, '所选卡牌不存在');
    return item;
  });
}
function remove<T extends { id: number }>(pool: T[], ids: number[]): T[] {
  return pool.filter(item => !ids.includes(item.id));
}
function removeUnits(player: Player, ids: number[]): void {
  player.bench = remove(player.bench, ids);
  player.field = player.field.map(unit => unit && !ids.includes(unit.id) ? unit : null);
}
function spend(player: Player, amount: number): void {
  rule(player.lp >= amount, 'lp 不足');
  player.lp -= amount;
}
function validSlot(slot: number, count: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < count;
}
export function isNumberOnly(card: RawCard): boolean {
  return card.changed === true || card.serial !== card.printed;
}
export function canSublimate(cards: readonly RawCard[], result: string): boolean {
  if (!cardBySerial.has(result) || cards.length < 1 || cards.length > 3) return false;
  if (result === 'a') return cards.every(card => card.serial === 'a' && !isNumberOnly(card));
  if (!cards.some(card => card.serial === result && !isNumberOnly(card))) return false;
  const serials = cards.map(card => card.serial);
  if (serials.length < 3) return serials.every(serial => serial === result);
  if (serials.every(serial => serial === result || serial === 'a')) return true;
  const fixed = serials.filter(serial => serial !== 'a');
  if (new Set(fixed).size !== fixed.length) return false;
  for (let start = 0; start <= constants.serials.length - 4; start++) {
    const range = [start, start + 1, start + 2].map(String);
    if (fixed.every(serial => range.includes(serial))) return true;
  }
  return false;
}
function sumMatches(cards: RawCard[], total: number): boolean {
  const fixed = cards.filter(card => card.serial !== 'a').reduce((sum, card) => sum + Number(card.serial), 0);
  const wild = cards.filter(card => card.serial === 'a').length;
  return fixed <= total && fixed + 10 * wild >= total;
}
function handOperation(state: Game, player: Player, ids: number[]): void {
  const cards = select(player.hand, ids);
  player.hand = remove(player.hand, ids);
  putBack(state, player, cards);
}
function returnUnusedCards(state: Game): void {
  for (const player of state.players) {
    putBack(state, player, [...player.hand, ...player.shop.filter((card): card is RawCard => !!card)]);
    player.hand = [];
    player.shop = [];
  }
}
function prepareAction(state: Game, side: Side, intent: Intent, resolution: Resolution): void {
  const player = state.players[side];
  if (intent.type === 'unready') {
    rule(player.ready && !state.players[other(side)].ready, '当前无法取消准备');
    player.ready = false;
    return;
  }
  rule(!player.ready, '已准备完成');
  const inventory = [...player.bench, ...units(player)];
  switch (intent.type) {
    case 'ready':
      player.ready = true;
      if (state.players.every(entry => entry.ready)) {
        returnUnusedCards(state);
        startBattle(state, resolution);
      }
      return;
    case 'refresh':
      spend(player, constants.shopRefreshCostLp);
      putBack(state, player, player.shop.filter((card): card is RawCard => !!card));
      player.shop = player.deck.splice(0, constants.shopSize);
      return;
    case 'buy': {
      const raw = player.shop[intent.slot];
      rule(validSlot(intent.slot, constants.shopSize) && raw, '商店格没有卡牌');
      spend(player, constants.shopBuyCostLp);
      player.shop[intent.slot] = null;
      putBack(state, player, [raw]);
      addUnit(state, side, cardBySerial.get(raw.serial)!.id);
      return;
    }
    case 'sublimate': {
      const cards = select(player.hand, intent.ids);
      rule(canSublimate(cards, intent.serial), '升华需要同号或连号组合，产物须为其中一张未变号的牌');
      spend(player, 3 - cards.length);
      handOperation(state, player, intent.ids);
      addUnit(state, side, cardBySerial.get(intent.serial)!.id);
      return;
    }
    case 'sum':
      rule(intent.total === 10 || intent.total === 7 && activeSkills(player, 'sum_seven_to_lp').length, '当前无法使用该凑数组合');
      rule(sumMatches(select(player.hand, intent.ids), intent.total), '点数和不符');
      handOperation(state, player, intent.ids);
      player.lp++;
      return;
    case 'place': {
      rule(validSlot(intent.slot, constants.fieldSlots), '目标站位不可用');
      const [unit] = select(inventory, [intent.id]);
      const from = player.field.indexOf(unit);
      const occupant = player.field[intent.slot];
      if (from === intent.slot) return;
      if (occupant) {
        rule(from >= 0, '只有战斗区的从者可以直接交换站位');
        [player.field[from], player.field[intent.slot]] = [occupant, unit];
        return;
      }
      rule(definition(unit).category === 'base' || !units(player).some(other => other.id !== unit.id && other.card === unit.card), '同名融合从者已在场');
      removeUnits(player, [unit.id]);
      player.field[intent.slot] = unit;
      return;
    }
    case 'bench': {
      const [unit] = select(units(player), [intent.id]);
      removeUnits(player, [unit.id]);
      player.bench.push(unit);
      return;
    }
    case 'sell': {
      const [unit] = select(player.bench, [intent.id]);
      const prices = constants.sellPricesLp as Record<string, number>;
      const category = definition(unit).category;
      const key = category === 'base' ? `sublimate${unit.star}` : category === 'fusion' ? `fusion${unit.star}` : 'highFusion';
      player.lp += prices[key];
      removeUnits(player, [unit.id]);
      return;
    }
    case 'fuse': {
      const card = cardById.get(intent.card);
      const recipe = card?.recipe;
      rule(card && recipe, '不存在该融合配方');
      const materials = select(inventory, intent.ids);
      rule(materials.length === recipe.materials.reduce((count, material) => count + material.count, 0) &&
        recipe.materials.every(material => materials.filter(unit => unit.card === material.id).length === material.count), '融合素材不匹配');
      spend(player, recipe.lpCost);
      removeUnits(player, intent.ids);
      addUnit(state, side, card.id);
      return;
    }
    case 'star': {
      const selected = select(inventory, intent.ids);
      const [unit, partner] = selected;
      rule(selected.length === 2 && unit.card === partner.card && unit.star === partner.star &&
        unit.star < definition(unit).maxStar, '该组合不能升星');
      removeUnits(player, intent.ids);
      addUnit(state, side, unit.card, unit.star + 1);
      return;
    }
    case 'skill': {
      const skill = skillById.get(intent.skill);
      rule(skill, '固有技能无效');
      rule(!purchasedUpgrade(player.skills, skill.id), '已拥有该固有技能的升级版');
      rule(!player.skills.includes(skill.id), '无法重复购买该固有技能');
      rule(!skill.requires || player.skills.includes(skill.requires), '需要先购买基础技能');
      spend(player, skill.costLp);
      player.skills = player.skills.filter(id => id !== skill.upgradeOf);
      player.skills.push(skill.id);
      return;
    }
    case 'alchemy':
    case 'decompose': {
      const effect = intent.type === 'alchemy' ? 'convert_2star_fusion_to_two_1star' : 'decompose_fusion_to_materials';
      const [skill] = activeSkills(player, effect);
      rule(skill, '尚未购买该技能');
      const [unit] = select(inventory, [intent.id]);
      const card = definition(unit);
      rule(intent.type === 'alchemy' ? card.category === 'fusion' && unit.star === 2 : card.recipe, '所选卡牌不能转换');
      spend(player, Number(skill.params.costLp));
      removeUnits(player, [unit.id]);
      const materials = intent.type === 'alchemy' ? [{ id: card.id, count: 2 }] : card.recipe!.materials;
      for (const material of materials) for (let count = 0; count < material.count; count++) addUnit(state, side, material.id);
      return;
    }
    case 'reset':
      rule(!player.resetUsed && activeSkills(player, 'reset_hand_once_per_prep').length, '本阶段无法使用奇遇');
      handOperation(state, player, intent.ids);
      player.hand.push(...player.deck.splice(0, intent.ids.length));
      player.resetUsed = true;
      return;
    case 'change': {
      const skill = skillById.get(intent.skill);
      rule(skill && player.skills.includes(skill.id) && cardBySerial.has(intent.serial), '变号技能或序号无效');
      const [raw] = select(player.hand, [intent.id]);
      switch (skill.effect) {
        case 'transform_greater_than_8_to_any':
          rule(Number(raw.serial) > Number(skill.params.threshold) && intent.serial !== 'a', '王权仅可改变 9 或 10 为数字');
          break;
        case 'swap_serial_pairs':
          rule((skill.params.pairs as string[][]).some(pair => raw.serial !== intent.serial && pair.includes(raw.serial) &&
            pair.includes(intent.serial)), '命运的序号配对无效');
          break;
        case 'add_1_or_2_to_hand_card': {
          const difference = Number(intent.serial) - Number(raw.serial);
          rule(!player.loveUsed && (difference === 1 || difference === 2), '本阶段无法使用爱改变此序号');
          player.loveUsed = true;
          break;
        }
        default: throw new Error('该技能不能变号');
      }
      if (raw.serial !== intent.serial) {
        raw.serial = intent.serial;
        raw.changed = true;
      }
      return;
    }
    default: throw new Error('当前为准备阶段');
  }
}
function startBattle(state: Game, resolution: Resolution): void {
  state.phase = 'battle';
  const difference = speed(state.players[0]) - speed(state.players[1]);
  state.first = difference === 0 ? (random(state) < 0.5 ? 0 : 1) : difference > 0 ? 0 : 1;
  state.active = state.first;
  state.round = 1;
  state.progress = false;
  state.noDamageRounds = 0;
  for (const player of state.players) for (const unit of units(player)) {
    unit.auraHp = unit.bonusHp = 0;
    unit.hp = maxHp(unit);
    unit.acted = false;
    unit.flipped = unit.onceUsed = false;
    unit.defense = unit.stack = 0;
    unit.sweep = undefined;
  }
  updateAuras(state);
  if (finishIfEmpty(state)) return;
  for (const side of [state.first, other(state.first)]) {
    const player = state.players[side];
    for (const unit of units(player)) {
      const opening = abilityOf(unit, 'battle_start_grant_hp');
      if (opening) {
        const target = choose(resolution, { side, label: '唤星选择提高生命上限的友军',
          options: [{ value: 0, label: '放弃' }, ...unitChoices(units(player))] });
        const chosen = units(player).find(ally => ally.id === target);
        if (chosen) {
          const bonus = numberAt(opening.params.hpByStar, unit);
          chosen.bonusHp = (chosen.bonusHp ?? 0) + bonus;
          chosen.hp += bonus;
        }
      }
      if (definition(unit).attack?.mode === 'sequential') {
        const step = choose(resolution, { side, label: '选择螺旋终灭的横扫方向',
          options: [{ value: 1, label: '从左到右' }, { value: -1, label: '从右到左' }] });
        unit.sweep = { step, column: step > 0 ? 0 : constants.fieldSlots - 1 };
      }
    }
  }
  state.log.push({ kind: 'opening', text: '战斗开始', battle: state.battle, round: state.round });
  beginSmallRound(state, state.first);
}
function finishIfEmpty(state: Game): boolean {
  const counts = state.players.map(player => units(player).length);
  if (counts.every(count => count > 0)) return false;
  if (counts.every(count => count === 0) && state.round === 1 && !state.progress) {
    state.round = constants.drawAfterNoDamageRounds;
  }
  finishBattle(state, compare(counts[0], counts[1]));
  return true;
}
function compare(left: number, right: number): Side | null {
  return left === right ? null : left > right ? 0 : 1;
}
function finishBattle(state: Game, winner: Side | null): void {
  for (const side of [0, 1] as const) {
    const player = state.players[side];
    player.field = player.field.map(unit => unit?.temporary ? null : unit);
    for (const unit of [...units(player), ...player.bench]) {
      unit.auraHp = unit.bonusHp = unit.defense = unit.stack = 0;
      unit.acted = unit.flipped = unit.onceUsed = false;
      unit.sweep = undefined;
      unit.hp = Math.min(unit.hp, maxHp(unit));
    }
    player.won = side === winner;
    if (player.won) for (const skill of activeSkills(player, 'lp_on_battle_win')) player.lp += Number(skill.params.lp);
  }
  state.log.push({ kind: 'closing', text: '战斗结束', battle: state.battle, round: state.round });
  if (winner !== null) {
    const loser = state.players[other(winner)];
    const before = loser.hp;
    loser.hp = Math.max(0, loser.hp - (1 + Math.floor((state.battle - 1) / 5)));
    state.log.push({ kind: 'result', text: '玩家生命扣除', battle: state.battle, round: state.round,
      player: other(winner), before, after: loser.hp, amount: before - loser.hp });
  } else {
    state.log.push({ kind: 'result', text: '本场战斗平局', battle: state.battle, round: state.round });
  }
  if (state.players.some(player => player.hp === 0) || state.battle >= constants.battleCap) {
    state.phase = 'finished';
    state.winner = compare(state.players[0].hp, state.players[1].hp);
  } else {
    state.battle++;
    prep(state);
  }
}
function enemySlots(ownSlot: number, targets: string[]): number[] {
  const size = constants.fieldSlots;
  const columns = targets.flatMap(target => {
    if (target === 'any' || target === 'all') return Array.from({ length: size }, (_, index) => index);
    if (target === 'front') return [ownSlot];
    if (target === 'front_left') return [ownSlot - 1];
    if (target === 'front_right') return [ownSlot + 1];
    return [positions.order.indexOf(target)];
  });
  return [...new Set(columns)].filter(column => validSlot(column, size)).sort((a, b) => a - b)
    .map(column => size - 1 - column);
}
export function attackOptions(state: Game, side: Side, unit: Unit, doubleSweep = false): { targets: Unit[]; all: boolean; normal: number; trueDamage: number } {
  const player = state.players[side];
  const enemy = state.players[other(side)];
  const slot = player.field.indexOf(unit);
  const attack = definition(unit).attack;
  if (!attack || slot < 0 || unit.flipped) return { targets: [], all: false, normal: 0, trueDamage: 0 };
  let targets = attack.targets ?? [];
  let all = attack.hitAll === true || attack.mode === 'aoe';
  let damage = attack.damageByStar?.[unit.star - 1] ?? 0;
  if (attack.alternate?.condition.ownPos === positions.order[slot]) {
    targets = attack.alternate.targets;
    damage = attack.alternate.damageByStar[unit.star - 1];
    all = attack.alternate.hitAll;
  }
  // Positional rules name the defender's own slots, which the board displays mirrored.
  const positionalTargets = attack.rules?.find(entry => entry.ownPos === positions.order[slot])?.targets ?? [];
  let slots = attack.mode === 'positional'
    ? positionalTargets.map(target => positions.order.indexOf(target)).filter(index => index >= 0)
    : enemySlots(slot, targets);
  if (attack.mode === 'sequential') {
    const { column, step } = unit.sweep ?? { column: 0, step: 1 };
    const columns = Array.from({ length: constants.fieldSlots }, (_, offset) => wrapSlot(column + offset * step));
    slots = columns.map(column => constants.fieldSlots - 1 - column)
      .filter(index => enemy.field[index]).slice(0, doubleSweep ? 2 : 1);
    if (doubleSweep) all = true;
  }
  if (attack.mode === 'hp_percent') damage = Math.max(constants.minDamage, Math.floor(unit.hp * (attack.percent ?? 0) / 100));
  let available = slots.flatMap(index => enemy.field[index] ? [enemy.field[index]!] : []);
  const taunt = enemy.field[2];
  if (!all && attack.mode !== 'sequential' && taunt && available.includes(taunt) &&
      activeSkills(enemy, 'middle_slot_taunt').length && !abilityOf(unit, 'immune_taunt')) {
    available = [taunt];
  }
  const card = definition(unit);
  const mech = card.abilities.find(ability => ability.effect === 'conditional_damage_bonus' && ability.params.perHighFusion);
  const pure = card.abilities.find(ability => ability.effect === 'conditional_damage_bonus' && ability.params.condition);
  if (mech) for (const ally of units(player)) {
    const allyCard = definition(ally);
    if (allyCard.category === 'highFusion') damage += Number(mech.params.perHighFusion);
    else if (allyCard.race === card.race) damage += Number(allyCard.category === 'fusion' ? mech.params.perMechanicalFusion : mech.params.perMechanicalBase);
  }
  if (attack.true && pure && units(player).every(ally => definition(ally).race === card.race)) damage += Number(pure.params.bonus);
  const sweepEffect = doubleSweep ? abilityOf(unit, 'active_spiral_double_sweep') : undefined;
  if (doubleSweep && !sweepEffect) return { targets: [], all: true, normal: 0, trueDamage: 0 };
  if (sweepEffect) return { targets: available, all, normal: Number(sweepEffect.params.damage), trueDamage: Number(sweepEffect.params.trueDamage) };
  return { targets: available, all,
    normal: attack.true ? 0 : damage, trueDamage: attack.true ? damage : attack.trueDamageByStar?.[unit.star - 1] ?? 0 };
}
export function ordinaryDamage(attack: number, fixed: number, reductions: number[] = []): number {
  const value = reductions.reduce((total, percent) => total * (1 - percent / 100), attack - fixed);
  return Math.max(constants.minDamage, Math.floor(value));
}
const wrapSlot = (value: number) => (value + constants.fieldSlots) % constants.fieldSlots;
const unitChoices = (targets: Unit[]) => targets.map(unit => ({ value: unit.id, label: `${definition(unit).name} ${unit.star}星` }));
function pickTarget(resolution: Resolution, side: Side, label: string, targets: Unit[]): Unit {
  return targets.length === 1 ? targets[0] : targets.find(target => target.id === choose(resolution, {
    side, label, options: unitChoices(targets),
  }))!;
}
function destroy(state: Game, side: Side, target: Unit, resolution: Resolution, source?: Unit): void {
  const defender = state.players[side];
  const slot = defender.field.indexOf(target);
  if (slot < 0) return;
  const attacker = state.players[other(side)];
  const transformation = abilityOf(target, 'death_transform_pile');
  const burst = abilityOf(target, 'death_burst_damage');
  const ordered = ([state.first, other(state.first)] as const)
    .flatMap(owner => units(state.players[owner]).filter(unit => unit !== target && unit.hp > 0).map(unit => ({ owner, unit })));
  removeUnits(defender, [target.id]);
  target.auraHp = 0;
  target.hp = 0;
  if (!target.temporary) defender.bench.push(target);
  state.log.push({ kind: 'destroy', battle: state.battle, round: state.round, unit: target.id, player: side,
    text: `${definition(target).name}${target.temporary ? '被破坏' : '退回升华区'}` });
  if (transformation) {
    const p = transformation.params;
    const body: Unit = { id: allocateUnit(state, side), card: String(p.transformTo), star: Number(p.transformStar),
      hp: 0, acted: target.acted, temporary: true, bonusHp: target.stack ?? 0 };
    body.hp = maxHp(body);
    defender.field[slot] = body;
    state.log.push({ kind: 'summon', battle: state.battle, round: state.round, player: side, unit: body.id,
      text: `${definition(target).name}变为${definition(body).name}`, summoned: { slot, unit: { ...body } } });
  }
  updateAuras(state);
  for (const { owner, unit } of ordered) {
    const stack = abilityOf(unit, 'stack_attack_on_defeat');
    if (stack) unit.stack = (unit.stack ?? 0) + numberAt(stack.params.attackPerDefeatByStar, unit);
    if (owner !== side) {
      const lifesteal = abilityOf(unit, 'on_enemy_destroyed_heal');
      if (lifesteal) heal(state, owner, unit, Number(lifesteal.params.heal), unit);
      const hpStack = abilityOf(unit, 'death_transform_hp_stack');
      if (hpStack) unit.stack = (unit.stack ?? 0) + Number(hpStack.params.hpPerEnemyDestroyed);
    }
  }
  if (source && source !== target) {
    if (source === activeSpirit(attacker)) {
      attacker.lp += Number(abilityOf(source, 'on_kill_gain_lp')!.params.lp);
    }
    if (attacker.field.includes(source) && source.hp > 0) {
      const team = abilityOf(source, 'on_kill_heal_team');
      if (team) for (const ally of units(attacker)) heal(state, other(side), ally, numberAt(team.params.healByStar, source), source);
      const extra = abilityOf(source, 'stack_damage_on_kill');
      if (extra) source.stack = (source.stack ?? 0) + Number(extra.params.damagePerKill);
    }
  }
  if (burst) {
    const p = burst.params;
    const occupied = (targets: string[]) => enemySlots(slot, targets).flatMap(index => attacker.field[index] ? [attacker.field[index]!] : []);
    const front = occupied(['front']);
    const sides = occupied(['front_left', 'front_right']);
    const targets = [...front, ...(sides.length ? [pickTarget(resolution, side, '亡骸选择一个侧格目标', sides)] : [])];
    for (const enemy of targets) applyHit(state, other(side), enemy, target, Number(p.damage), Number(p.trueDamage), resolution, { scale: 1, noBoost: true });
  }
}
type HitMode = { attack?: boolean; doubleSweep?: boolean; reflect?: boolean; noBoost?: boolean; final?: boolean; scale?: number };
function applyHit(state: Game, side: Side, target: Unit, source: Unit, normal: number, trueDamage: number,
  resolution: Resolution, mode: HitMode = {}): { amount: number; killed: boolean } {
  const none = { amount: 0, killed: false };
  const defender = state.players[side];
  if (!defender.field.includes(target) || target.hp <= 0) return none;
  const attacker = state.players[other(side)];
  if (mode.attack && target.flipped) target.flipped = false;
  const protector = mode.attack && !mode.doubleSweep ? protectingFishman(defender.field, target) : undefined;
  if (protector) {
    state.log.push({ kind: 'effect', battle: state.battle, round: state.round, unit: target.id, source: protector.id, player: side,
      text: `鱼人的濒危庇护使${definition(target).name}免疫这次攻击` });
    return none;
  }
  const ignoreDefense = abilityOf(source, 'ignore_defense_except_inherent');
  const king = abilityOf(target, 'king_damage_reduction_aura');
  let fixed = 0;
  const percentages: number[] = [];
  if (!ignoreDefense) {
    if (king) fixed = (king.params.selfReductionByStar as { value: number }[])[target.star - 1].value;
    else {
      fixed = (definition(target).defenseByStar?.[target.star - 1] ?? 0) + (target.defense ?? 0);
      for (const adjacentUnit of adjacent(defender, target)) {
        const aura = abilityOf(adjacentUnit, 'king_damage_reduction_aura');
        const reduction = (aura?.params.adjacentReductionByStar as { type: string; value: number }[] | undefined)?.[adjacentUnit.star - 1];
        if (reduction?.type === 'flat') fixed += reduction.value;
        if (reduction?.type === 'percent') percentages.push(reduction.value);
      }
    }
  }
  const scale = mode.scale ?? 1;
  const boosted = normal > 0 ? Math.max(constants.minDamage, Math.floor((normal +
    (mode.noBoost || mode.final ? 0 : attackBoost(attacker, source))) * scale)) : 0;
  let sanctuary = 0;
  if (!mode.final && !king && defender.field[2] === target) {
    for (const skill of activeSkills(defender, 'middle_slot_defense_bonus')) {
      const tiers = skill.params.thresholds as { damageMin: number; damageMax: number | null; defenseBonus: number }[];
      sanctuary += tiers.find(tier => boosted >= tier.damageMin && (tier.damageMax === null || boosted <= tier.damageMax))?.defenseBonus ?? 0;
    }
  }
  fixed += sanctuary;
  const before = target.hp;
  const ordinary = normal > 0 ? mode.final ? boosted : ordinaryDamage(boosted, fixed, percentages) : 0;
  const real = trueDamage > 0 ? Math.max(constants.minDamage, Math.floor(trueDamage * scale)) : 0;
  const amount = ordinary + real;
  if (amount <= 0) return none;
  const shield = mode.doubleSweep ? undefined : abilityOf(target, 'prevent_destruction_once');
  if (amount >= before && shield && !target.onceUsed && before >= Number(shield.params.minHp) &&
      choose(resolution, { side, label: '占星是否免除这次破坏？',
        options: [{ value: 1, label: '免除' }, { value: 0, label: '放弃' }] })) {
    target.onceUsed = true;
    state.log.push({ kind: 'effect', battle: state.battle, round: state.round, unit: target.id, player: side,
      text: `${definition(target).name}免除了这次破坏` });
    return none;
  }
  target.hp = Math.max(0, target.hp - amount);
  state.progress = true;
  const parts = [
    ordinary && `普通 ${boosted === ordinary ? ordinary : `${boosted}→${ordinary}`}`,
    real && `真伤 ${real}`,
  ].filter(Boolean).join(' + ');
  const reduction = sanctuary ? ` · 圣域抵挡 ${sanctuary}` : '';
  state.log.push({ kind: 'damage', battle: state.battle, round: state.round, unit: target.id, source: source.id, player: side,
    text: `${definition(source).name} → ${definition(target).name} · ${mode.reflect ? '反伤' : parts}${reduction}`,
    amount, before, after: target.hp });
  const reflect = abilityOf(target, 'reflect_true_damage');
  if (reflect && !mode.reflect && attacker.field.includes(source)) {
    applyHit(state, other(side), source, target, 0, Number(reflect.params.damage), resolution, { reflect: true });
  }
  const killed = target.hp === 0;
  if (killed) destroy(state, side, target, resolution, source);
  const recovery = abilityOf(source, 'heal_self');
  if (recovery && attacker.field.includes(source) && source.hp > 0 && source.hp < maxHp(source) && choose(resolution, {
    side: other(side), label: '天使是否回复生命？', options: [{ value: 1, label: '回复' }, { value: 0, label: '放弃' }],
  })) heal(state, other(side), source, numberAt(recovery.params.valueByStar, source), source);
  return { amount, killed };
}
function performAttack(state: Game, side: Side, unit: Unit, targetId: number | undefined,
  resolution: Resolution, scale = 1, doubleSweep = false): void {
  const options = attackOptions(state, side, unit, doubleSweep);
  const targets = options.all ? options.targets : options.targets.filter(target => target.id === targetId);
  rule(targets.length > 0, '攻击目标不合法');
  const player = state.players[side];
  const enemy = state.players[other(side)];
  if (definition(unit).attack?.mode === 'sequential') {
    const last = targets[targets.length - 1];
    const column = constants.fieldSlots - 1 - enemy.field.indexOf(last);
    const step = unit.sweep?.step ?? 1;
    unit.sweep = { column: wrapSlot(column + step), step };
  }
  let killDamage = 0;
  for (const target of targets) {
    const hit = applyHit(state, other(side), target, unit, options.normal, options.trueDamage, resolution,
      { attack: true, scale, final: doubleSweep, doubleSweep });
    if (hit.killed) killDamage = hit.amount;
  }
  if (!player.field.includes(unit) || !unit.hp) return;
  const tower = abilityOf(unit, 'attack_again_on_kill');
  const extraTargets = tower && killDamage ? attackOptions(state, side, unit).targets : [];
  if (extraTargets.length) {
    const target = pickTarget(resolution, side, '倒吊塔选择追加攻击目标', extraTargets);
    const half = Math.max(constants.minDamage, Math.floor(killDamage * Number(tower!.params.percent) / 100));
    applyHit(state, other(side), target, unit, half, 0, resolution, { attack: true, final: true });
  }
  const dawn = abilityOf(unit, 'low_hp_attack_aoe_true');
  if (dawn && unit.hp * 100 < maxHp(unit) * Number(dawn.condition?.selfHpBelowPercent)) {
    for (const target of units(enemy).reverse()) {
      applyHit(state, other(side), target, unit, 0, numberAt(dawn.params.damageByStar, unit), resolution);
    }
  }
}
function useAbility(state: Game, side: Side, unit: Unit, intent: Extract<Intent, { type: 'ability' }>, resolution: Resolution): void {
  const player = state.players[side];
  const enemies = state.players[other(side)];
  const ability = definition(unit).abilities.find(ability => ability.kind === 'active');
  rule(ability && !unit.flipped, '该从者没有主动技');
  const params = ability.params;
  const skillName = ability.effect === 'active_spiral_double_sweep' ? ability.name : '主动技';
  state.log.push({ kind: 'effect', text: `${definition(unit).name}发动${skillName}`, battle: state.battle,
    round: state.round, unit: unit.id, player: side, acted: true });
  const ownSlot = player.field.indexOf(unit);
  const target = units(enemies).find(candidate => candidate.id === intent.target);
  const ally = units(player).find(candidate => candidate.id === intent.target);
  switch (ability.effect) {
    case 'active_spiral_double_sweep':
      performAttack(state, side, unit, undefined, resolution, 1, true);
      break;
    case 'active_self_hp_heal_allies':
      rule(unit.hp > Number(params.selfHpCost), '当前生命不足以发动技能');
      changeHealth(state, side, unit, unit.hp - Number(params.selfHpCost), `${definition(unit).name}支付生命`);
      for (const teammate of units(player)) if (teammate !== unit || params.includeSelf) {
        heal(state, side, teammate, numberAt(params.healByStar, unit), unit);
      }
      break;
    case 'active_damage_or_heal':
      rule(target || ally, '请选择在场目标');
      if (target) applyHit(state, other(side), target, unit, numberAt(params.damageByStar, unit), 0, resolution);
      else if (ally) heal(state, side, ally, numberAt(params.healByStar, unit), unit);
      break;
    case 'active_damage_then_self_destroy':
      rule(target && enemySlots(ownSlot, params.targets as string[]).includes(enemies.field.indexOf(target)), '技能目标不合法');
      applyHit(state, other(side), target, unit, numberAt(params.damageByStar, unit), 0, resolution);
      destroy(state, side, unit, resolution);
      break;
    case 'active_self_hp_cost_aoe':
      rule(unit.hp > Number(params.selfHpCost) && units(enemies).length, '无法支付生命或没有敌方目标');
      changeHealth(state, side, unit, unit.hp - Number(params.selfHpCost), `${definition(unit).name}支付生命`);
      for (const enemy of units(enemies).reverse()) applyHit(state, other(side), enemy, unit, numberAt(params.damageByStar, unit), 0, resolution);
      break;
    case 'active_swap_hp_with_ally': {
      rule(ally && ally !== unit, '请选择另一名友军');
      const prior = unit.hp;
      changeHealth(state, side, unit, Math.min(maxHp(unit), ally.hp), `${definition(unit).name}交换生命`);
      changeHealth(state, side, ally, Math.min(maxHp(ally), prior), `${definition(ally).name}交换生命`);
      break;
    }
    case 'active_grant_extra_attack': {
      rule(ally && ally !== unit, '请选择另一名友军');
      const options = attackOptions(state, side, ally);
      const chosen = options.all ? options.targets[0] : options.targets.find(enemy => enemy.id === intent.ally);
      rule(chosen, '该友军没有合法攻击目标');
      performAttack(state, side, ally, chosen.id, resolution, Number(params.percent) / 100);
      break;
    }
    case 'active_swap_position':
      rule(ally && ally !== unit, '请选择另一名友军');
      swapPositions(state, side, unit, ally);
      break;
    case 'active_true_damage_self_destroy': {
      rule(target, '请选择一名敌人');
      const threshold = params.trueDamageWhenHpBelowPercent as { percent: number; trueDamage: number };
      const damage = unit.hp * 100 <= maxHp(unit) * threshold.percent ? threshold.trueDamage : Number(params.trueDamage);
      applyHit(state, other(side), target, unit, 0, damage, resolution);
      destroy(state, side, unit, resolution);
      break;
    }
    default: throw new Error('该主动技尚未实现');
  }
}
function swapPositions(state: Game, side: Side, first: Unit, second: Unit): void {
  const field = state.players[side].field;
  const left = field.indexOf(first);
  const right = field.indexOf(second);
  [field[left], field[right]] = [field[right], field[left]];
  state.log.push({ kind: 'move', battle: state.battle, round: state.round, player: side, unit: first.id, swap: [left, right],
    text: `${definition(first).name}与${definition(second).name}交换站位` });
  updateAuras(state);
}
function beginSmallRound(state: Game, side: Side): void {
  state.active = side;
  const player = state.players[side];
  for (const unit of units(player)) {
    const holy = abilityOf(unit, 'own_round_heal_adjacent');
    if (holy) for (const target of [unit, ...adjacent(player, unit)]) {
      heal(state, side, target, Number(holy.params.heal), unit);
    }
  }
}
function advanceBattle(state: Game, actedSide: Side): void {
  if (finishIfEmpty(state)) return;
  const opponent = other(actedSide);
  if (units(state.players[opponent]).some(unit => !unit.acted)) {
    beginSmallRound(state, opponent);
    return;
  }
  if (units(state.players[actedSide]).some(unit => !unit.acted)) {
    beginSmallRound(state, actedSide);
    return;
  }
  state.noDamageRounds = state.progress ? 0 : state.noDamageRounds + 1;
  const leader = compare(units(state.players[0]).length, units(state.players[1]).length);
  if (state.noDamageRounds >= constants.drawAfterNoDamageRounds) {
    finishBattle(state, null);
  } else if (state.round >= constants.battleRoundCap && leader !== null) {
    finishBattle(state, leader);
  } else {
    state.log.push({ kind: 'round', text: `第 ${state.round} 战斗轮次结束`, battle: state.battle, round: state.round });
    state.round++;
    state.progress = false;
    for (const player of state.players) for (const unit of units(player)) unit.acted = unit.flipped = false;
    beginSmallRound(state, state.first);
  }
}
function battleAction(state: Game, side: Side, intent: Intent, resolution: Resolution): void {
  rule(side === state.active, '尚未轮到该玩家');
  rule(intent.type === 'attack' || intent.type === 'skip' || intent.type === 'ability' || intent.type === 'arcane', '当前为战斗阶段');
  const [unit] = select(units(state.players[side]), [intent.id]);
  if (intent.type === 'arcane') {
    rule(abilityOf(unit, 'swap_two_allies_once') && !unit.onceUsed, '本场无法再次免费换位');
    const [first, second] = select(units(state.players[side]), [intent.first, intent.second]);
    swapPositions(state, side, first, second);
    unit.onceUsed = true;
    return;
  }
  rule(!unit.acted && !unit.flipped, '该从者已行动');
  unit.acted = true;
  if (intent.type !== 'ability') {
    state.log.push({ kind: 'action', text: `${definition(unit).name}${intent.type === 'attack' ? '发起攻击' : '跳过'}`,
      battle: state.battle, round: state.round, unit: unit.id, player: side, acted: true });
  }
  const options = attackOptions(state, side, unit);
  if (intent.type === 'ability') {
    useAbility(state, side, unit, intent, resolution);
  } else if (intent.type === 'skip') {
    rule(options.targets.length === 0, '存在合法攻击目标，不能跳过');
  } else {
    performAttack(state, side, unit, intent.target, resolution);
  }
  advanceBattle(state, side);
}
export function forecastCombat(game: Game, side: Side, intent: ForecastIntent): CombatForecast {
  rule(game.phase === 'battle' && !game.pending, '当前无法预估攻技');
  const state = structuredClone({ ...game, log: [] as LogEntry[] });
  let decision: string | undefined;
  try {
    battleAction(state, side, intent, { answers: [], cursor: 0 });
  } catch (error) {
    if (!(error instanceof NeedChoice)) throw error;
    decision = error.choice.label;
  }
  return { events: state.log.filter(entry => entry.kind !== 'closing').map(({ kind, text, player, before, after, amount }) =>
    ({ kind, text, player, before, after, amount })), decision };
}
export function applyIntent(previous: Game, side: Side, intent: Intent): Game {
  rule(side === 0 || side === 1, '无效玩家');
  rule(previous.phase !== 'finished', '对局已经结束');
  if (intent.type === 'surrender') {
    const opening = previous.pending?.originalIntent.type === 'ready';
    rule((previous.phase === 'battle' || opening) && previous.battle === intent.battle, '当前无法投降本场战斗');
    const state = { ...structuredClone({ ...previous, pending: undefined, log: [] }), log: [...previous.log] };
    if (opening) {
      returnUnusedCards(state);
      state.round = 1;
    }
    state.log.push({ kind: 'action', text: '投降本场战斗', battle: state.battle, round: state.round, player: side });
    const winner = other(side);
    const spirit = activeSpirit(state.players[winner], opening);
    const remaining = units(state.players[side]).filter(unit => opening || unit.hp > 0).length;
    if (spirit && remaining > 0) {
      state.players[winner].lp += remaining;
      state.log.push({ kind: 'effect', text: `精灵因对手投降获得 ${remaining} LP`,
        battle: state.battle, round: state.round, player: winner, unit: spirit.id });
    }
    finishBattle(state, winner);
    return state;
  }
  const pending = previous.pending;
  let originalSide = side;
  let originalIntent: Intent = intent;
  let answers: number[] = [];
  if (pending) {
    rule(intent.type === 'choose' && side === pending.side, '请先完成当前效果选择');
    rule(pending.options.some(option => option.value === intent.value), '效果选择无效');
    originalSide = pending.originalSide;
    originalIntent = pending.originalIntent;
    answers = [...pending.answers, intent.value];
  } else rule(intent.type !== 'choose', '当前没有待结算的选择');
  const state = { ...structuredClone({ ...previous, pending: undefined, log: [] }), log: [...previous.log] };
  const resolution = { answers, cursor: 0 };
  try {
    if (state.phase === 'prep') prepareAction(state, originalSide, originalIntent, resolution);
    else battleAction(state, originalSide, originalIntent, resolution);
    return state;
  } catch (error) {
    if (!(error instanceof NeedChoice)) throw error;
    return { ...previous, pending: { ...error.choice, originalSide, originalIntent, answers } };
  }
}
export function replay(seed: number, actions: readonly { side: Side; intent: Intent }[]): Game {
  return actions.reduce((state, action) => applyIntent(state, action.side, action.intent), createGame({ seed }));
}


validateCards(new Set([
  'heal_self', 'adjacent_allies_hp_max', 'adjacent_allies_attack', 'active_self_hp_heal_allies',
  'active_damage_or_heal', 'mid_position_bonus_damage', 'protect_non_fishman_allies_low_hp',
  'active_damage_then_self_destroy', 'ignore_defense_except_inherent', 'on_kill_gain_lp',
  'active_self_hp_cost_aoe', 'low_hp_attack_aoe_true', 'king_damage_reduction_aura', 'on_kill_heal_team',
  'stack_attack_on_defeat', 'on_enemy_destroyed_heal', 'own_round_heal_adjacent',
  'reflect_true_damage', 'stack_damage_on_kill', 'active_swap_hp_with_ally', 'cannot_heal_self',
  'active_grant_extra_attack', 'attack_again_on_kill', 'immune_taunt', 'prevent_destruction_once',
  'conditional_damage_bonus', 'active_spiral_double_sweep', 'battle_start_grant_hp', 'active_swap_position', 'swap_two_allies_once',
  'death_transform_hp_stack', 'death_transform_pile', 'death_burst_damage', 'active_true_damage_self_destroy',
  'sum_seven_to_lp', 'transform_greater_than_8_to_any', 'swap_serial_pairs', 'add_1_or_2_to_hand_card',
  'lp_on_battle_win', 'middle_slot_defense_bonus', 'middle_slot_taunt',
  'draw_bonus', 'win_draw_bonus_next_prep', 'reset_hand_once_per_prep', 'lp_income_per_5_lp',
  'convert_2star_fusion_to_two_1star', 'decompose_fusion_to_materials',
]));
