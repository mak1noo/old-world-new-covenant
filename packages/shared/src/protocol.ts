import type { CombatForecast, ForecastIntent, Intent } from './game';
import type { MatchView } from './view';

export type Difficulty = 'easy' | 'hard';
export type RoomRole = 'player' | 'spectator';
export type RoomStatus = { code: string; role: RoomRole; seats: number; spectators: number; paused: boolean; playerHpLimit: number };
export const reconnectGraceMs = 45_000;
export type ClientMessage =
  | { type: 'solo'; difficulty: Difficulty; playerHp?: number }
  | { type: 'create'; playerHp?: number }
  | { type: 'join'; code: string; role?: RoomRole }
  | { type: 'resume'; token: string }
  | { type: 'leave' }
  | { type: 'forecast'; requestId: number; intent: ForecastIntent }
  | { type: 'intent'; intent: Intent };
export type ServerMessage =
  | { type: 'lobby'; code: string }
  | { type: 'room'; room: RoomStatus }
  | { type: 'session'; token: string }
  | { type: 'resumeError'; message: string }
  | { type: 'state'; view: MatchView; legal: Intent[] }
  | { type: 'forecast'; requestId: number; forecast: CombatForecast }
  | { type: 'forecastError'; requestId: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected'; message?: string };

export type ForecastReply = Extract<ServerMessage, { type: 'forecast' | 'forecastError' }>;
