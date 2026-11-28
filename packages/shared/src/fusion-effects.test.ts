import { expect, test } from 'vitest';
import { cardBySerial, cards } from './cards';
import { addUnit, applyIntent, attackOptions, createGame, maxHp, type Game, type Side, type Unit } from './game';

function put(game: Game, side: Side, slot: number, name: string, star = 1): Unit {
  const card = cardBySerial.get(name) ?? cards.find(card => card.name === name)!;
  const unit = addUnit(game, side, card.id, star);
  game.players[side].bench.pop();
  game.players[side].field[slot] = unit;
  return unit;
}
function stage(): Game {
  const game = createGame();
  game.phase = 'battle';
  game.round = 1;
  game.attackRounds = [1, 1];
  return game;
}
const attack = (game: Game, from: Unit, to?: Unit, side: Side = 0) =>
  applyIntent(game, side, { type: 'attack', id: from.id, target: to?.id });
const skill = (game: Game, from: Unit, target?: Unit, ally?: Unit) =>
  applyIntent(game, 0, { type: 'ability', id: from.id, target: target?.id, ally: ally?.id });
const ready = (game: Game) => applyIntent(applyIntent(game, 0, { type: 'ready' }), 1, { type: 'ready' });

test('天底魔像先扣自身生命，再普通群伤，血不足不能发动', () => {
  const game = stage();
  const golem = put(game, 0, 2, '天底魔像');
  put(game, 1, 2, '6');
  put(game, 1, 3, '6');
  const result = skill(game, golem);
  expect(result.players[0].field[2]?.hp).toBe(13);
  expect(result.players[1].field.slice(2, 4).map(unit => unit?.hp)).toEqual([1, 1]);
  golem.hp = 2;
  expect(() => skill(game, golem)).toThrow();
});
test('启明鸟严格低于半血触发群体真伤', () => {
  const game = stage();
  const dawn = put(game, 0, 2, '启明鸟', 2);
  const target = put(game, 1, 2, '圣龙');
  put(game, 1, 4, '圣龙');
  dawn.hp = 12;
  expect(attack(game, dawn, target).players[1].field[4]?.hp).toBe(35);
  dawn.hp = 11;
  expect(attack(game, dawn, target).log.find(entry => entry.kind === 'damage' && entry.unit === game.players[1].field[4]?.id)?.amount).toBe(9);
});
test('国王二星邻居减半，自身只减五，离场使邻居恢复', () => {
  const game = stage();
  const bird = put(game, 0, 1, '1', 3);
  const ally = put(game, 1, 3, '6', 3);
  const king = put(game, 1, 2, '国王', 2);
  king.defense = 10;
  expect(attack(game, bird, ally).players[1].field[3]?.hp).toBe(6);
  game.players[0].field[1] = null;
  game.players[0].field[2] = bird;
  expect(attack(game, bird, king).players[1].field[2]?.hp).toBe(13);
  game.players[1].field[2] = null;
  game.players[0].field[2] = null;
  game.players[0].field[1] = bird;
  expect(attack(game, bird, ally).players[1].field[3]).toBeNull();
});
test('飞龙击杀为自身和队友各回血一次', () => {
  const game = stage();
  const dragon = put(game, 0, 2, '飞龙');
  const ally = put(game, 0, 3, '6', 3);
  const target = put(game, 1, 3, '1');
  dragon.hp = ally.hp = 2;
  expect(attack(game, dragon, target).players[0].field.slice(2, 4).map(unit => unit?.hp)).toEqual([3, 3]);
  target.hp = 9;
  expect(attack(game, dragon, target).players[0].field[2]?.hp).toBe(2);
  dragon.star = 2;
  expect(attack(game, dragon, target).players[0].field.slice(2, 4).map(unit => unit?.hp)).toEqual([5, 5]);
});
test('二星堆尸收到击杀事件增加攻击并回复', () => {
  const game = stage();
  const pile = put(game, 0, 0, '堆尸', 2);
  const bird = put(game, 0, 2, '1');
  const food = put(game, 1, 2, '1');
  put(game, 1, 4, '4');
  pile.hp = 4;
  const next = attack(game, bird, food);
  expect(next.players[0].field[0]).toMatchObject({ stack: 3, hp: 6 });
});
test('圣龙在己方小轮开始时只回复自身和紧邻', () => {
  const game = stage();
  game.active = 1;
  const holy = put(game, 0, 2, '圣龙');
  const near = put(game, 0, 3, '6');
  const far = put(game, 0, 4, '6');
  const enemy = put(game, 1, 4, '4');
  holy.hp = near.hp = far.hp = 1;
  const result = applyIntent(game, 1, { type: 'skip', id: enemy.id });
  expect(result.players[0].field.slice(2).map(unit => unit?.hp)).toEqual([3, 3, 1]);
});
test('腐化龙混伤只被反一次，致死也反，两边攻击获击杀后仅幸存者得层', () => {
  const game = stage();
  const first = put(game, 0, 2, '腐化龙');
  const second = put(game, 1, 2, '腐化龙');
  put(game, 1, 4, '4');
  const result = attack(game, first, second);
  expect(result.players[0].field[2]?.hp).toBe(26);
  expect(result.players[1].field[2]?.hp).toBe(15);
  second.hp = 1;
  expect(attack(game, first, second).players[0].field[2]).toMatchObject({ hp: 26, stack: 2 });
});
test('虫母换血可以回复自身，其他治愈无效', () => {
  const game = stage();
  const queen = put(game, 0, 2, '虫母');
  const ally = put(game, 0, 3, '圣龙');
  const doctor = put(game, 0, 4, '5');
  put(game, 1, 2, '6');
  queen.hp = 1;
  const result = skill(game, queen, ally);
  expect(result.players[0].field[2]?.hp).toBe(15);
  expect(result.players[0].field[3]?.hp).toBe(1);
  expect(skill(game, doctor, queen).players[0].field[2]?.hp).toBe(1);
});
test('主教棋追加攻击不消耗受益者行动，并在防御之前折半', () => {
  const game = stage();
  const bishop = put(game, 0, 2, '主教棋');
  const bird = put(game, 0, 1, '1', 3);
  const enemy = put(game, 1, 3, '螺旋终灭');
  const result = skill(game, bishop, bird, enemy);
  expect(result.players[0].field[1]?.acted).toBe(false);
  expect(result.players[1].field[3]?.hp).toBe(29);
  expect(() => skill(game, bishop, bishop, enemy)).toThrow();
});
test('倒吊塔二次攻击不再减防也不连锁', () => {
  const game = stage();
  const tower = put(game, 0, 2, '倒吊塔');
  const target = put(game, 1, 2, '1');
  const second = put(game, 1, 3, '螺旋终灭');
  put(game, 1, 1, '6');
  second.hp = 7;
  const pending = attack(game, tower, target);
  const result = applyIntent(pending, 0, { type: 'choose', value: second.id });
  expect(result.players[1].field[3]).toBeNull();
  expect(result.players[1].field[1]?.hp).toBe(5);
});
test('占星无视嘲讽，二星可免一次受击前血量达标的致死伤害', () => {
  const game = stage();
  const bird = put(game, 0, 2, '骸骨龙');
  const reserve = put(game, 0, 0, '4');
  const target = put(game, 1, 2, '占星魔术师', 2);
  put(game, 1, 1, '6');
  game.players[0].skills.push('skill_reverse_flag');
  expect(attackOptions(game, 1, target).targets).toEqual([bird, reserve]);
  const pending = skill(game, bird, target);
  expect(pending.pending?.side).toBe(1);
  const result = applyIntent(pending, 1, { type: 'choose', value: 1 });
  expect(result.players[1].field[2]).toMatchObject({ hp: 20, onceUsed: true });
  target.hp = 6;
  expect(skill(game, bird, target).pending).toBeUndefined();
});
test('螺旋终灭开战选向并直接绕过空格，纯机械追加普通伤害', () => {
  const game = createGame();
  const spiral = put(game, 0, 2, '螺旋终灭');
  put(game, 1, 3, '圣龙');
  put(game, 1, 1, '圣龙');
  const pending = ready(game);
  const battle = applyIntent(pending, 0, { type: 'choose', value: -1 });
  const unit = battle.players[0].field[2]!;
  expect(attackOptions(battle, 0, unit).targets[0]).toBe(battle.players[1].field[1]);
  battle.active = 0;
  const result = attack(battle, spiral, battle.players[1].field[1]!);
  expect(result.log.find(entry => entry.kind === 'damage')?.amount).toBe(20);
  expect(attackOptions(result, 0, result.players[0].field[2]!).targets[0]).toBe(result.players[1].field[3]);
});
test('螺旋终灭双格各为 2 普通和 8 真伤，下次从第二目标的下一格开始', () => {
  for (const step of [1, -1]) {
    const game = stage();
    const spiral = put(game, 0, 2, '螺旋终灭');
    spiral.sweep = { column: step === 1 ? 0 : 4, step };
    const first = put(game, 1, step === 1 ? 4 : 0, '圣龙');
    const second = put(game, 1, step === 1 ? 3 : 1, '螺旋终灭');
    const third = put(game, 1, 2, '国王', 2);
    game.players[1].skills.push('skill_sanctuary', 'skill_reverse_flag');
    const result = skill(game, spiral);
    expect(result.log.filter(entry => entry.kind === 'damage').map(entry => [entry.unit, entry.amount]))
      .toEqual([[first.id, 10], [second.id, 10]]);
    const nextSpiral = result.players[0].field[2]!;
    expect(nextSpiral.sweep).toEqual({ column: 2, step });
    expect(attackOptions(result, 0, nextSpiral).targets.map(unit => unit.id)).toEqual([third.id]);
    expect(nextSpiral.acted).toBe(false);
    expect(result.attackRounds).toEqual([2, 1]);
  }
});
test('螺旋双格跳空，不重复命中，并绕过鱼人庇护和圣域', () => {
  const game = stage();
  const spiral = put(game, 0, 2, '螺旋终灭');
  const middle = put(game, 1, 2, '圣龙');
  const fish = put(game, 1, 0, '8');
  middle.hp = 1;
  fish.hp = 1;
  game.players[1].skills.push('skill_sanctuary');
  const hit = skill(game, spiral);
  expect(hit.log.filter(entry => entry.kind === 'damage').map(entry => [entry.unit, entry.amount]))
    .toEqual([[middle.id, 10], [fish.id, 10]]);
  game.players[1].field[0] = null;
  expect(skill(game, spiral).log.filter(entry => entry.kind === 'damage').map(entry => entry.unit)).toEqual([middle.id]);
});
test('圣龙第十轮打堆尸仍为 15，受中位圣域时显示由 15 抵挡至 10', () => {
  const game = stage();
  game.round = 10;
  game.attackRounds = [10, 10];
  const holy = put(game, 0, 2, '圣龙');
  const pile = put(game, 1, 2, '堆尸', 2);
  expect(attack(game, holy, pile).log.find(entry => entry.kind === 'damage')).toMatchObject({ amount: 15 });
  game.players[1].skills.push('skill_sanctuary');
  const damage = attack(game, holy, pile).log.find(entry => entry.kind === 'damage');
  expect(damage).toMatchObject({ amount: 10, before: 18, after: 8, text: expect.stringContaining('普通 15→10 · 圣域抵挡 5') });
});
test('圣域按入射普通伤害的 5、10、11 边界判档，混伤的真伤不计入', () => {
  for (const [name, star, expected] of [['士兵棋', 2, 2], ['死尸', 3, 2], ['螺旋终灭', 1, 15]] as const) {
    const game = stage();
    const source = put(game, 0, 2, name, star);
    put(game, 0, 0, '4');
    const wall = put(game, 1, 2, '圣龙');
    game.players[1].skills.push('skill_sanctuary');
    expect(attack(game, source, wall).log.find(entry => entry.kind === 'damage')).toMatchObject({ amount: expected });
  }
  const game = stage();
  const astrologer = put(game, 0, 2, '占星魔术师');
  const wall = put(game, 1, 2, '圣龙');
  game.players[1].skills.push('skill_sanctuary');
  expect(attack(game, astrologer, wall).log.find(entry => entry.kind === 'damage')).toMatchObject({ amount: 5 });
});
test('智械龙计自身、机械融合与任意高融，自身攻击为单选', () => {
  const game = stage();
  const mech = put(game, 0, 2, '智械龙');
  put(game, 0, 1, '倒吊塔');
  const enemy = put(game, 1, 2, '圣龙');
  put(game, 1, 3, '圣龙');
  expect(attackOptions(game, 0, mech)).toMatchObject({ trueDamage: 24, all: false });
  put(game, 0, 3, '圣龙');
  expect(attackOptions(game, 0, mech).trueDamage).toBe(28);
  expect(attack(game, mech, enemy).players[1].field[3]?.hp).toBe(35);
});
test('唤星增加当前和最大生命，施法者退场后保留到本场结束', () => {
  const game = createGame();
  const caller = put(game, 0, 2, '唤星魔术师', 2);
  const ally = put(game, 0, 4, '2');
  const enemy = put(game, 1, 2, '骸骨龙');
  put(game, 1, 4, '4');
  const pending = ready(game);
  let next = applyIntent(pending, 0, { type: 'choose', value: ally.id });
  expect(next.players[0].field[4]).toMatchObject({ hp: 9, bonusHp: 4, defense: 0, acted: false });
  next.active = 1;
  next = applyIntent(next, 1, { type: 'ability', id: enemy.id, target: caller.id });
  expect(next.players[0].field[2]).toBeNull();
  expect(maxHp(next.players[0].field[4]!)).toBe(9);
  next = applyIntent(next, 1, { type: 'surrender', battle: 1 });
  expect(maxHp(next.players[0].field[4]!)).toBe(5);
  expect(applyIntent(pending, 0, { type: 'choose', value: 0 }).players[0].field[4]?.hp).toBe(5);
});
test('奥术二星免费换人每场一次，普通技能交换自身', () => {
  const game = stage();
  const mage = put(game, 0, 2, '奥术魔术师', 2);
  const ally = put(game, 0, 3, '1');
  put(game, 1, 2, '1');
  const action = { type: 'arcane', id: mage.id, first: mage.id, second: ally.id } as const;
  const changed = applyIntent(game, 0, action);
  expect(changed.players[0].field[3]).toMatchObject({ id: mage.id, acted: false });
  expect(() => applyIntent(changed, 0, action)).toThrow();
  expect(skill(game, mage, ally).players[0].field[3]).toMatchObject({ id: mage.id, acted: true });
});
test('朽亡龙同格临时变身并保留本轮行动标记和半整数血量', () => {
  const game = stage();
  const dragon = put(game, 1, 2, '朽亡龙');
  const otherPile = put(game, 1, 0, '堆尸');
  const hero = put(game, 0, 2, '骸骨龙');
  put(game, 0, 1, '圣龙');
  dragon.stack = 1.5;
  dragon.acted = true;
  const result = skill(game, hero, dragon);
  const body = result.players[1].field[2]!;
  expect(body.card).toBe(otherPile.card);
  expect(body.temporary).toBe(true);
  expect(maxHp(body)).toBe(19.5);
  expect(result.players[1].bench.some(unit => unit.id === dragon.id)).toBe(true);
});
test('亡骸 6/10 行动点，命中前方加玩家选定侧格', () => {
  const game = stage();
  const bird = put(game, 0, 2, '1', 3);
  put(game, 0, 1, '6', 3);
  put(game, 0, 3, '6', 3);
  const shell = put(game, 1, 2, '亡骸', 2);
  expect(cards.find(card => card.id === shell.card)?.apByStar).toEqual([6, 10]);
  const pending = attack(game, bird, shell);
  expect(pending.pending?.options).toHaveLength(2);
  const result = applyIntent(pending, 1, { type: 'choose', value: pending.pending!.options[0].value });
  expect(result.players[0].field[2]).toBeNull();
  expect(result.players[0].field.filter(Boolean)).toHaveLength(1);
});
test('骸骨龙半血及以下 20 真伤，否则 40，随后自毁', () => {
  const game = stage();
  const dragon = put(game, 0, 2, '骸骨龙');
  const holy = put(game, 1, 2, '圣龙');
  expect(skill(game, dragon, holy).players[1].field[2]).toBeNull();
  dragon.hp = 8;
  const result = skill(game, dragon, holy);
  expect(result.players[0].field[2]).toBeNull();
  expect(result.players[1].field[2]?.hp).toBe(15);
});
