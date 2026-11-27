import { useEffect, useRef, useState } from 'react';
import type { LogEntry, Unit } from '../../shared/src/game';
import type { ServerMessage } from '../../shared/src/protocol';
import type { MatchView } from '../../shared/src/view';

type MatchState = Extract<ServerMessage, { type: 'state' }>;
export type BattleFrame = { entry: LogEntry; index: number; duration: number };
type Presentation = { state: MatchState; frame?: BattleFrame };

const durationByKind: Record<LogEntry['kind'], number> = {
  action: 500,
  effect: 560,
  damage: 710,
  heal: 620,
  destroy: 610,
  summon: 650,
  move: 640,
  round: 480,
  opening: 2350,
  closing: 2350,
  result: 3200,
};

function showEvent(view: MatchView, entry: LogEntry): MatchView {
  const round = view.phase === 'battle' && entry.battle === view.battle ? entry.round : view.round;
  const next = { ...view, round, log: [...view.log, entry] };
  if (entry.player === undefined) return next;
  const own = entry.player === view.side;
  if (entry.kind === 'result' && entry.after !== undefined) {
    if (own) next.own = { ...view.own, hp: entry.after };
    else next.opponent = { ...view.opponent, hp: entry.after };
    return next;
  }
  const current = own ? view.own.field : view.opponent.field;
  let field: (Unit | null)[] | undefined;
  if (entry.summoned) {
    field = [...current];
    field[entry.summoned.slot] = entry.summoned.unit;
  } else if (entry.swap) {
    field = [...current];
    const [first, second] = entry.swap;
    [field[first], field[second]] = [field[second], field[first]];
  } else if (entry.unit !== undefined && entry.after !== undefined) {
    const hp = entry.after;
    field = current.map(unit => unit && unit.id === entry.unit ? { ...unit, hp } : unit);
  }
  if (field) {
    if (own) next.own = { ...view.own, field };
    else next.opponent = { ...view.opponent, field };
  }
  return next;
}

function removeDestroyed(view: MatchView, entry: LogEntry): MatchView {
  if (entry.kind !== 'destroy') return view;
  if (entry.player === view.side) {
    return { ...view, own: { ...view.own, field: view.own.field.map(unit => unit?.id === entry.unit ? null : unit) } };
  }
  return { ...view, opponent: { ...view.opponent, field: view.opponent.field.map(unit => unit?.id === entry.unit ? null : unit) } };
}

export function useMatchPlayback(motion: boolean) {
  const [presentation, setPresentation] = useState<Presentation>();
  const committed = useRef<MatchState>(undefined);
  const playing = useRef<MatchState>(undefined);
  const queue = useRef<MatchState[]>([]);
  const timer = useRef<number>(undefined);
  const enabled = useRef(motion);

  function commit(state: MatchState) {
    committed.current = state;
    setPresentation({ state });
  }
  function pump() {
    if (playing.current) return;
    const state = queue.current.shift();
    if (!state) return;
    const previous = committed.current;
    const entries = previous ? state.view.log.slice(previous.view.log.length) : [];
    if (!enabled.current || !previous || !entries.length) {
      commit(state);
      pump();
      return;
    }
    playing.current = state;
    const board = previous.view.phase === 'prep' && state.view.phase === 'battle' ? state.view : previous.view;
    let view: MatchView = { ...board, pending: undefined, log: previous.view.log };
    let step = 0;
    function advance() {
      const entry = entries[step++];
      if (!entry) {
        playing.current = undefined;
        timer.current = undefined;
        commit(state!);
        pump();
        return;
      }
      view = showEvent(view, entry);
      const duration = durationByKind[entry.kind];
      setPresentation({ state: { type: 'state', view, legal: [] }, frame: { entry, index: view.log.length, duration } });
      timer.current = window.setTimeout(() => {
        view = removeDestroyed(view, entry);
        advance();
      }, duration);
    }
    advance();
  }
  function receive(state: MatchState) {
    queue.current.push(state);
    pump();
  }
  function clear() {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    playing.current = undefined;
    committed.current = undefined;
    queue.current = [];
    setPresentation(undefined);
  }

  useEffect(() => {
    enabled.current = motion;
    if (motion) return;
    const latest = queue.current.at(-1) ?? playing.current;
    if (!latest) return;
    window.clearTimeout(timer.current);
    timer.current = undefined;
    playing.current = undefined;
    queue.current = [];
    commit(latest);
  }, [motion]);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  return { presentation, receive, clear };
}
