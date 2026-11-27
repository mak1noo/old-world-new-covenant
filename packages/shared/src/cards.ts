import source from '../../../data/cards.json';

export type Ability = {
  id: string; name: string; effect: string; kind: string; mandatory: boolean;
  trigger?: string; limit?: string; condition?: Record<string, number>;
  params: Record<string, unknown>; text: string;
};
export type Attack = {
  mode: string; targets?: string[]; damageByStar?: number[];
  true?: boolean; trueDamageByStar?: number[]; percent?: number; hitAll?: boolean;
  alternate?: { condition: { ownPos: string }; targets: string[]; damageByStar: number[]; hitAll: boolean };
  rules?: { ownPos: string; targets: string[] }[];
};
export type Recipe = { lpCost: number; materials: { kind: string; id: string; count: number }[] };
export type Card = {
  id: string; name: string; race: string; faction?: string; category: string; serial?: string;
  maxStar: number; hpByStar: number[]; apByStar: number[]; defenseByStar?: number[];
  attack: Attack | null; abilities: Ability[]; recipe?: Recipe;
};
export type Skill = {
  id: string; name: string; costLp: number; requires: string | null; upgradeOf?: string;
  effect: string; params: Record<string, unknown>; text: string;
};
export const constants = source.constants;
export const positions = source.positions;
export const cards: readonly Card[] = [...source.baseCards, ...source.fusionCards];
export const skills: readonly Skill[] = source.inherentSkills;
export const cardById = new Map(cards.map(card => [card.id, card]));
export const cardBySerial = new Map(cards.filter(card => card.serial !== undefined).map(card => [card.serial!, card]));
export const skillById = new Map(skills.map(skill => [skill.id, skill]));

export function purchasedUpgrade(skillIds: readonly string[], skillId: string): boolean {
  return skillIds.some(id => skillById.get(id)?.upgradeOf === skillId);
}

export function validateCards(handledEffects?: ReadonlySet<string>): void {
  if (source.baseCards.length !== 12 || source.fusionCards.length !== 18 || skills.length !== 16 ||
      cardById.size !== cards.length || cardBySerial.size !== constants.serials.length ||
      skillById.size !== skills.length || constants.serials.length * constants.deckSerialCopies !== constants.deckSizePerPlayer) {
    throw new Error('卡牌数量或序号不一致');
  }
  for (const serial of constants.serials) if (!cardBySerial.has(serial)) throw new Error(`缺少序号 ${serial}`);
  for (const card of cards) {
    const tiers = [card.hpByStar, card.apByStar, card.defenseByStar, card.attack?.damageByStar, card.attack?.trueDamageByStar];
    if (tiers.some(values => values && (values.length !== card.maxStar || values.some(value => !Number.isFinite(value) || value < 0)))) {
      throw new Error(`星级数据不完整：${card.name}`);
    }
    for (const material of card.recipe?.materials ?? []) {
      if (cardById.get(material.id)?.category !== material.kind || !Number.isInteger(material.count) || material.count < 1) {
        throw new Error(`配方素材无效：${card.name}`);
      }
    }
    for (const ability of card.abilities) {
      if (handledEffects && !handledEffects.has(ability.effect)) throw new Error(`缺少卡牌效果 ${ability.effect}`);
      const transform = ability.params.transformTo;
      if (typeof transform === 'string' && !cardById.has(transform)) throw new Error(`变身目标无效：${card.name}`);
    }
  }
  for (const skill of skills) {
    if (skill.requires && !skillById.has(skill.requires) || skill.upgradeOf && skill.upgradeOf !== skill.requires) {
      throw new Error(`技能前置无效：${skill.name}`);
    }
    if (handledEffects && !handledEffects.has(skill.effect)) throw new Error(`缺少固有技能效果 ${skill.effect}`);
  }
}
validateCards();
