import type { ReactNode } from 'react';
import type { Card } from '../../shared/src/cards';

const byPinyin = new Intl.Collator('zh-CN-u-co-pinyin');

export function FusionGroups({ cards, render }: { cards: readonly Card[]; render: (card: Card) => ReactNode }) {
  const factions = new Map<string, Map<string, Card[]>>();
  for (const card of cards) {
    const faction = card.faction ?? '未指定阵营';
    let races = factions.get(faction);
    if (!races) {
      races = new Map();
      factions.set(faction, races);
    }
    const group = races.get(card.race) ?? [];
    group.push(card);
    races.set(card.race, group);
  }
  return <div className="fusion-groups">
    {[...factions].sort(([a], [b]) => byPinyin.compare(a, b)).map(([faction, races]) => <section key={faction}>
      <h4>{faction}</h4>
      {[...races].sort(([a], [b]) => byPinyin.compare(a, b)).map(([race, group]) => <div key={race} className="fusion-race">
        <h5>{race}</h5>
        {group.sort((a, b) => byPinyin.compare(a.name, b.name)).map(render)}
      </div>)}
    </section>)}
  </div>;
}

export type FusionFilter = 'all' | 'craftable';
export function FusionFilterButtons({ value, change }: { value: FusionFilter; change: (value: FusionFilter) => void }) {
  return <div className="fusion-filters" aria-label="融合筛选">
    <button className={value === 'craftable' ? 'selected' : 'quiet'} aria-pressed={value === 'craftable'}
      onClick={() => change('craftable')}>可合成</button>
    <button className={value === 'all' ? 'selected' : 'quiet'} aria-pressed={value === 'all'}
      onClick={() => change('all')}>全部融合卡</button>
  </div>;
}
