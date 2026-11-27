import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react';
import { cardById, skillById, positions } from '../../shared/src/cards';
import { maxHp, protectingFishman, type LogEntry, type Unit } from '../../shared/src/game';
import type { BattleFrame } from './playback';

export function Modal({ title, onClose, children, className }: { title: string; onClose?: () => void; children: ReactNode; className?: string }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const heading = useId();
  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);
  return <dialog ref={dialog} className={className} aria-labelledby={heading} onCancel={event => { event.preventDefault(); onClose?.(); }}>
    <div className="dialog-heading"><h2 id={heading}>{title}</h2>{onClose && <button className="quiet" onClick={onClose} title="关闭">关闭</button>}</div>
    {children}
  </dialog>;
}

export function UnitFace({ unit }: { unit: Unit }) {
  const card = cardById.get(unit.card)!;
  const attack = card.attack;
  const index = unit.star - 1;
  const damage = attack?.percent ? `${attack.percent}% HP` : attack?.damageByStar?.[index] ?? '—';
  return <>
    <span className="card-overline"><span>{card.serial ?? (card.category === 'highFusion' ? '高融' : '融合')}</span>
      <span aria-label={`${unit.star} 星`}>{'★'.repeat(unit.star)}</span></span>
    <strong>{card.name}</strong>
    <span className="muted card-race">{card.race}</span>
    <span className="card-stats">
      <span title="生命上限">♥ {maxHp(unit)}</span>
      <span title="行动点">⚡ {card.apByStar[index]}</span>
      <span title="攻击力">⚔ {damage}{attack?.true ? ' 真' : ''}{attack?.trueDamageByStar && `＋${attack.trueDamageByStar[index]}真`}</span>
    </span>
  </>;
}
export function hp(value: number): string { return Number.isInteger(value) ? String(value) : value.toFixed(1); }

export function BoardRow({ enemy, field, selected, highlighted, active, onUnit, onEmpty, onDrop, onHp, taunt, battle, canDrag, frame }: {
  enemy: boolean; field: (Unit | null)[]; selected?: number; highlighted: Set<number>; active: Set<number>;
  onUnit: (unit: Unit, slot: number) => void; onEmpty?: (slot: number) => void; onDrop?: (id: number, slot: number) => void;
  onHp: (unit: Unit) => void; taunt: boolean; battle: boolean; canDrag: boolean;
  frame?: BattleFrame;
}) {
  const base = positions.order.map((position, index) => ({ index, name: positions.namesZh[position as keyof typeof positions.namesZh] }));
  const order = [{ index: -1, name: 'a' }, ...(enemy ? base.reverse() : base)];
  return <div className={`board-row ${enemy ? 'enemy' : 'friendly'}`}>
    {order.map(({ index, name }) => {
      const unit = field[index];
      const card = unit && cardById.get(unit.card)!;
      const event = frame?.entry;
      const eventKind = battle && unit && event?.unit === unit.id ? event.kind : undefined;
      const hasParticles = eventKind === 'damage' || eventKind === 'heal' || eventKind === 'destroy' || eventKind === 'summon';
      const phaseStyle = eventKind ? { '--event-ms': `${frame!.duration}ms` } as CSSProperties : undefined;
      const flags = unit ? [
        taunt && index === 2 && '嘲讽',
        ((unit.defense ?? 0) > 0 || !!card?.defenseByStar) && '防御',
        (unit.stack ?? 0) > 0 && '强化',
        unit.auraHp && '守阵光环',
        unit.bonusHp && !unit.temporary && '星辉赐福',
        battle && protectingFishman(field, unit) && '攻击免疫',
        battle && unit.star === 2 && card?.abilities.some(ability => ability.effect === 'prevent_destruction_once') && !unit.onceUsed && '免破坏',
        battle && unit.acted && '已行动',
        unit.flipped && '翻面',
      ].filter(Boolean) : [];
      return <div className={`slot ${eventKind ? `event-${eventKind}` : ''}`} key={index} style={phaseStyle}
        onDragOver={event => onDrop && index >= 0 && event.preventDefault()}
        onDrop={event => { event.preventDefault(); const id = Number(event.dataTransfer.getData('text/plain')); if (id && index >= 0) onDrop?.(id, index); }}>
        {index < 0 ? <div className="empty locked" title="a 位锁定"><span>◇</span><b>a 位</b></div>
          : unit ? <button className={`unit-card ${card?.category} ${selected === unit.id ? 'selected' : ''} ${highlighted.has(unit.id) ? 'targeted' : ''} ${active.has(unit.id) ? 'actionable' : ''}`}
            draggable={canDrag && !enemy} onDragStart={event => event.dataTransfer.setData('text/plain', String(unit.id))}
            onClick={() => onUnit(unit, index)} title={`${name} · ${card?.name}`}><UnitFace unit={unit} /></button>
            : <button className="empty" onClick={() => onEmpty?.(index)} title={`空站位 ${name}`}><span>◇</span><b>{name}</b></button>}
        {hasParticles && <div aria-hidden="true" className="battle-particles" key={`${unit!.id}-${frame!.index}`}>
          {Array.from({ length: 8 }, (_, particle) => <i key={particle} style={{ '--angle': `${particle * 45}deg` } as CSSProperties} />)}
        </div>}
        {(eventKind === 'damage' || eventKind === 'heal') && event?.amount !== undefined &&
          <span aria-hidden="true" className={`damage-float ${eventKind}`} key={frame!.index}>
            {eventKind === 'heal' ? '+' : '−'}{hp(event.amount)}
          </span>}
        {unit ? <button className={`hp${battle && unit.acted ? ' acted' : ''}`} onClick={() => onHp(unit)} title={`${name} · 查看从者生命明细`}>
          <span>{name} · HP {hp(unit.hp)}/{hp(maxHp(unit))}</span>
          {!!flags.length && <small>{flags.join(' · ')}</small>}
        </button> : <div className="hp vacant">{index < 0 ? '锁定' : 'HP —'}</div>}
      </div>;
    })}
  </div>;
}

export function SkillIcons({ ids }: { ids: string[] }) {
  return <div className="skill-tags">{ids.map(id => {
    const skill = skillById.get(id);
    return skill && <span key={id} title={skill.text}>{skill.name}</span>;
  })}</div>;
}

export function HealthDetails({ entries, onClose, title }: { entries: LogEntry[]; onClose: () => void; title: string }) {
  return <Modal title={title} onClose={onClose}>
    {entries.length ? <ul className="events">{[...entries].reverse().map((entry, index) =>
      <li key={index}><span>第 {entry.battle} 场 · 第 {entry.round} 轮</span><b>{entry.text}</b>
        {entry.amount !== undefined && <strong className={entry.kind === 'heal' ? 'healing' : 'damage'}>
          {entry.kind === 'heal' ? '+' : '−'}{hp(entry.amount)} · {hp(entry.before!)} → {hp(entry.after!)}
        </strong>}</li>)}</ul>
      : <p className="muted">暂无扣血记录</p>}
  </Modal>;
}

export function BenchBacks({ count }: { count: number }) {
  return <div className="enemy-bench"><b>敌方升华区</b>
    <div className="backs" aria-hidden="true">{Array.from({ length: Math.min(count, 8) }, (_, index) => <i key={index}>◇</i>)}</div>
    <span className="muted">{count} 张</span>
  </div>;
}
