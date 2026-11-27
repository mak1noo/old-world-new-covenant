import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { constants } from '../../shared/src/cards';
import type { ClientMessage, ForecastReply, RoomRole, RoomStatus, ServerMessage } from '../../shared/src/protocol';
import type { ForecastIntent } from '../../shared/src/game';
import { Match } from './Match';
import { Account } from './Account';
import { Modal } from './components';
import { CardGuide } from './CardGuide';
import { useMatchPlayback } from './playback';
import './style.css';
import './realm.css';

const normalizeRoom = (value: string) => value.trim().replace(/\s/g, '');
type GameRequest = Extract<ClientMessage, { type: 'create' | 'join' | 'solo' }>;

function App() {
  const socket = useRef<WebSocket>(undefined);
  const lastRequest = useRef<GameRequest>(undefined);
  const queued = useRef<GameRequest>(undefined);
  const session = useRef<string>(undefined);
  const roomRef = useRef<RoomStatus>(undefined);
  const reconnectTimer = useRef<number>(undefined);
  const retryDelay = useRef(500);
  const recovering = useRef(false);
  const [roomStatus, setRoomStatus] = useState<RoomStatus>();
  const [connected, setConnected] = useState(false);
  const [room, setRoom] = useState('');
  const [lobby, setLobby] = useState('');
  const [startingHp, setStartingHp] = useState(String(constants.playerHp));
  const [menuMode, setMenuMode] = useState<'solo' | 'online'>();
  const [notice, setNotice] = useState('');
  const [panel, setPanel] = useState<'rules' | 'guide' | 'settings'>();
  const [motion, setMotion] = useState(() => localStorage.getItem('covenant-motion') !== 'off');
  const { presentation, receive, clear } = useMatchPlayback(motion);
  const [forecast, setForecast] = useState<ForecastReply>();
  const forecastSequence = useRef(0);
  const noticeTimer = useRef<number>(undefined);
  const generation = useRef(0);
  const toast = (message: string) => {
    setNotice(message);
    window.clearTimeout(noticeTimer.current);
    noticeTimer.current = window.setTimeout(() => setNotice(''), 4200);
  };
  function resetRoom() {
    session.current = undefined;
    roomRef.current = undefined;
    recovering.current = false;
    clear();
    setLobby('');
    setRoomStatus(undefined);
    setForecast(undefined);
  }
  function syncConnected() {
    recovering.current = false;
    retryDelay.current = 500;
    setConnected(true);
  }
  function open() {
    if (socket.current && socket.current.readyState <= WebSocket.OPEN) return;
    window.clearTimeout(reconnectTimer.current);
    const scheme = location.protocol === 'https:' ? 'wss' : 'ws';
    const current = new WebSocket(`${scheme}://${location.host}/ws`);
    socket.current = current;
    const id = ++generation.current;
    current.onopen = () => {
      if (id !== generation.current) return;
      if (session.current) {
        recovering.current = true;
        current.send(JSON.stringify({ type: 'resume', token: session.current }));
      } else {
        syncConnected();
        if (queued.current) {
          current.send(JSON.stringify(queued.current));
          queued.current = undefined;
        }
      }
    };
    current.onmessage = event => {
      if (id !== generation.current) return;
      const message = JSON.parse(event.data as string) as ServerMessage;
      switch (message.type) {
        case 'session': session.current = message.token; break;
        case 'room': roomRef.current = message.room; setRoomStatus(message.room); break;
        case 'state':
          receive(message, recovering.current || roomRef.current?.role === 'spectator');
          if (recovering.current) syncConnected();
          setLobby('');
          break;
        case 'lobby':
          if (recovering.current) syncConnected();
          setLobby(message.code);
          break;
        case 'forecast': case 'forecastError':
          if (message.requestId === forecastSequence.current) setForecast(message);
          break;
        case 'error': toast(message.message); break;
        case 'resumeError': case 'disconnected':
          resetRoom();
          syncConnected();
          toast(message.message ?? '房间已关闭');
          break;
      }
    };
    current.onclose = event => {
      if (id !== generation.current) return;
      setConnected(false);
      if (event.reason === 'Session resumed') {
        resetRoom();
        toast('战斗席已在另一连接恢复');
      } else if (!session.current) resetRoom();
      else toast('连接中断，正在恢复席位');
      reconnectTimer.current = window.setTimeout(open, retryDelay.current);
      retryDelay.current = Math.min(retryDelay.current * 2, 8000);
    };
  }
  useEffect(() => {
    open();
    return () => {
      generation.current++;
      socket.current?.close();
      window.clearTimeout(noticeTimer.current);
      window.clearTimeout(reconnectTimer.current);
    };
  }, []);
  useEffect(() => {
    localStorage.setItem('covenant-motion', motion ? 'on' : 'off');
    document.documentElement.dataset.motion = motion ? 'on' : 'off';
  }, [motion]);

  function refreshConnection() {
    const current = socket.current;
    generation.current++;
    socket.current = undefined;
    current?.close();
    setConnected(false);
    open();
  }

  function send(message: ClientMessage) {
    if (socket.current?.readyState === WebSocket.OPEN && !recovering.current) socket.current.send(JSON.stringify(message));
    else if (message.type === 'create' || message.type === 'join' || message.type === 'solo') {
      queued.current = message;
      open();
    } else toast('连接不可用');
  }
  function requestForecast(intent: ForecastIntent): number {
    const requestId = ++forecastSequence.current;
    if (connected && !roomStatus?.paused) {
      setForecast(undefined);
      send({ type: 'forecast', requestId, intent });
    } else {
      setForecast({ type: 'forecastError', requestId, message: '连接不可用' });
    }
    return requestId;
  }
  function start(request: GameRequest) {
    lastRequest.current = request;
    send(request);
  }
  function startWithHealth(request: Exclude<GameRequest, { type: 'join' }>) {
    const playerHp = Number(startingHp);
    if (Number.isSafeInteger(playerHp) && playerHp > 0) start({ ...request, playerHp });
    else toast('初始生命必须为正整数');
  }
  function exit() {
    queued.current = undefined;
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'leave' }));
    resetRoom();
    setMenuMode(undefined);
  }
  function restart() {
    const request = lastRequest.current;
    resetRoom();
    if (request?.type === 'solo') start(request);
    else start({ type: 'create', playerHp: presentation?.state.view.playerHpLimit });
  }
  async function copyRoom(code: string) {
    try {
      await navigator.clipboard.writeText(code);
      toast('房间码已复制');
    } catch { toast(`房间码 ${code}`); }
  }
  function join(role: RoomRole, code = normalizeRoom(room)) {
    if (/^\d{6}$/.test(code)) start({ type: 'join', code, role });
    else toast('请输入 6 位房间码');
  }
  const spectator = roomStatus?.role === 'spectator';
  const blocked = !connected || !!roomStatus?.paused;
  const connectionStatus = !connected ? '正在重新连接…' : roomStatus?.paused ? '战斗席玩家正在重新连接…' : undefined;
  return <>
    {presentation ? <Match view={presentation.state.view} legal={presentation.state.legal} frame={presentation.frame}
      requestForecast={requestForecast} forecast={forecast} spectator={spectator} blocked={blocked}
      room={roomStatus} connectionStatus={connectionStatus} copyRoom={copyRoom}
      change={intent => { if (!blocked && !spectator) send({ type: 'intent', intent }); }} exit={exit} restart={restart}
      openRules={() => setPanel('rules')} openGuide={() => setPanel('guide')} openSettings={() => setPanel('settings')} />
      : <main className="menu">
        <div className="menu-scene">
          <Account onSessionChange={refreshConnection} />
          <img className="menu-art" src="/art/main-menu.png" width={1585} height={992} alt="" />
          <h1 className="menu-title">
            <span className="menu-title-text">旧界新约 <span lang="en">New Covenant</span></span>
            <img className="menu-logo" src="/art/main-menu-logo.png" width={740} height={452} alt="" />
          </h1>
          <div className="menu-content">
            {lobby ? <section className="menu-panel lobby"><h2>联机大厅</h2>
              <p>{connectionStatus ?? (spectator ? '观战席 · 等待开战' : '战斗席 · 等待对手加入')}</p>
              <p>战斗席 {roomStatus?.seats ?? 1}/2 · 观战 {roomStatus?.spectators ?? 0} 人</p>
              <p>初始生命 {roomStatus?.playerHpLimit ?? constants.playerHp} HP / 人</p>
              <output className="room-code">{lobby}</output>
              <div className="inline-actions"><button className="primary" onClick={() => copyRoom(lobby)} title="复制六位房间码">复制房间码</button>
                {spectator && roomStatus.seats < 2 && <button disabled={blocked} onClick={() => join('player', lobby)}>改坐战斗席</button>}
                <button onClick={exit} title="离开房间并返回主菜单">返回</button></div>
            </section> : <div className="menu-options">
              <div className="menu-entries">
                <button aria-expanded={menuMode === 'solo'} aria-controls="solo-options"
                  onClick={() => setMenuMode(menuMode === 'solo' ? undefined : 'solo')}>开始游戏</button>
                <button aria-expanded={menuMode === 'online'} aria-controls="online-options"
                  onClick={() => setMenuMode(menuMode === 'online' ? undefined : 'online')}>对战联机</button>
              </div>
              <section id="solo-options" className="menu-panel" hidden={menuMode !== 'solo'} aria-label="单人对战">
                <StartingHpInput value={startingHp} change={setStartingHp} />
                <button className="primary" onClick={() => startWithHealth({ type: 'solo', difficulty: 'easy' })} title="与简单 AI 开始一局">简单 AI</button>
                <button onClick={() => startWithHealth({ type: 'solo', difficulty: 'hard' })} title="与困难 AI 开始一局">困难 AI</button>
              </section>
              <section id="online-options" className="menu-panel" hidden={menuMode !== 'online'} aria-label="房间联机">
                <StartingHpInput value={startingHp} change={setStartingHp} />
                <button className="primary" onClick={() => startWithHealth({ type: 'create' })} title="创建联机房间">创建房间</button>
                <form className="room-form" onSubmit={event => {
                  event.preventDefault();
                  join('player');
                }}><input aria-label="房间码" inputMode="numeric" maxLength={6} value={room} placeholder="六位房间码" onChange={event => setRoom(event.target.value)} />
                  <button type="submit">战斗席</button>
                  <button type="button" title="可查看双方牌区、LP 和操作" onClick={() => join('spectator')}>观战席</button></form>
              </section>
            </div>}
            <div className="menu-links"><button className="quiet" onClick={() => setPanel('rules')} title="查看规则">规则说明</button>
              <button className="quiet" onClick={() => setPanel('guide')}>卡牌图鉴</button>
              <button className="quiet" onClick={() => setPanel('settings')} title="打开设置">设置</button>
            </div>
            <div className="menu-connection">
              {connected ? <span className="muted"><i />已连接</span> : <span className="muted offline"><i />连接等待中</span>}
            </div>
          </div>
        </div>
      </main>}
    {panel === 'rules' && <Modal title="游戏规则" onClose={() => setPanel(undefined)}>
      <ul className="rules">
        <li>双方的初始生命默认各为 {constants.playerHp} HP，可在单机开局或联机建房时自定义。每场战斗败者扣血，每满 5 场扣血量增加 1。打满 50 场后比较剩余玩家生命。</li>
        <li>准备时，从自己的牌库抽 7 张手牌。三同号或三连号可升华，同号少一张可花 1 lp 补齐。</li>
        <li>升华时，a 可补数字，产物只能选原有的数字牌。3 + 5 + a 可补 4，产物只可选 3 或 5。数字牌加两张 a 可升华为该数字，三张未变号的 a 可升华为精灵。</li>
        <li>王权、命运、爱等技能变号后，牌的当前数字可用于凑数或补升华组合。升华产物只能选组合中的未变号牌。变回原号的牌在回库前仍仅作数字使用。</li>
        <li>凑十赚取 1 lp，商店每张 3 lp。升华区的卡可上阵、升星、融合或卖出。最多布置五名从者。</li>
        <li>任一方可在对方准备完成前取消准备。双方锁定后，行动点总和高者先手。连续 5 个完整战斗轮次均未造成伤害则平局。第 50 轮起，存活从者数量不同则按数量决胜，数量相同则继续交战。</li>
      </ul>
      <button onClick={() => setPanel('guide')}>查看卡牌图鉴</button>
    </Modal>}
    {panel === 'guide' && <CardGuide player={presentation?.state.view.own} onClose={() => setPanel(undefined)} />}
    {panel === 'settings' && <Modal title="设置" onClose={() => setPanel(undefined)}>
      <label><input type="checkbox" checked={motion} onChange={event => setMotion(event.target.checked)} /> 播放战斗动画</label>
    </Modal>}
    {notice && <div className="toast" role="status">{notice}</div>}
  </>;
}

function StartingHpInput({ value, change }: { value: string; change: (value: string) => void }) {
  return <label className="starting-hp">
    初始生命
    <input type="number" inputMode="numeric" min={1} max={Number.MAX_SAFE_INTEGER} step={1}
      value={value} onChange={event => change(event.target.value)} />
  </label>;
}

createRoot(document.getElementById('root')!).render(<App />);
