import { useEffect, useState, type CSSProperties } from 'react';
import { constants, skills } from '../../shared/src/cards';
import { definition, other, type ForecastIntent, type Intent, type Side, type Unit } from '../../shared/src/game';
import type { ForecastReply } from '../../shared/src/protocol';
import type { MatchView } from '../../shared/src/view';
import { BenchBacks, BoardRow, HealthDetails, Modal, SkillIcons, hp, hpLimit } from './components';
import { Bench, Prep } from './Prep';
import { CardDetails, type CardPreview } from './CardGuide';
import type { BattleFrame } from './playback';

const taunt = skills.find(skill => skill.effect === 'middle_slot_taunt_and_no_death_protection')!.id;
type Action = 'attack' | 'ability' | 'arcane';
type Detail = { title: string; player?: Side; unit?: number };

export function Match({ view, legal, change, exit, restart, frame, openRules, openGuide, openSettings, requestForecast, forecast }: {
  view: MatchView; legal: Intent[]; change: (intent: Intent) => void; exit: () => void; restart: () => void;
  frame?: BattleFrame; openRules: () => void; openGuide: () => void; openSettings: () => void;
  requestForecast: (intent: ForecastIntent) => number; forecast?: ForecastReply;
}) {
  const [selected, setSelected] = useState<number>();
  const [action, setAction] = useState<Action>();
  const [firstTarget, setFirstTarget] = useState<number>();
  const [detail, setDetail] = useState<Detail>();
  const [preview, setPreview] = useState<CardPreview>();
  const [openLog, setOpenLog] = useState(true);
  const [filter, setFilter] = useState('all');
  const [historyLimit, setHistoryLimit] = useState(80);
  const [confirmation, setConfirmation] = useState<{ requestId: number; intent: ForecastIntent }>();
  const battle = view.phase === 'battle';
  const prep = view.phase === 'prep' && !view.own.ready && !view.pending && !frame;
  const turn = battle && view.active === view.side && !view.pending && !frame;
  const slotFrame = battle && frame?.entry.battle === view.battle && frame.entry.round === view.round ? frame : undefined;
  const active = new Set(legal.flatMap(intent => 'id' in intent ? [intent.id] : []));
  const selectedUnit = view.own.field.find(unit => unit?.id === selected);
  const byUnit = legal.filter(intent => 'id' in intent && intent.id === selected);
  const targeted = new Set<number>();
  const abilities = byUnit.filter(intent => intent.type === 'ability');
  const attacks = byUnit.filter(intent => intent.type === 'attack');
  const arcane = byUnit.filter(intent => intent.type === 'arcane');

  function clearSelection() {
    setAction(undefined);
    setFirstTarget(undefined);
    setSelected(undefined);
    setConfirmation(undefined);
  }
  useEffect(() => { clearSelection(); }, [view.battle, view.round, view.active, view.phase, view.pending]);
  if (action === 'attack') attacks.forEach(intent => { if (intent.target) targeted.add(intent.target); });
  if (action === 'ability') abilities.forEach(intent => {
    const id = firstTarget ? intent.target === firstTarget ? intent.ally : undefined : intent.target;
    if (id) targeted.add(id);
  });
  if (action === 'arcane') arcane.forEach(intent => {
    if (firstTarget === undefined) {
      targeted.add(intent.first);
      targeted.add(intent.second);
    } else if (intent.first === firstTarget) targeted.add(intent.second);
    else if (intent.second === firstTarget) targeted.add(intent.first);
  });

  const commit = (intent: Intent) => { if (!frame) { change(intent); clearSelection(); } };
  function confirmAction(intent: ForecastIntent) {
    setConfirmation({ intent, requestId: requestForecast(intent) });
  }
  function selectTarget(unit: Unit) {
    if (!targeted.has(unit.id)) return false;
    if (action === 'attack') {
      const intent = attacks.find(intent => intent.target === unit.id);
      if (intent) confirmAction(intent);
    } else if (action === 'ability') {
      if (firstTarget) {
        const intent = abilities.find(intent => intent.target === firstTarget && intent.ally === unit.id);
        if (intent) confirmAction(intent);
      } else {
        const intent = abilities.find(intent => intent.target === unit.id);
        if (intent?.ally) setFirstTarget(unit.id);
        else if (intent) confirmAction(intent);
      }
    } else if (action === 'arcane') {
      if (!firstTarget) setFirstTarget(unit.id);
      else {
        const intent = arcane.find(intent => intent.first === firstTarget && intent.second === unit.id || intent.second === firstTarget && intent.first === unit.id);
        if (intent) confirmAction(intent);
      }
    }
    return true;
  }
  function chooseMode(mode: Action) {
    const direct = mode === 'attack' ? attacks.find(intent => !intent.target)
      : mode === 'ability' ? abilities.find(intent => !intent.target) : undefined;
    if (direct) confirmAction(direct);
    else {
      setAction(mode);
      setFirstTarget(undefined);
    }
  }
  const changeSlot = (id: number, slot: number) => {
    if (prep) commit({ type: 'place', id, slot });
  };
  const inspectUnit = (unit: Unit) => setPreview({ card: definition(unit), star: unit.star, unitId: unit.id });
  const previewUnit = preview?.unitId === undefined ? undefined :
    [...view.own.field, ...view.opponent.field].find(unit => unit?.id === preview.unitId) ?? undefined;
  function selectUnit(unit: Unit) {
    if (selectTarget(unit)) return;
    inspectUnit(unit);
    if (prep || turn && active.has(unit.id)) {
      setSelected(selected === unit.id ? undefined : unit.id);
      setAction(undefined);
      setFirstTarget(undefined);
    }
  }
  const unitDetail = (unit: Unit) => setDetail({ title: `${definition(unit).name} · 生命明细`, unit: unit.id });
  const playerDetail = (side: Side) => setDetail({ title: side === view.side ? '我方玩家生命' : '对方玩家生命', player: side });
  const resultFor = (side: Side) => view.log.filter(entry => entry.kind === 'result' && entry.player === side);
  const lastResult = view.log.findLast(entry => entry.kind === 'result');
  const visibleLog = filter === 'all' ? view.log : view.log.filter(entry => String(entry.battle) === filter);
  const message = view.winner === null ? '平局' : view.winner === view.side ? '胜利' : '落败';
  const ownSpeed = view.own.field.reduce((sum, unit) => sum + (unit ? definition(unit).apByStar[unit.star - 1] : 0), 0);
  const currentAction = action === 'attack' ? '选择攻击目标' : action === 'ability' ? firstTarget ? '选择追加攻击的敌方目标' : '选择技能目标'
    : action === 'arcane' ? '选择两名友军交换站位' : undefined;

  return <main className="match">
    <header className="match-header">
      <button className="brand-link" title="返回主菜单" onClick={exit}><span className="brand-icon">◇</span>旧界新约</button>
      <div className="match-counter"><strong>第 {view.battle} 回合</strong><span>战斗 {view.battle} / {constants.battleCap}</span></div>
      <div className="inline-actions">
        <button className="quiet" aria-pressed={openLog} onClick={() => setOpenLog(!openLog)}>History</button>
        <button className="quiet" onClick={openRules}>游戏规则</button>
        <button className="quiet" onClick={openGuide}>卡牌图鉴</button>
        <button className="quiet" onClick={openSettings}>设置</button>
        <button className="quiet" title="离开当前对局" onClick={exit}>退出</button></div>
    </header>
    <div className={`match-layout ${openLog || preview ? 'has-sidebar' : ''}`}>
      {(openLog || preview) && <aside className="match-sidebar">
        {openLog && <section className="battle-log" aria-label="行动记录 History">
          <div className="section-title"><h2>行动记录 <small>History</small></h2></div>
          <label className="history-filter">场次 <select value={filter} onChange={event => {
            setFilter(event.target.value);
            setHistoryLimit(80);
          }}>
            <option value="all">全部</option>{Array.from({ length: view.battle }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}
          </select></label>
          {visibleLog.length ? <ul className="events">{visibleLog.slice(-historyLimit).reverse().map((entry, index) =>
            <li key={visibleLog.length - index}><span>第 {entry.battle} 场 · {entry.round} 轮
              {entry.player !== undefined && ` · ${entry.player === view.side ? '我方' : '敌方'}`}</span><b>{entry.text}</b>
              {entry.amount !== undefined && <strong className={entry.kind === 'heal' ? 'healing' : 'damage'}>
                {entry.kind === 'heal' ? '+' : '−'}{hp(entry.amount)}
              </strong>}</li>)}</ul>
            : <p className="muted">暂无行动记录。</p>}
          {visibleLog.length > historyLimit && <button className="quiet history-older"
            onClick={() => setHistoryLimit(limit => limit + 80)}>显示更早记录</button>}
        </section>}
        {preview && <section className="card-inspector" aria-label="卡牌预览">
          <div className="section-title"><h2>{preview.card.name}</h2>
            <button className="quiet" onClick={() => setPreview(undefined)}>关闭预览</button></div>
          <CardDetails card={preview.card} star={preview.star} unit={previewUnit} />
        </section>}
      </aside>}
      <div className="match-play-area">
        <section className="battlefield" aria-label="战场">
          <div className="player-bar">
            <span className="avatar enemy-avatar" aria-hidden="true">◆</span><strong>敌方</strong>
            <button className="life" title="敌方玩家生命明细" onClick={() => playerDetail(other(view.side))}>♥ {view.opponent.hp}/{hpLimit}</button>
            <span className="stat">速度 <b>{view.opponent.speed}</b></span>
            <SkillIcons ids={view.opponent.skills} />
            <span className="player-turn">{battle ? view.first !== view.side ? '先手' : '后手' : view.opponent.ready ? '已准备' : '准备中'}</span>
          </div>
          <BenchBacks count={view.opponent.benchCount} />
          <BoardRow enemy field={view.opponent.field} highlighted={targeted} active={new Set()} onUnit={unit => { if (!selectTarget(unit)) inspectUnit(unit); }}
            onHp={unitDetail} frame={slotFrame} taunt={view.opponent.skills.includes(taunt)} battle={battle} canDrag={false} />
          <div className="phase">
            <div key={`${view.phase}-${view.round}`}><span className="gold">◇</span><strong>{view.phase === 'finished' ? '对局结束' : view.pending && !battle ? '战斗开始' : battle ? '战斗阶段' : '准备阶段'}</strong>
              <span>{frame ? '行动演示' : battle ? `第 ${view.round} 战斗轮次 · ${turn ? '我方行动' : '等待对方'}` : prep ? '构筑与布阵' : '等待结算'}</span></div>
            {currentAction && <button className="quiet" title="取消目标选择" onClick={clearSelection}>取消 · {currentAction}</button>}
            {!battle && !frame && lastResult && <small>{lastResult.text === '本场战斗平局' ? `第 ${lastResult.battle} 场平局` :
              `第 ${lastResult.battle} 场 · ${lastResult.player === view.side ? '我方' : '敌方'}失去 ${lastResult.amount} HP`}</small>}
          </div>
          <div className={`battle-event ${frame ? `battle-event-${frame.entry.kind}` : ''}`} role="status">
            {frame && frame.entry.kind !== 'opening' && frame.entry.kind !== 'closing' && frame.entry.kind !== 'result' && <span key={frame.index}>
              {frame.entry.text}
              {frame.entry.amount === undefined ? '' : ` · ${frame.entry.kind === 'heal' ? '+' : '−'}${hp(frame.entry.amount)} HP`}</span>}
          </div>
          <BoardRow enemy={false} field={view.own.field} selected={selected} highlighted={targeted} active={active}
            onUnit={selectUnit}
            onEmpty={slot => selected && changeSlot(selected, slot)} onDrop={prep ? changeSlot : undefined}
            onHp={unitDetail} frame={slotFrame} taunt={view.own.skills.includes(taunt)} battle={battle} canDrag={prep} />
          <div className="player-bar">
            <span className="avatar" aria-hidden="true">◆</span><strong>我方</strong>
            <button className="life" title="我方玩家生命明细" onClick={() => playerDetail(view.side)}>♥ {view.own.hp}/{hpLimit}</button>
            <span className="stat">速度 <b>{ownSpeed}</b></span>
            <SkillIcons ids={view.own.skills} />
            <span className="player-turn">{battle ? view.first === view.side ? '先手' : '后手' : view.own.ready ? '已准备' : '准备中'}</span>
          </div>
          <Bench view={view} enabled={prep} change={commit} selected={selected} onUnit={selectUnit} />
        </section>
        {view.phase === 'prep' && !frame && <Prep key={view.battle} view={view} change={change} onPreview={setPreview} />}
        {battle && <section className="combat-controls">
          <div><h2>{selectedUnit ? definition(selectedUnit).name : '行动'}</h2>
            <small className="muted">{frame ? '正在播放当前行动' : currentAction ?? (turn ? '选择一名尚未行动的从者' : '等待对手完成当前行动')}</small>
          </div>
          <div className="inline-actions">
            {attacks.length > 0 && <button className="primary" title="选择普通攻击目标" onClick={() => chooseMode('attack')}>攻击</button>}
            {abilities.length > 0 && <button title={selectedUnit ? definition(selectedUnit).abilities.find(ability => ability.kind === 'active')?.text : '主动技'}
              onClick={() => chooseMode('ability')}>主动技</button>}
            {arcane.length > 0 && <button title="奥术魔术师二星免费技能" onClick={() => chooseMode('arcane')}>免费换位</button>}
            {byUnit.find(intent => intent.type === 'skip') && <button title="消耗所选从者的行动" onClick={() => commit(byUnit.find(intent => intent.type === 'skip')!)}>跳过</button>}
            {!selectedUnit && turn && <button className="quiet" title="跳过第一个没有攻击目标的从者"
              disabled={!legal.some(intent => intent.type === 'skip')} onClick={() => commit(legal.find(intent => intent.type === 'skip')!)}>结束小轮</button>}
          </div>
          <b className="gold">{view.own.lp} lp</b>
        </section>}
      </div>
    </div>
    {(frame?.entry.kind === 'opening' || frame?.entry.kind === 'closing') &&
      <BattleCeremony key={frame.index} frame={frame} />}
    {frame?.entry.kind === 'result' && <BattleOutcome key={frame.index} frame={frame} side={view.side} />}
    {confirmation && turn && <ActionConfirmation key={confirmation.requestId}
      intent={confirmation.intent} side={view.side} reply={forecast?.requestId === confirmation.requestId ? forecast : undefined}
      cancel={() => setConfirmation(undefined)} execute={() => commit(confirmation.intent)} />}
    {detail && <HealthDetails title={detail.title} onClose={() => setDetail(undefined)} entries={
      detail.player === undefined ? view.log.filter(entry => entry.unit === detail.unit && entry.kind === 'damage') : resultFor(detail.player)} />}
    {view.pending && !detail && <Modal title={view.pending.label}>
      <div className="inline-actions">{view.pending.options.map(option => <button className="primary" key={option.value}
        onClick={() => change({ type: 'choose', value: option.value })} title={option.label}>{option.label}</button>)}</div>
      {!view.pending.options.length && <p className="muted">对方正在结算效果。</p>}
    </Modal>}
    {view.phase === 'finished' && !detail && <Modal title={message} onClose={exit}>
      <p>共 {view.battle} 场战斗 · 我方 {view.own.hp} HP · 敌方 {view.opponent.hp} HP</p>
      <div className="inline-actions"><button className="primary" title="以相同模式再来一局" onClick={restart}>再来一局</button>
        <button title="返回主菜单" onClick={exit}>返回主菜单</button></div>
    </Modal>}
  </main>;
}

function ceremonyStyle(frame: BattleFrame) {
  return { '--ceremony-duration': `${frame.duration}ms` } as CSSProperties;
}

function BattleCeremony({ frame }: { frame: BattleFrame }) {
  return <div className="battle-opening" role="status" data-stage={frame.entry.kind} style={ceremonyStyle(frame)}>
    <div className="opening-insignia" aria-hidden="true">◇</div>
    <strong>{frame.entry.text}</strong>
    <div className="opening-particles" aria-hidden="true">
      {Array.from({ length: 18 }, (_, index) => <i key={index} style={{ rotate: `${20 * index}deg` }} />)}
    </div>
  </div>;
}

function BattleOutcome({ frame, side }: { frame: BattleFrame; side: Side }) {
  const { player, amount, before, after } = frame.entry;
  const outcome = player === undefined ? 'draw' : player === side ? 'loss' : 'win';
  return <div className="battle-outcome" data-outcome={outcome} role="status" style={ceremonyStyle(frame)}>
    <div className="battle-outcome-panel">
      <span>第 {frame.entry.battle} 场</span>
      <strong>{outcome === 'draw' ? '本场平局' : outcome === 'loss' ? '我方失败' : '我方获胜'}</strong>
      {player === undefined ? <p>双方血量 ±0</p> :
        <p>{player === side ? '我方' : '敌方'}血量 <b>−{hp(amount ?? 0)}</b>
          {before !== undefined && after !== undefined && <span> · {hp(before)} → {hp(after)}</span>}</p>}
    </div>
  </div>;
}

function ActionConfirmation({ intent, side, reply, cancel, execute }: {
  intent: ForecastIntent; side: Side; reply?: ForecastReply; cancel: () => void; execute: () => void;
}) {
  const label = intent.type === 'attack' ? '攻击' : '技能';
  return <Modal title={`确认${label}`} onClose={cancel} className="forecast-dialog">
    {!reply && <p role="status">正在预估伤害与效果…</p>}
    {reply?.type === 'forecastError' && <p role="alert" className="damage">{reply.message}</p>}
    {reply?.type === 'forecast' && <>
      <h3>预计效果</h3>
      <ul className="forecast-events">
        {reply.forecast.events.map((event, index) => <li key={index}>
          <span>{event.player === undefined ? '' : event.player === side ? '我方 · ' : '敌方 · '}{event.text}</span>
          {event.amount !== undefined && <strong className={event.kind === 'heal' ? 'healing' : 'damage'}>
            {event.kind === 'heal' ? '+' : '−'}{hp(event.amount)} HP · {hp(event.before!)} → {hp(event.after!)}
          </strong>}
        </li>)}
      </ul>
      {reply.forecast.decision && <p className="gold">后续取决于玩家选择：{reply.forecast.decision}</p>}
    </>}
    <div className="forecast-actions">
      <button className="quiet" onClick={cancel}>取消</button>
      <button className="primary" disabled={reply?.type !== 'forecast'} onClick={execute}>确定{label}</button>
    </div>
  </Modal>;
}
