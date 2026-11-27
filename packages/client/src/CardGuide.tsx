import { useState } from 'react';
import { cardById, cards, positions, type Card } from '../../shared/src/cards';
import { maxHp, type Unit } from '../../shared/src/game';
import { fusionOptions } from '../../shared/src/legal';
import type { MatchView } from '../../shared/src/view';
import { hp, Modal } from './components';
import { FusionFilterButtons, FusionGroups, type FusionFilter } from './fusion-groups';

const categories = [
  { value: 'base', label: '升华卡' },
  { value: 'fusion', label: '融合卡' },
  { value: 'highFusion', label: '高阶融合卡' },
] as const;
const abilityKinds: Record<string, string> = {
  active: '主动技', triggered: '触发技', continuous: '持续效果',
  battle_start: '开战技', special: '特殊技',
};
const targetNames: Record<string, string> = {
  ...positions.namesZh, front: '正前', front_left: '左前', front_right: '右前',
  any: '任意敌方位置', all: '全体敌方从者',
};
const usedBy = new Map<string, Card[]>();
for (const result of cards) for (const material of result.recipe?.materials ?? []) {
  const matches = usedBy.get(material.id) ?? [];
  matches.push(result);
  usedBy.set(material.id, matches);
}

function RecipeMaterials({ result, visit }: { result: Card; visit?: (card: Card) => void }) {
  const recipe = result.recipe!;
  return <span className="recipe-materials">
    {recipe.materials.map(({ id, count }) => {
      const material = cardById.get(id)!;
      return <span key={id}>{visit
        ? <button className="recipe-link" onClick={() => visit(material)}>{material.name}</button>
        : material.name} ×{count}</span>;
    })}
    <span className="gold">{recipe.lpCost} lp</span>
  </span>;
}

export type CardPreview = { card: Card; star: number; unitId?: number };
export function CardDetails({ card, star, unit, visit }: { card: Card; star: number; unit?: Unit; visit?: (card: Card) => void }) {
  const attack = card.attack;
  const names = (targets: string[] = []) => targets.map(target => targetNames[target] ?? target).join('、');
  const range = attack?.mode === 'positional'
    ? `位于${names(attack.rules?.map(rule => rule.ownPos))}时攻击正前`
    : attack?.mode === 'sequential' ? '沿选定方向逐格攻击，跳过空位'
    : names(attack?.targets);
  return <div className="card-details">
    <p className="card-detail-meta">{categories.find(category => category.value === card.category)?.label} · {card.race}
      {card.serial !== undefined && ` · 编号 ${card.serial}`}
      {unit && <span> · 当前 HP {hp(unit.hp)} / {hp(maxHp(unit))}</span>}
    </p>
    <table className="card-values">
      <thead><tr><th scope="col">星级</th>{card.hpByStar.map((_, index) =>
        <th scope="col" key={index} className={star === index + 1 ? 'current-star' : ''}>{index + 1} 星</th>)}</tr></thead>
      <tbody>
        <tr><th scope="row">生命</th>{card.hpByStar.map((value, index) => <td key={index}>{value}</td>)}</tr>
        <tr><th scope="row">行动点</th>{card.apByStar.map((value, index) => <td key={index}>{value}</td>)}</tr>
        <tr><th scope="row">攻击</th>{card.hpByStar.map((_, index) => <td key={index}>{
          attack?.percent ? `${attack.percent}% HP` : attack?.damageByStar
            ? `${attack.damageByStar[index]}${attack.true ? ' 真' : ''}${attack.trueDamageByStar ? `＋${attack.trueDamageByStar[index]} 真` : ''}`
            : '—'
        }</td>)}</tr>
        {card.defenseByStar && <tr><th scope="row">防御</th>{card.defenseByStar.map((value, index) => <td key={index}>{value}</td>)}</tr>}
      </tbody>
    </table>
    {attack && <p><b>攻击范围</b> {range}{attack.hitAll && attack.targets?.length && attack.targets.length > 1 ? '（同时命中）' : ''}</p>}
    {attack?.alternate && <p><b>{targetNames[attack.alternate.condition.ownPos]}位攻击</b> {names(attack.alternate.targets)}
      {attack.alternate.hitAll && '（同时命中）'} · {attack.alternate.damageByStar.join(' / ')}</p>}
    {card.abilities.length ? <ul className="card-skills">{card.abilities.map(ability =>
      <li key={ability.id}><strong>{ability.kind === 'continuous' || ability.kind === 'battle_start' ? ability.name : abilityKinds[ability.kind] ?? '技能'}
        {ability.condition?.selfStar && ` · ${ability.condition.selfStar} 星`}</strong>{ability.text}</li>)}</ul>
      : <p className="muted">无技能</p>}
    {card.recipe && <section className="card-recipe"><h4>融合配方</h4><RecipeMaterials result={card} visit={visit} /></section>}
    {visit && usedBy.has(card.id) && <section className="card-recipe">
      <h4>{card.category === 'base' ? '可融合成' : '可高阶融合成'}</h4>
      <ul className="recipe-outcomes">{usedBy.get(card.id)?.map(result => <li key={result.id}>
        <button className="recipe-link recipe-result" onClick={() => visit(result)}>{result.name}</button>
        <RecipeMaterials result={result} visit={visit} />
      </li>)}</ul>
    </section>}
  </div>;
}

export function CardGuide({ onClose, player }: { onClose: () => void; player?: MatchView['own'] }) {
  const [category, setCategory] = useState<(typeof categories)[number]['value']>('base');
  const [id, setId] = useState<string>();
  const [filter, setFilter] = useState<FusionFilter>('all');
  const inventory = player ? [...player.bench, ...player.field.filter((unit): unit is Unit => unit !== null && !unit.temporary)] : [];
  const available = new Set(fusionOptions(inventory, player?.lp ?? 0)
    .filter(option => option.craftable).map(option => option.card.id));
  const choices = cards.filter(card => card.category === category &&
    (category === 'base' || filter === 'all' || available.has(card.id)));
  const selected = choices.find(card => card.id === id) ?? choices[0];
  function visit(card: Card) {
    if (card.category === 'base' || card.category === 'fusion' || card.category === 'highFusion') setCategory(card.category);
    setFilter('all');
    setId(card.id);
  }
  function cardButton(card: Card) {
    return <button className={card === selected ? 'selected' : 'quiet'} key={card.id}
      aria-pressed={card === selected} onClick={() => setId(card.id)}>
      {card.serial !== undefined && <small>{card.serial}</small>}{card.name}
    </button>;
  }
  return <Modal title="卡牌图鉴" onClose={onClose} className="card-guide-dialog">
    <div className="guide-categories" aria-label="卡牌类别">
      {categories.map(tab => <button className={tab.value === category ? 'selected' : 'quiet'} key={tab.value}
        aria-pressed={tab.value === category} onClick={() => { setCategory(tab.value); setId(undefined); }}>{tab.label}</button>)}
    </div>
    {category !== 'base' && <FusionFilterButtons value={filter} change={setFilter} />}
    <div className="guide-content">
      <div className="guide-cards" aria-label="卡牌列表">
        {category === 'base' ? choices.map(cardButton) : <FusionGroups cards={choices} render={cardButton} />}
      </div>
      {selected ? <section className="guide-details" aria-label={selected.name}>
        <h3>{selected.name}</h3>
        <CardDetails card={selected} star={1} visit={visit} />
      </section> : <p className="muted">{player ? '当前材料和 lp 不足以合成此类别的卡。' : '进入对局后可按手中材料查看。'}</p>}
    </div>
  </Modal>;
}
