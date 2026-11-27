import { expect, test } from 'vitest';
import { cardBySerial, cards, constants, skills, validateCards } from './cards';

test('全部卡牌、技能和素材引用有效', () => {
  expect(validateCards).not.toThrow();
  expect(cards).toHaveLength(30);
  expect(skills).toHaveLength(16);
  expect(cardBySerial.size).toBe(12);
});

test('采用作者最终数值和技能关系', () => {
  expect(cards.find(card => card.name === '亡骸')?.apByStar).toEqual([6, 10]);
  expect(constants.battleRoundCap).toBe(50);
  expect(skills.find(skill => skill.name === '断金')?.params.capLp).toBe(5);
  expect(skills.find(skill => skill.name === '二级军队')?.upgradeOf).toBe('skill_army');
});
