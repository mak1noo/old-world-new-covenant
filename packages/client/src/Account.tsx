import { useEffect, useState, type FormEvent } from 'react';
import { Modal } from './components';

type AccountReply = { name?: string | null; error?: string };

export function Account({ onSessionChange }: { onSessionChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const request = new AbortController();
    fetch('/api/account', { signal: request.signal }).then(async response => {
      if (response.ok) setAccount(((await response.json()) as AccountReply).name ?? null);
    }).catch(() => {});
    return () => request.abort();
  }, []);

  async function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/account/${account === null ? mode : 'logout'}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(account === null ? { name, password } : {}),
      });
      const reply: AccountReply = await response.json();
      if (!response.ok) throw new Error(reply.error ?? '账号操作失败');
      setAccount(reply.name ?? null);
      onSessionChange();
      setMode('login');
      setPassword('');
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '账号操作失败');
    } finally {
      setBusy(false);
    }
  }

  const close = () => {
    if (busy) return;
    setOpen(false);
    setPassword('');
    setError('');
  };

  return <>
    <button className="account-entry" aria-label="账号" title={account ?? '登录或注册'} onClick={() => setOpen(true)}>
      <span aria-hidden="true">👤</span>{account !== null && <span className="account-name">{account}</span>}
    </button>
    {open && <Modal title={account !== null ? '账号' : mode === 'login' ? '登录账号' : '注册账号'} onClose={close}>
      {account !== null ? <>
        <p className="account-signed-in">{account}</p>
        <button onClick={() => submit()} disabled={busy}>退出登录</button>
      </> : <form className="account-form" onSubmit={submit}>
        <label>账号名称<input required autoComplete="username" value={name} onChange={event => setName(event.target.value)} /></label>
        <label>密码<input type="password" required autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
          value={password} onChange={event => setPassword(event.target.value)} /></label>
        <div className="inline-actions">
          <button className="primary" type="submit" disabled={busy}>{mode === 'login' ? '登录' : '注册'}</button>
          <button type="button" disabled={busy} onClick={() => {
            setMode(mode === 'login' ? 'register' : 'login');
            setPassword('');
            setError('');
          }}>{mode === 'login' ? '注册账号' : '返回登录'}</button>
        </div>
      </form>}
      {error && <p role="alert" className="damage">{error}</p>}
    </Modal>}
  </>;
}
