import { useState } from 'react';
import { cardById, cardBySerial, constants, purchasedUpgrade, skills } from '../../shared/src/cards';
import { canSublimate, definition, isNumberOnly, type Intent, type RawCard, type Unit } from '../../shared/src/game';
import { fusionOptions, type FusionOption } from '../../shared/src/legal';
import type { MatchView } from '../../shared/src/view';
import { Modal, UnitFace } from './components';
import type { CardPreview } from './CardGuide';
import { FusionFilterButtons, FusionGroups, type FusionFilter } from './fusion-groups';

type Send = (intent: Intent) => void;
const ordinal = (card: RawCard) => card.serial === 'a' ? 11 : Number(card.serial);
const numeric = (cards: RawCard[], total: number) => {
  const base = cards.reduce((sum, card) => sum + (card.serial === 'a' ? 0 : Number(card.serial)), 0);
  return cards.length > 0 && base <= total && base + cards.filter(card => card.serial === 'a').length * 10 >= total;
};
function suggestion(hand: RawCard[], total: number): number[] {
  const visit = (start: number, sum: number): RawCard[] | undefined => {
    if (sum === total) return [];
    for (let index = start; index < hand.length; index++) {
      const card = hand[index];
      if (card.serial === 'a') return [card];
      const next = sum + Number(card.serial);
      if (next === sum || next > total) continue;
      const rest = visit(index + 1, next);
      if (rest) return [card, ...rest];
    }
  };
  return visit(0, 0)?.map(card => card.id) ?? [];
}
const sale = (unit: Unit): number => {
  const card = definition(unit);
  const key = card.category === 'base' ? `sublimate${unit.star}` : card.category === 'fusion' ? `fusion${unit.star}` : 'highFusion';
  return (constants.sellPricesLp as Record<string, number>)[key];
};

export function Bench({ view, enabled, change, selected, onUnit }: {
  view: MatchView; enabled: boolean; change: Send; selected?: number; onUnit: (unit: Unit) => void;
}) {
  return <section className="bench" onDragOver={event => enabled && event.preventDefault()} onDrop={event => {
    event.preventDefault();
    const id = Number(event.dataTransfer.getData('text/plain'));
    if (enabled && view.own.field.some(unit => unit?.id === id)) change({ type: 'bench', id });
  }}>
    <div className="section-title"><h2>我方升华区</h2><span className="muted">{view.own.bench.length} 张</span></div>
    <div className="bench-cards">{view.own.bench.length ? view.own.bench.map(unit =>
      <button className={`unit-card ${definition(unit).category} ${selected === unit.id ? 'selected' : ''}`}
        key={unit.id} title={definition(unit).abilities.map(ability => ability.text).join('\n') || definition(unit).name}
        draggable={enabled} onDragStart={event => event.dataTransfer.setData('text/plain', String(unit.id))}
        onClick={() => onUnit(unit)}><UnitFace unit={unit} /></button>)
      : <p className="empty-note">升华或购买的卡牌会出现在这里</p>}</div>
    {enabled && selected && view.own.bench.some(unit => unit.id === selected) &&
      <button className="quiet" title="卖出选中的升华区卡牌" onClick={() => change({ type: 'sell', id: selected })}>
        卖出 · {sale(view.own.bench.find(unit => unit.id === selected)!)} lp
      </button>}
    {enabled && selected && view.own.field.some(unit => unit?.id === selected) &&
      <button className="quiet" title="收回选中从者" onClick={() => change({ type: 'bench', id: selected })}>收回选中从者</button>}
  </section>;
}

export function Prep({ view, change, onPreview, blocked }: { view: MatchView; change: Send; blocked: boolean; onPreview: (preview: CardPreview) => void }) {
  const player = view.own;
  const [ids, setIds] = useState<number[]>([]);
  const [panel, setPanel] = useState<'fusion' | 'star' | 'skills' | 'conversion'>();
  const hand = [...player.hand].sort((left, right) => ordinal(left) - ordinal(right));
  const selection = hand.filter(raw => ids.includes(raw.id));
  const inventory = [...player.bench, ...player.field.flatMap(unit => unit ? [unit] : [])];
  const toggle = (id: number) => setIds(current => current.includes(id) ? current.filter(item => item !== id) : [...current, id]);
  const selectedIds = selection.map(card => card.id);
  const results = constants.serials.filter(serial => canSublimate(selection, serial));
  const enabled = !blocked && !player.ready && !view.pending;
  const canUnready = !blocked && player.ready && !view.opponent.ready && !view.pending;
  const known = skills.filter(skill => player.skills.includes(skill.id));
  const possibleSums = known.some(skill => skill.effect === 'sum_seven_to_lp') ? [10, 7] as const : [10] as const;
  const conversions = selection.length === 1 ? known.flatMap(skill => {
    const serial = selection[0].serial;
    if (skill.effect === 'transform_greater_than_8_to_any' && Number(serial) > Number(skill.params.threshold)) {
      return [{ skill, results: constants.serials.filter(value => value !== 'a' && value !== serial) }];
    }
    if (skill.effect === 'swap_serial_pairs') {
      const opposite = (skill.params.pairs as string[][]).find(pair => pair.includes(serial))?.filter(value => value !== serial);
      return opposite ? [{ skill, results: opposite }] : [];
    }
    if (skill.effect === 'add_1_or_2_to_hand_card' && !player.loveUsed) {
      const next = [String(Number(serial) + 1), String(Number(serial) + 2)].filter(value => cardBySerial.has(value));
      return next.length ? [{ skill, results: next }] : [];
    }
    return [];
  }) : [];
  return <>
    <div className="command-center">
      <section className="command-panel">
        <div className="section-title"><h2>手牌</h2><span className="muted">{hand.length} 张</span></div>
        <div className="hand-cards">{hand.map(raw => {
          const card = cardBySerial.get(raw.printed)!;
          const numberOnly = isNumberOnly(raw);
          return <button key={raw.id} onClick={() => {
            onPreview({ card, star: 1 });
            if (enabled) toggle(raw.id);
          }}
            aria-pressed={ids.includes(raw.id)} className={`raw-card ${ids.includes(raw.id) ? 'selected' : ''} ${numberOnly ? 'number-only' : ''}`}
            title={numberOnly ? `${card.name} · 当前数字 ${raw.serial} · 仅补组合和凑数` : `${raw.serial} · ${card.name}`}>
            <strong>{raw.serial}</strong><small>{card.name}</small>
            {numberOnly && <small className="number-only-label">仅作数字</small>}
          </button>;
        })}</div>
        {enabled && <div className="inline-actions">
          {results.map(serial => <button key={serial} disabled={player.lp < 3 - selection.length} title="将选定手牌升华"
            onClick={() => change({ type: 'sublimate', ids: selectedIds, serial })}>
            升华 {serial}{selection.length < 3 ? ` · ${3 - selection.length} lp` : ''}
          </button>)}
          {possibleSums.map(total => {
            const suggested = suggestion(hand, total);
            return numeric(selection, total) ? <button key={total} title="将选定手牌换成 1 lp"
              onClick={() => change({ type: 'sum', ids: selectedIds, total })}>凑{total === 10 ? '十' : '七'} · +1 lp</button>
              : <button key={total} title="选中一组可凑数的牌" disabled={!suggested.length} className="quiet"
                onClick={() => setIds(suggested)}>选出凑{total === 10 ? '十' : '七'}</button>;
          })}
          {known.some(skill => skill.effect === 'reset_hand_once_per_prep') && <button title="重抽所选手牌"
            disabled={!selection.length || player.resetUsed} onClick={() => change({ type: 'reset', ids: selectedIds })}>奇遇重抽</button>}
          {conversions.map(({ skill, results }) => <label className="convert" key={skill.id}>{skill.name}
            <select value="" onChange={event => change({ type: 'change', skill: skill.id, id: selection[0].id, serial: event.target.value })}>
              <option value="" disabled>选序号</option>{results.map(value => <option value={value} key={value}>{value}</option>)}
            </select></label>)}
        </div>}
      </section>
      <section className="command-panel">
        <div className="section-title"><h2>商店</h2><button className="quiet" disabled={!enabled || player.lp < constants.shopRefreshCostLp}
          onClick={() => change({ type: 'refresh' })} title="刷新五张商店牌">刷新 · {constants.shopRefreshCostLp} lp</button></div>
        <div className="shop-cards">{player.shop.map((raw, slot) => <div key={slot} className="shop-card">
          {raw ? <button className="shop-preview" title="查看卡牌数值和技能"
            onClick={() => onPreview({ card: cardBySerial.get(raw.serial)!, star: 1 })}>
            <strong>{raw.serial}</strong><small>{cardBySerial.get(raw.serial)?.name}</small>
          </button> : <><strong>—</strong><small>已售</small></>}
          <button disabled={!raw || !enabled || player.lp < constants.shopBuyCostLp} title={player.lp < constants.shopBuyCostLp ? 'lp 不足' : '购买一星升华卡'}
            onClick={() => change({ type: 'buy', slot })}>{constants.shopBuyCostLp} lp</button>
        </div>)}</div>
      </section>
      <section className="command-panel operations">
        <div className="section-title"><h2>整备</h2><b className="gold">{player.lp} lp</b></div>
        <div className="inline-actions">{([['fusion', '融合'], ['star', '升星'], ['skills', '固有技能'], ['conversion', '炼金／炼心']] as const)
          .map(([value, label]) => <button key={value} onClick={() => setPanel(value)} title={label} disabled={!enabled && value !== 'skills'}>{label}</button>)}</div>
        <button className="primary" disabled={!enabled && !canUnready}
          onClick={() => change({ type: player.ready ? 'unready' : 'ready' })}>
          {canUnready ? '取消准备' : player.ready ? '等待对手' : '准备完成'}</button>
      </section>
    </div>
    {panel && <Modal title={{ fusion: '融合配方', star: '升星', skills: '固有技能', conversion: '炼金与炼心' }[panel]} onClose={() => setPanel(undefined)}>
      {panel === 'fusion' && <FusionBook options={fusionOptions(inventory, player.lp)} enabled={enabled} send={change} />}
      {panel === 'star' && <Star inventory={inventory} send={change} />}
      {panel === 'skills' && <div className="skills-list">{skills.map(skill => {
        const upgraded = purchasedUpgrade(player.skills, skill.id);
        const purchased = known.includes(skill);
        return <div className="option" key={skill.id}>
          <div><strong>{skill.name}</strong><p>{skill.text}</p></div>
          <button disabled={!enabled || upgraded || purchased || player.lp < skill.costLp || (!!skill.requires && !player.skills.includes(skill.requires))}
            title={upgraded ? '已拥有升级版' : skill.requires ? `需先购买 ${skills.find(entry => entry.id === skill.requires)?.name}` : skill.name}
            onClick={() => change({ type: 'skill', skill: skill.id })}>
            {upgraded ? '已升级' : purchased ? '已购' : `${skill.costLp} lp`}
          </button>
        </div>;
      })}</div>}
      {panel === 'conversion' && <div className="skills-list">
        {inventory.filter(unit => definition(unit).recipe).map(unit => <div className="option" key={unit.id}>
          <strong>{definition(unit).name} · {unit.star}星</strong>
          <div className="inline-actions">
            <button disabled={!known.some(skill => skill.effect === 'decompose_fusion_to_materials') || player.lp < 1}
              title="分解成一星配方素材" onClick={() => change({ type: 'decompose', id: unit.id })}>炼心 · 1 lp</button>
            {definition(unit).category === 'fusion' && unit.star === 2 && <button
              disabled={!known.some(skill => skill.effect === 'convert_2star_fusion_to_two_1star') || player.lp < 1}
              title="分解成两张同名一星融合卡" onClick={() => change({ type: 'alchemy', id: unit.id })}>炼金 · 1 lp</button>}
          </div>
        </div>)}
        {!inventory.some(unit => definition(unit).recipe) && <p className="muted">当前没有可分解的融合卡。</p>}
      </div>}
    </Modal>}
  </>;
}

function FusionBook({ options, enabled, send }: { options: FusionOption[]; enabled: boolean; send: Send }) {
  const [filter, setFilter] = useState<FusionFilter>('craftable');
  const visible = options.filter(option => filter === 'all' || option.craftable);
  return <>
    <FusionFilterButtons value={filter} change={setFilter} />
    {visible.length ? <FusionGroups cards={visible.map(option => option.card)} render={card =>
      <Fusion key={card.id} option={visible.find(option => option.card === card)!} enabled={enabled} send={send} />}
      /> : <p className="muted">当前材料和 lp 不足以进行融合。</p>}
  </>;
}

function Fusion({ option: { card, recipe, materials, craftable }, enabled, send }: {
  option: FusionOption; enabled: boolean; send: Send;
}) {
  const [chosen, setChosen] = useState<number[]>([]);
  const ids = materials.flatMap((group, index) => group.filter(unit => chosen.includes(unit.id)).length === recipe.materials[index].count
    ? group.filter(unit => chosen.includes(unit.id)).map(unit => unit.id)
    : [...group].sort((left, right) => left.star - right.star).slice(0, recipe.materials[index].count).map(unit => unit.id));
  return <details className="option">
    <summary><strong>{card.name}</strong> · {card.category === 'highFusion' ? '高阶融合' : '融合'} · {recipe.lpCost} lp
      {!craftable && <small className="muted"> · 暂不可合成</small>}</summary>
    {materials.map((group, index) => <fieldset key={recipe.materials[index].id}>
      <legend>{cardById.get(recipe.materials[index].id)?.name} · {group.length}/{recipe.materials[index].count}</legend>
      <div className="inline-actions">{group.map(unit => <button key={unit.id} aria-pressed={ids.includes(unit.id)}
        className={ids.includes(unit.id) ? 'selected' : 'quiet'} title="选择此卡为素材" onClick={() => {
          const groupIds = group.map(entry => entry.id);
          const keep = ids.filter(id => groupIds.includes(id) && id !== unit.id);
          setChosen(current => [...current.filter(id => !groupIds.includes(id)), ...[...keep, unit.id].slice(-recipe.materials[index].count)]);
        }}>{unit.star}星 · #{unit.id}</button>)}</div>
    </fieldset>)}
    <button className="primary" disabled={!enabled || !craftable}
      title="使用选中的素材执行融合" onClick={() => send({ type: 'fuse', card: card.id, ids })}>执行融合</button>
  </details>;
}
function Star({ inventory, send }: { inventory: Unit[]; send: Send }) {
  const possible = inventory.flatMap((unit, index) => unit.star >= definition(unit).maxStar ? [] :
    inventory.slice(index + 1).filter(other => other.star === unit.star && other.card === unit.card)
      .map(other => ({ unit, other })));
  return possible.length ? <div className="skills-list">{possible.map(({ unit, other }) => <div className="option" key={`${unit.id}-${other.id}`}>
    <strong>{definition(unit).name} · {unit.star} → {unit.star + 1} 星 <small>#{unit.id} + #{other.id}</small></strong>
    <button onClick={() => send({ type: 'star', ids: [unit.id, other.id] })} title="合并此卡对并升星">升星</button>
  </div>)}</div> : <p className="muted">需要两张同名、同星且未达到上限的卡。</p>;
}
