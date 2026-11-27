import type { CombatForecast, ForecastIntent, Intent } from './game';
import type { MatchView } from './view';

export type Difficulty = 'easy' | 'hard';
export type ClientMessage =
  | { type: 'solo'; difficulty: Difficulty }
  | { type: 'create' }
  | { type: 'join'; code: string }
  | { type: 'leave' }
  | { type: 'forecast'; requestId: number; intent: ForecastIntent }
  | { type: 'intent'; intent: Intent };
export type ServerMessage =
  | { type: 'lobby'; code: string }
  | { type: 'state'; view: MatchView; legal: Intent[] }
  | { type: 'forecast'; requestId: number; forecast: CombatForecast }
  | { type: 'forecastError'; requestId: number; message: string }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };

export type ForecastReply = Extract<ServerMessage, { type: 'forecast' | 'forecastError' }>;
