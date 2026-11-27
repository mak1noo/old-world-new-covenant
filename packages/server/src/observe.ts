import { cardById, cardBySerial, positions, skillById } from '../../shared/src/cards';
import { definition, other, units, type Game, type Intent, type LogEntry, type RawCard, type Side } from '../../shared/src/game';

export function observedAction(game: Game, side: Side, intent: Intent): LogEntry {
  const player = game.players[side];
  const friendly = [...units(player), ...player.bench];
  const unitsById = new Map([...friendly, ...units(game.players[other(side)])].map(unit => [unit.id, unit]));
  const handById = new Map(player.hand.map(card => [card.id, card]));
  const rawName = (card?: RawCard | null) => card ? `${card.serial} ${cardBySerial.get(card.serial)!.name}` : '空位';
  const handNames = (ids: number[]) => ids.map(id => rawName(handById.get(id))).join('、');
  const unitName = (id: number) => {
    const unit = unitsById.get(id);
    return unit ? `${definition(unit).name} ${unit.star}星` : '范围目标';
  };
  const unitNames = (ids: number[]) => ids.map(unitName).join('、');

  function describe(action: Intent): string {
    switch (action.type) {
      case 'ready': return '准备完成';
      case 'unready': return '取消准备';
      case 'refresh': return '刷新商店';
      case 'buy': return `购买 ${rawName(player.shop[action.slot])}`;
      case 'sublimate': return `升华 ${handNames(action.ids)} → ${cardBySerial.get(action.serial)!.name}`;
      case 'sum': return `用 ${handNames(action.ids)} 凑 ${action.total}`;
      case 'place': {
        const position = positions.order[action.slot] as keyof typeof positions.namesZh;
        const occupant = player.field[action.slot];
        const unit = unitName(action.id);
        if (occupant?.id === action.id) return `保持 ${unit} 在${positions.namesZh[position]}位`;
        return occupant ? `${unit} 与 ${unitName(occupant.id)} 交换站位` : `将 ${unit} 放到${positions.namesZh[position]}位`;
      }
      case 'bench': return `收回 ${unitName(action.id)} 到升华区`;
      case 'sell': return `出售 ${unitName(action.id)}`;
      case 'alchemy': return `炼金 ${unitName(action.id)}`;
      case 'decompose': return `炼心 ${unitName(action.id)}`;
      case 'fuse': return `融合 ${unitNames(action.ids)} → ${cardById.get(action.card)!.name}`;
      case 'star': return `升星 ${unitNames(action.ids)}`;
      case 'reset': return `重抽 ${handNames(action.ids)}`;
      case 'skill': return `购买固有技能 ${skillById.get(action.skill)!.name}`;
      case 'change': return `用${skillById.get(action.skill)!.name}将 ${rawName(handById.get(action.id))} 改为 ${action.serial}`;
      case 'attack': return action.target && unitsById.has(action.target) ? `${unitName(action.id)} 攻击 ${unitName(action.target)}` : `${unitName(action.id)} 发起范围攻击`;
      case 'skip': return `跳过 ${unitName(action.id)} 的行动`;
      case 'ability': {
        const targets = [action.target, action.ally].flatMap(id => id && unitsById.has(id) ? [id] : []);
        return `${unitName(action.id)} 发动主动技${targets.length ? ` · ${unitNames(targets)}` : ''}`;
      }
      case 'arcane': return `${unitName(action.id)} 将 ${unitNames([action.first, action.second])} 交换站位`;
      case 'choose': return `${game.pending!.label} · ${game.pending!.options.find(option => option.value === action.value)!.label}`;
      case 'surrender': return '投降本场战斗';
    }
  }

  return { kind: 'action', battle: game.battle, round: game.round, player: side, text: describe(intent) };
}
