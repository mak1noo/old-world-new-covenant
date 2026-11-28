import { describe, expect, test } from 'vitest';
import { cardBySerial, cards, constants } from './cards';
import { addUnit, applyIntent, attackOptions, canSublimate, createGame, forecastCombat, ordinaryDamage, replay, units,
  type Game, type Intent, type Side } from './game';
import { fusionOptions } from './legal';

const base = (serial: string) => cardBySerial.get(serial)!.id;
const accepts = (serials: string[], result: string) =>
  canSublimate(serials.map((serial, id) => ({ id, serial, printed: serial })), result);
const fusion = (name: string) => cards.find(card => card.name === name)!.id;
const apply = (game: Game, side: Side, ...intents: Intent[]) => intents.reduce((state, intent) => applyIntent(state, side, intent), game);
const ready = (game: Game) => apply(apply(game, 0, { type: 'ready' }), 1, { type: 'ready' });
const deckCount = (game: Game, side: Side) => {
  const player = game.players[side];
  return new Set([...player.deck, ...player.hand, ...player.shop.flatMap(card => card ? [card] : [])].map(card => card.id)).size;
};
function place(game: Game, side: Side, card: string, slot: number): Game {
  const unit = addUnit(game, side, card);
  return apply(game, side, { type: 'place', id: unit.id, slot });
}

test('双方默认 30 HP，自定义初始生命后保留上限并正常结算', () => {
  expect(createGame().playerHpLimit).toBe(30);
  expect(createGame().players.map(player => player.hp)).toEqual([30, 30]);
  let game = createGame({ playerHp: 3 });
  game = ready(place(place(game, 0, base('1'), 2), 1, base('1'), 2));
  game = apply(game, 0, { type: 'surrender', battle: 1 });
  expect(game).toMatchObject({ playerHpLimit: 3, phase: 'prep', battle: 2 });
  expect(game.players.map(player => player.hp)).toEqual([2, 3]);
  expect(() => createGame({ playerHp: 0 })).toThrow('初始生命必须为正整数');
});

describe('准备与经济', () => {
  test('牌库守恒，购买和刷新合法，失败操作不改变输入', () => {
    let game = createGame();
    expect(deckCount(game, 0)).toBe(36);
    expect(game.players[0].hand).toHaveLength(7);
    expect(game.players[0].shop).toHaveLength(5);
    expect(() => apply(game, 0, { type: 'buy', slot: 0 })).toThrow('lp 不足');
    game.players[0].lp = 4;
    game = apply(game, 0, { type: 'buy', slot: 0 }, { type: 'refresh' });
    expect(game.players[0].lp).toBe(0);
    expect(game.players[0].bench).toHaveLength(1);
    expect(deckCount(game, 0)).toBe(36);
    const before = structuredClone(game);
    game = apply(game, 0, { type: 'ready' });
    expect(() => apply(game, 0, { type: 'refresh' })).toThrow('已准备完成');
    expect(game.players[0].deck).toEqual(before.players[0].deck);
    expect(apply(game, 0, { type: 'unready' })).toEqual(before);
    expect(game.players[1].hand).toHaveLength(7);
  });
  test('连号、万能 a、补牌及凑 十', () => {
    expect(accepts(['9','10','0'], '10')).toBe(false);
    expect(accepts(['8','a','10'], '9')).toBe(false);
    expect(accepts(['8','a','10'], '8')).toBe(true);
    expect(accepts(['a','a','a'], 'a')).toBe(true);
    expect(accepts(['a','9'], '9')).toBe(false);
    let game = createGame();
    const [first, second] = game.players[0].hand;
    first.serial = 'a';
    second.printed = second.serial = '4';
    game = apply(game, 0, { type: 'sum', ids: [first.id], total: 10 });
    expect(game.players[0].lp).toBe(1);
    expect(deckCount(game, 0)).toBe(36);
    expect(() => apply(game, 0, { type: 'sublimate', ids: [second.id], serial: '4' })).toThrow('lp 不足');
    game.players[0].lp = 2;
    game = apply(game, 0, { type: 'sublimate', ids: [second.id], serial: '4' });
    expect(game.players[0].bench[0].card).toBe(base('4'));
  });
  test('a 补号只用于成组，产物取原有数字，三个 a 仍能产出精灵', () => {
    const results = (serials: string[]) => ['1', '2', '3', '4', '5', 'a'].filter(result => accepts(serials, result));
    expect(results(['3', '5', 'a'])).toEqual(['3', '5']);
    expect(results(['2', '3', 'a'])).toEqual(['2', '3']);
    expect(results(['3', '3', 'a'])).toEqual(['3']);
    expect(results(['3', 'a', 'a'])).toEqual(['3']);
    expect(results(['a', 'a', 'a'])).toEqual(['a']);
    expect(results(['1', '5', 'a'])).toEqual([]);
    const game = createGame();
    const hand = game.players[0].hand.slice(0, 3);
    hand.forEach((card, index) => { card.printed = card.serial = ['3', '5', 'a'][index]; });
    const ids = hand.map(card => card.id);
    expect(() => apply(game, 0, { type: 'sublimate', ids, serial: '4' })).toThrow();
    expect(apply(game, 0, { type: 'sublimate', ids, serial: '5' }).players[0].bench[0].card).toBe(base('5'));
  });
  test('场上素材参与融合，同名融合唯一，升星后可以出售', () => {
    let game = createGame();
    game.players[0].lp = 4;
    game = place(game, 0, base('0'), 0);
    const ids = [units(game.players[0])[0].id, addUnit(game, 0, base('4')).id, addUnit(game, 0, base('4')).id];
    const golem = fusion('天底魔像');
    game = apply(game, 0, { type: 'fuse', card: golem, ids });
    expect(units(game.players[0])).toHaveLength(0);
    const [product] = game.players[0].bench;
    game = apply(game, 0, { type: 'place', id: product.id, slot: 0 });
    const duplicate = addUnit(game, 0, golem);
    expect(() => apply(game, 0, { type: 'place', id: duplicate.id, slot: 1 })).toThrow('同名');
    game = apply(game, 0, { type: 'star', ids: [product.id, duplicate.id] });
    expect(game.players[0].bench[0].star).toBe(2);
    game = apply(game, 0, { type: 'sell', id: game.players[0].bench[0].id });
    expect(game.players[0].lp).toBe(6);
  });
  test('可合成筛选检查数量和 lp，融合与高阶配方都在目录里', () => {
    const game = createGame();
    const materials = [addUnit(game, 0, base('0')), addUnit(game, 0, base('4'))];
    const golem = fusion('天底魔像');
    expect(fusionOptions(materials, 4).find(option => option.card.id === golem)?.craftable).toBe(false);
    materials.push(addUnit(game, 0, base('4')));
    expect(fusionOptions(materials, 3).find(option => option.card.id === golem)?.craftable).toBe(false);
    expect(fusionOptions(materials, 4).find(option => option.card.id === golem)?.craftable).toBe(true);
    const higher = cards.find(card => card.category === 'highFusion')!;
    const higherMaterials = higher.recipe!.materials.flatMap(material =>
      Array.from({ length: material.count }, () => addUnit(game, 0, material.id)));
    expect(fusionOptions(higherMaterials, higher.recipe!.lpCost).find(option => option.card.id === higher.id)?.craftable).toBe(true);
  });
});
describe('战斗轮次与终局', () => {
  test('攻技预估复用战斗结算，显示伤害及治疗且不消耗行动', () => {
    const game = ready(place(place(place(createGame(), 0, base('5'), 1), 0, base('1'), 2), 1, base('3'), 2));
    const doctor = game.players[0].field[1]!;
    const bird = game.players[0].field[2]!;
    const banner = game.players[1].field[2]!;
    bird.hp = 2;
    const before = structuredClone(game);
    expect(forecastCombat(game, 0, { type: 'attack', id: bird.id, target: banner.id }).events)
      .toContainEqual(expect.objectContaining({ kind: 'damage', amount: 6, before: 5, after: 0 }));
    expect(forecastCombat(game, 0, { type: 'ability', id: doctor.id, target: banner.id }).events)
      .toContainEqual(expect.objectContaining({ kind: 'damage', amount: 1, before: 5, after: 4 }));
    expect(forecastCombat(game, 0, { type: 'ability', id: doctor.id, target: bird.id }).events)
      .toContainEqual(expect.objectContaining({ kind: 'heal', amount: 1, before: 2, after: 3 }));
    expect(game).toEqual(before);
    expect(() => forecastCombat(game, 1, { type: 'attack', id: banner.id, target: bird.id })).toThrow('尚未轮到');
  });
  test('总行动点先手，镜像攻击，击破后返回升华区', () => {
    let game = createGame();
    game = place(game, 0, base('1'), 0);
    game = place(game, 1, base('9'), 4);
    game = ready(game);
    expect(game.first).toBe(0);
    const [bird] = units(game.players[0]);
    const [corpse] = units(game.players[1]);
    expect(attackOptions(game, 0, bird).targets).toEqual([corpse]);
    expect(() => apply(game, 0, { type: 'skip', id: bird.id })).toThrow('不能跳过');
    game = apply(game, 0, { type: 'attack', id: bird.id, target: corpse.id });
    expect(game.players[1].hp).toBe(constants.playerHp - 1);
    expect(game.players[1].bench[0].id).toBe(corpse.id);
    expect(game.battle).toBe(2);
    expect(game.log.slice(-2).map(entry => entry.kind)).toEqual(['closing', 'result']);
    expect(game.log.at(-1)).toMatchObject({ player: 1, amount: 1, before: constants.playerHp, after: constants.playerHp - 1 });
  });
  test('一对四仍交替攻击，单从者在每次轮到时都有行动资格', () => {
    let game = place(createGame(), 0, fusion('国王'), 2);
    for (const slot of [0, 1, 2, 4]) game = place(game, 1, base('6'), slot);
    game = ready(game);
    game.players[0].field[2]!.hp = game.players[1].field[2]!.hp = 40;
    const soloId = game.players[0].field[2]!.id;
    const enemies = units(game.players[1]);
    for (let index = 0; index < enemies.length; index++) {
      expect(game.active).toBe(1);
      const attacker = enemies[index];
      game = apply(game, 1, { type: 'attack', id: attacker.id, target: soloId });
      expect(game.active).toBe(0);
      expect(game.players[0].field[2]?.acted).toBe(false);
      game = apply(game, 0, { type: 'attack', id: soloId, target: enemies[2].id });
      expect(game.active).toBe(1);
      expect(game.attackRounds).toEqual([index + 2, index === 3 ? 2 : 1]);
      if (index < 3) {
        expect(units(game.players[1]).filter(unit => unit.acted).map(unit => unit.id))
          .toEqual(enemies.slice(0, index + 1).map(unit => unit.id));
      }
    }
    expect(game.round).toBe(2);
    expect(units(game.players[1]).every(unit => !unit.acted)).toBe(true);
  });
  test('未行动的从者退场后，已行动的唯一幸存者立即刷新', () => {
    let game = place(place(place(createGame(), 0, base('1'), 2), 1, base('4'), 2), 1, base('4'), 4);
    game = ready(game);
    expect(game.active).toBe(1);
    const reserve = game.players[1].field[4]!;
    game = apply(game, 1, { type: 'skip', id: reserve.id });
    expect(game.players[1].field[4]?.acted).toBe(true);
    const bird = game.players[0].field[2]!;
    game = apply(game, 0, { type: 'attack', id: bird.id, target: game.players[1].field[2]!.id });
    expect(game.active).toBe(1);
    expect(game.attackRounds).toEqual([2, 2]);
    expect(game.players[1].field[4]?.acted).toBe(false);
    expect(() => apply(game, 1, { type: 'skip', id: reserve.id })).not.toThrow();
  });
  test('连续五个完整轮次未伤害才提前平局，50 场空场平局后终局', () => {
    let game = createGame();
    game = place(game, 0, base('1'), 0);
    game = place(game, 1, base('1'), 0);
    game = ready(game);
    for (let i = 0; i < 10; i++) {
      expect(game.round).toBe(1 + Math.floor(i / 2));
      const side = game.active;
      game = apply(game, side, { type: 'skip', id: units(game.players[side])[0].id });
    }
    expect(game.battle).toBe(2);
    expect(game.log.at(-1)).toMatchObject({ text: '本场战斗平局', round: 5 });
    expect(game.players.map(player => player.hp)).toEqual([constants.playerHp, constants.playerHp]);
    const actions = Array.from({ length: 50 }, () => [{ side: 0 as const, intent: { type: 'ready' } as const },
      { side: 1 as const, intent: { type: 'ready' } as const }]).flat();
    expect(replay(42, actions)).toEqual(replay(42, actions));
    expect(replay(42, actions).phase).toBe('finished');
  });
  test('战斗区换位只改变在场位置，投降只结算指定场次', () => {
    let game = place(place(place(createGame(), 0, base('1'), 0), 0, base('2'), 2), 1, base('8'), 3);
    const [first, second] = units(game.players[0]);
    const reserve = addUnit(game, 0, base('3'));
    expect(() => apply(game, 0, { type: 'place', id: reserve.id, slot: 2 })).toThrow('只有战斗区');
    game = apply(game, 0, { type: 'place', id: first.id, slot: 2 });
    expect(units(game.players[0]).map(unit => unit.id)).toEqual([second.id, first.id]);
    expect(game.log).toEqual([]);
    game = ready(game);
    expect(() => apply(game, 0, { type: 'unready' })).toThrow();
    const loser = game.active === 0 ? 1 : 0;
    expect(() => apply(game, loser, { type: 'surrender', battle: 2 })).toThrow();
    game = apply(game, loser, { type: 'surrender', battle: 1 });
    expect(game).toMatchObject({ phase: 'prep', battle: 2 });
    expect(game.players[loser].hp).toBe(constants.playerHp - 1);
    expect(deckCount(game, loser)).toBe(36);
  });
  test('实际伤害重置无伤害计数，第 50 轮双方人数相同继续战斗', () => {
    let game = ready(place(place(createGame(), 0, base('2'), 2), 1, base('8'), 2));
    game.players[1].field[2]!.hp = 8;
    game.round = 50;
    game.attackRounds = [50, 50];
    game.noDamageRounds = 4;
    for (let i = 0; i < 2; i++) {
      const side = game.active;
      game = apply(game, side, { type: 'attack', id: game.players[side].field[2]!.id, target: game.players[1 - side].field[2]!.id });
    }
    expect(game).toMatchObject({ phase: 'battle', round: 51, noDamageRounds: 0 });
  });
  test('单场第 50 轮以存活数量决胜', () => {
    let game = createGame();
    game = place(game, 0, base('8'), 2);
    game = place(game, 1, base('8'), 2);
    game = place(game, 1, base('4'), 4);
    game = ready(game);
    game.round = 50;
    game.attackRounds = [50, 50];
    while (game.phase === 'battle') {
      const side = game.active;
      const unit = units(game.players[side]).find(unit => !unit.acted)!;
      const options = attackOptions(game, side, unit);
      game = apply(game, side, options.targets[0] ? { type: 'attack', id: unit.id, target: options.targets[0].id } : { type: 'skip', id: unit.id });
    }
    expect(game.players[0].hp).toBe(constants.playerHp - 1);
    expect(game.players[1].hp).toBe(constants.playerHp);
  });
  test('减伤按固定后百分比并向下取整', () => {
    expect(ordinaryDamage(13, 4, [50])).toBe(4);
    expect(ordinaryDamage(4, 20, [50])).toBe(1);
  });
});

test('随机合法操作可以从开局打到终局并复现', () => {
  const seed = 1024;
  let game = createGame({ seed });
  let roll = 17;
  let attacks = 0;
  const actions: { side: Side; intent: Intent }[] = [];
  const choose = <T,>(options: T[]): T => options[(roll = (Math.imul(roll, 1664525) + 1013904223) >>> 0) % options.length];
  while (game.phase !== 'finished' && actions.length < 5000) {
    let side: Side;
    let intent: Intent;
    if (game.pending) {
      side = game.pending.side;
      intent = { type: 'choose', value: choose(game.pending.options).value };
    } else if (game.phase === 'prep') {
      side = game.players[0].ready ? 1 : 0;
      const player = game.players[side];
      const available: Intent[] = [{ type: 'ready' }];
      for (const raw of player.hand) {
        if (raw.serial === 'a' || raw.serial === '10') available.push({ type: 'sum', ids: [raw.id], total: 10 });
        const same = player.hand.filter(card => card.serial === raw.serial).slice(0, 3);
        if (player.lp >= 3 - same.length) {
          available.push({ type: 'sublimate', ids: same.map(card => card.id), serial: raw.serial });
        }
      }
      for (const [slot, card] of player.shop.entries()) if (card && player.lp >= 3) available.push({ type: 'buy', slot });
      for (const unit of player.bench) for (const [slot, occupant] of player.field.entries()) {
        if (!occupant) available.push({ type: 'place', id: unit.id, slot });
      }
      intent = choose(available);
    } else {
      side = game.active;
      const unit = choose(units(game.players[side]).filter(unit => !unit.acted));
      const options = attackOptions(game, side, unit);
      if (options.targets.length) {
        attacks++;
        intent = { type: 'attack', id: unit.id, target: choose(options.targets).id };
      } else {
        intent = { type: 'skip', id: unit.id };
      }
    }
    actions.push({ side, intent });
    game = applyIntent(game, side, intent);
    for (const playerSide of [0, 1] as const) {
      expect(deckCount(game, playerSide)).toBe(36);
      expect(game.players[playerSide].lp).toBeGreaterThanOrEqual(0);
    }
  }
  expect(attacks).toBeGreaterThan(0);
  expect(game.phase).toBe('finished');
  expect(replay(seed, actions)).toEqual(game);
});
