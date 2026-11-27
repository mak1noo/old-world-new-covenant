import { other, speed, type Game, type Player, type Side } from './game';

export type PublicPlayer = Pick<Player, 'hp' | 'field' | 'skills' | 'ready'> & { benchCount: number; speed: number };
export type PublicBoard = [PublicPlayer, PublicPlayer];
export type SpectatorInventory = Pick<Player, 'lp' | 'hand' | 'shop' | 'bench'>;
export type MatchView = {
  side: Side; phase: Game['phase']; battle: number; round: number; first: Side; active: Side; winner: Side | null;
  own: Omit<Player, 'deck' | 'won'>;
  opponent: PublicPlayer;
  log: Game['log'];
  observedOpponent?: SpectatorInventory;
  pending?: { label: string; side: Side; options: { value: number; label: string }[] };
};
export function publicPlayer(player: Player): PublicPlayer {
  return { hp: player.hp, field: structuredClone(player.field), skills: [...player.skills], ready: player.ready,
    benchCount: player.bench.length, speed: speed(player) };
}
export function captureBoard(game: Game): PublicBoard {
  return [publicPlayer(game.players[0]), publicPlayer(game.players[1])];
}
export function viewFor(game: Game, side: Side, snapshot: PublicBoard): MatchView {
  const rival = other(side);
  const player = game.players[side];
  const { deck: _deck, won: _won, ...own } = player;
  const opening = game.pending?.originalIntent.type === 'ready';
  const opponent = game.phase === 'prep' && !opening ? { ...snapshot[rival], hp: game.players[rival].hp, ready: game.players[rival].ready }
    : { ...publicPlayer(game.players[rival]), ready: opening || game.players[rival].ready };
  const { phase, battle, round, first, active, winner, log } = game;
  const pending = game.pending && {
    label: game.pending.side === side ? game.pending.label : '等待对手选择',
    side: game.pending.side, options: game.pending.side === side ? game.pending.options : [],
  };
  return { side, phase, battle, round, first, active, winner, own, opponent, log, pending };
}
export function spectatorView(game: Game, log: Game['log']): MatchView {
  const view = viewFor(game, 0, captureBoard(game));
  const { lp, hand, shop, bench } = game.players[1];
  if (game.pending?.originalIntent.type === 'ready') view.own.ready = true;
  const pending = game.pending && { side: game.pending.side, label: game.pending.label, options: game.pending.options };
  return { ...view, log, pending, observedOpponent: { lp, hand, shop, bench } };
}
export function visibleSimulation(game: Game, side: Side, snapshot: PublicBoard): Game {
  const view = viewFor(game, side, snapshot);
  const rival = other(side);
  const players = [] as unknown as Game['players'];
  players[side] = { ...structuredClone(view.own), deck: [], won: false };
  players[rival] = { ...structuredClone(view.opponent), lp: 0, deck: [], hand: [], shop: [], bench: [],
    won: false, loveUsed: false, resetUsed: false, aSlot: null };
  return { players, phase: view.phase, battle: view.battle, round: view.round, first: view.first, active: view.active,
    winner: view.winner, rng: 1, nextId: 1000000, nextUnitId: [1000001, 1000002], progress: game.progress, noDamageRounds: game.noDamageRounds, log: [] };
}
