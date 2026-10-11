import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, date, stateLabel } from './api';
import { checkIn } from './device';
import { QrScanner } from './scanner';

type User = { id: number; name: string; email: string; role: string };
type Auth = { access_token: string; user: User };
type Own = { status: string; method: string; updated_at: string };
type ClassSession = { id: number; course_id: number; course_title: string; title: string; room_code: string; starts_at: string; ends_at: string; state: 'ready' | 'checkin_pending' | 'active' | 'paused' | 'ended'; attendance: Own | null; pending_review: boolean };
type Resource = { id: number; title: string; url: string; kind: 'pdf' | 'text'; downloadable: boolean };
type HistoryRow = Own & { session_id: number; session: ClassSession };
type DataRequest = { id: number; session_id: number | null; kind: 'correction' | 'deletion'; reason: string; status: string; resolution: string | null };
type FocusRequest = { id: number; kind: 'exit' | 'resume'; status: 'pending' | 'approved' | 'denied' };
type FocusState = 'off' | 'active' | 'paused' | 'left' | 'exited' | 'ended';

const STORAGE = 'focuslock-student';
const isOpen = (s: ClassSession) => s.state === 'checkin_pending' || s.state === 'active';
const attendanceLabel = (s: ClassSession) => s.attendance ? s.attendance.status.replace(/^./, c => c.toUpperCase()) : s.pending_review ? 'Pending teacher review' : 'Not recorded';
const attendanceClass = (s: ClassSession) => s.attendance ? s.attendance.status : s.pending_review ? 'pending' : '';

function loadAuth(): Auth | null {
  try { const raw = sessionStorage.getItem(STORAGE); return raw ? JSON.parse(raw) as Auth : null; } catch { return null; }
}

export function StudentApp() {
  const [auth, setAuthState] = useState<Auth | null>(loadAuth);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [view, setView] = useState<'today' | 'history'>('today');
  const [sessionId, setSessionId] = useState<number | null>(null);
  const setAuth = (value: Auth | null) => {
    try { if (value) sessionStorage.setItem(STORAGE, JSON.stringify(value)); else sessionStorage.removeItem(STORAGE); } catch { /* storage blocked: stay signed in for this page only */ }
    setAuthState(value);
  };
  useEffect(() => { api<{ development_login: boolean }>('/auth/config').then(c => setEnabled(c.development_login)).catch(() => setEnabled(false)); }, []);
  async function signOut() {
    try { if (auth) await api('/auth/logout', auth.access_token, { method: 'POST' }); } catch { /* token expires on its own */ }
    setAuth(null); setSessionId(null); setView('today');
  }
  const expired = useCallback(() => setAuth(null), []);
  return <div className="student">
    <header><div className="brand">FocusLock<span>STUDENT</span></div>{auth && <div className="account">{auth.user.name}<button className="secondary" onClick={() => void signOut()}>Sign out</button></div>}</header>
    {enabled && <div className="dev-banner">DEMO · Sample accounts and courses. Do not enter real student data.</div>}
    <main className="student-shell">
      {!auth ? <StudentLogin enabled={enabled} onSignedIn={setAuth}/>
        : sessionId !== null ? <SessionView auth={auth} sessionId={sessionId} onBack={() => setSessionId(null)} onExpired={expired}/>
        : view === 'today' ? <Today auth={auth} onOpen={setSessionId} onExpired={expired}/>
        : <History auth={auth} onExpired={expired}/>}
    </main>
    {auth && sessionId === null && <nav className="bottom-nav" aria-label="Student sections">
      <button className={view === 'today' ? 'active' : ''} onClick={() => setView('today')}>Today</button>
      <button className={view === 'history' ? 'active' : ''} onClick={() => setView('history')}>History</button>
    </nav>}
    <footer>Your phone remains yours. Attendance and voluntary focus are separate, and your teacher can confirm attendance without the camera.</footer>
  </div>;
}

function StudentLogin({ enabled, onSignedIn }: { enabled: boolean | null; onSignedIn: (auth: Auth) => void }) {
  const [email, setEmail] = useState('student@focuslock.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Auth>('/auth/dev-login', undefined, { method: 'POST', body: JSON.stringify({ email, password }) });
      if (result.user.role !== 'student') {
        await api('/auth/logout', result.access_token, { method: 'POST' }).catch(() => undefined);
        throw new Error('This is the student app. Teachers sign in at the main page.');
      }
      onSignedIn(result);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card">
    <p className="eyebrow">Student sign-in</p><h1>Today’s classes</h1>
    {enabled === false ? <p>Students sign in with the FocusLock Android app using their college account.</p> :
      <form onSubmit={submit}>
        <label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
        <label>Demo password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>
        <button disabled={busy || enabled === null}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>}
    {error && <p className="error" role="alert">{error}</p>}
    <p className="hint">Teacher? <a href="/">Open the teacher workspace</a>.</p>
  </section>;
}

function usePoll<T>(load: () => Promise<T>, onExpired: () => void, every = 5000) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const loadRef = useRef(load);
  loadRef.current = load;
  const refresh = useCallback(async () => {
    try { setData(await loadRef.current()); setError(''); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError((e as Error).message); }
  }, [onExpired]);
  useEffect(() => { void refresh(); const timer = setInterval(() => void refresh(), every); return () => clearInterval(timer); }, [refresh, every]);
  return { data, error, refresh };
}

function Today({ auth, onOpen, onExpired }: { auth: Auth; onOpen: (id: number) => void; onExpired: () => void }) {
  const { data, error } = usePoll(() => api<ClassSession[]>('/sessions', auth.access_token), onExpired);
  const sessions = (data ?? []).filter(s => s.state !== 'ended').sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.starts_at.localeCompare(b.starts_at));
  return <section>
    <p className="eyebrow">Hello, {auth.user.name.split(' ')[0]}</p><h1>Today’s classes</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {data === null ? <p role="status">Loading your classes…</p> : !sessions.length ? <div className="card"><p>No upcoming classes. Past attendance is in History.</p></div> :
      sessions.map(s => <button key={s.id} className={`card class-card ${isOpen(s) ? 'open' : ''}`} onClick={() => onOpen(s.id)}>
        <span className={`state-badge state-${s.state}`}>{stateLabel(s.state)}</span>
        <strong>{s.title}</strong><small>{s.course_title} · Room {s.room_code}</small><small>{date(s.starts_at)}</small>
        <span className={`status ${attendanceClass(s)}`}>{attendanceLabel(s)}</span>
        {isOpen(s) && !s.attendance && <span className="cta">Check in now →</span>}
      </button>)}
  </section>;
}

function SessionView({ auth, sessionId, onBack, onExpired }: { auth: Auth; sessionId: number; onBack: () => void; onExpired: () => void }) {
  const token = auth.access_token;
  const { data: session, error: loadError, refresh } = usePoll(() => api<ClassSession>(`/sessions/${sessionId}`, token), onExpired, 4000);
  const [resources, setResources] = useState<Resource[]>([]);
  const [step, setStep] = useState<'idle' | 'disclosure' | 'scan' | 'review'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { api<Resource[]>(`/sessions/${sessionId}/resources`, token).then(setResources).catch(() => setResources([])); }, [sessionId, token, session?.state]);

  async function scanned(qr: string) {
    setStep('idle'); setBusy(true); setError(''); setNotice('Checking you in…');
    try {
      const result = await checkIn(auth.user.id, token, qr);
      setNotice(result.duplicate ? 'You were already checked in.' : 'Checked in. Your attendance is recorded as present.');
      await refresh();
    } catch (e) { setNotice(''); setError((e as Error).message); } finally { setBusy(false); }
  }
  async function requestReview(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`/sessions/${sessionId}/pending`, token, { method: 'POST', body: JSON.stringify({ reason: reason.trim() }) });
      setStep('idle'); setReason(''); setNotice('Sent. Your teacher can confirm your attendance.');
      await refresh();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  if (!session) return <section><button className="link" onClick={onBack}>← Back</button>{loadError ? <p className="error" role="alert">{loadError}</p> : <p role="status">Loading…</p>}</section>;
  const canCheckIn = isOpen(session) && !session.attendance && new Date(session.ends_at) > new Date();
  const focusEligible = session.attendance?.method === 'qr' && session.attendance.status === 'present';
  return <section>
    <button className="link" onClick={onBack}>← Today’s classes</button>
    <div className="card banner"><span className={`state-badge state-${session.state}`}>{stateLabel(session.state)}</span><h2>{session.title}</h2><p>{session.course_title} · Room {session.room_code}</p><p>{date(session.starts_at)} — {date(session.ends_at)}</p></div>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}

    <div className="card">
      <h3>Attendance</h3>
      <p><span className={`status ${attendanceClass(session)}`}>{attendanceLabel(session)}</span>{session.attendance && <small>{session.attendance.method === 'qr' ? 'QR check-in' : 'Teacher-confirmed'}</small>}</p>
      {canCheckIn ? <>
        {session.pending_review && <p className="hint">Your request is waiting for your teacher. You can still scan if you are in class.</p>}
        <div className="actions"><button disabled={busy} onClick={() => setStep('disclosure')}>Scan class QR</button>
          {!session.pending_review && <button className="secondary" disabled={busy} onClick={() => setStep('review')}>Can’t scan? Ask teacher</button>}</div>
      </> : !session.attendance && <p className="hint">{session.state === 'ready' ? 'Check-in opens when your teacher starts this class.' : session.state === 'paused' ? 'Class is paused. Check-in resumes when your teacher continues.' : 'Check-in is closed for this class.'}</p>}
      {step === 'review' && <form onSubmit={requestReview} className="confirmation">
        <label>Why can’t you scan? (at least 10 characters)<input required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)} placeholder="Camera broken, phone unsupported, or I prefer not to scan"/></label>
        <div className="actions"><button disabled={busy}>Send to teacher</button><button type="button" className="secondary" onClick={() => setStep('idle')}>Cancel</button></div>
      </form>}
    </div>

    {focusEligible && session.state !== 'ready' && <FocusPanel auth={auth} session={session}/>}

    <div className="card">
      <h3>Course resources</h3>
      {!resources.length ? <p className="hint">No resources attached to this class.</p> : resources.map(r => <p key={r.id} className="resource-row">
        <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a><small>{r.kind.toUpperCase()} · {r.downloadable ? 'Offline copy allowed' : 'View only'}</small></p>)}
    </div>

    {step === 'disclosure' && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Voluntary focus disclosure"><div className="modal">
      <p className="eyebrow">Before you check in</p><h3>Voluntary class focus</h3>
      <p>Checking in with the QR also starts voluntary focus while this class is active and this page is open.</p>
      <ul>
        <li>Pause works any time, even offline.</li>
        <li>Leaving this page with the screen on sends your teacher a neutral “left the page” flag for review. FocusLock cannot see other apps or why you left.</li>
        <li>Ending focus early needs your teacher’s current QR or approval.</li>
        <li>Focus never changes your attendance.</li>
      </ul>
      <div className="actions"><button onClick={() => setStep('scan')}>Accept and scan</button><button className="secondary" onClick={() => setStep('review')}>Decline · ask teacher instead</button></div>
    </div></div>}
    {step === 'scan' && <QrScanner title="Scan your class QR" onResult={qr => void scanned(qr)} onCancel={() => setStep('idle')}/>}
  </section>;
}

function FocusPanel({ auth, session }: { auth: Auth; session: ClassSession }) {
  const token = auth.access_token;
  const key = `focuslock-focus-${auth.user.id}-${session.id}`;
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as { state: FocusState; policy: string; exp: number } | null; } catch { return null; } })();
  const [state, setStateRaw] = useState<FocusState>(saved?.state ?? 'off');
  const policy = useRef<{ token: string; exp: number } | null>(saved ? { token: saved.policy, exp: saved.exp } : null);
  const [request, setRequest] = useState<FocusRequest | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  const stateRef = useRef(state);
  const setState = (next: FocusState) => {
    stateRef.current = next; setStateRaw(next);
    try { if (policy.current) sessionStorage.setItem(key, JSON.stringify({ state: next, policy: policy.current.token, exp: policy.current.exp })); } catch { /* best effort */ }
  };

  const newPolicy = useCallback(async () => {
    const result = await api<{ policy: string }>(`/sessions/${session.id}/focus-policy?nonce=${crypto.randomUUID()}`, token);
    const payload = JSON.parse(atob(result.policy.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number };
    policy.current = { token: result.policy, exp: payload.exp };
  }, [session.id, token]);

  const send = useCallback(async (action: string) => {
    if (!policy.current || policy.current.exp * 1000 <= Date.now() + 5000) await newPolicy();
    const post = () => api(`/sessions/${session.id}/focus-events`, token, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), policy: policy.current!.token, action }) });
    // Events are best effort: a missing event means "unknown" for the teacher, never misconduct.
    await post().catch(async e => { if (e instanceof ApiError && e.status === 422) { await newPolicy(); await post(); } else throw e; });
  }, [newPolicy, session.id, token]);

  // Start automatically once the class is active and the student checked in with the QR.
  useEffect(() => {
    if (session.state === 'ended' && ['active', 'paused', 'left'].includes(stateRef.current)) { setState('ended'); return; }
    if (session.state !== 'active' || stateRef.current !== 'off') return;
    newPolicy().then(() => { setState('active'); return send('started'); }).catch(e => setError((e as Error).message));
  }, [session.state, newPolicy, send]);

  // Leaving the page while focus is active: neutral review flag, then ask the teacher to continue.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && stateRef.current === 'active' && session.state === 'active') {
        setState('left');
        void send('backgrounded').catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [send, session.state]);

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  useEffect(() => {
    if (policy.current && ['active', 'paused'].includes(state) && policy.current.exp * 1000 <= now) setState('ended');
  }, [now, state]);

  // Poll the teacher's decision on a pending exit/resume request.
  useEffect(() => {
    if (!request || request.status !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const latest = await api<FocusRequest>(`/sessions/${session.id}/focus-${request.kind}-requests/mine`, token);
        setRequest(latest);
        if (latest.status === 'approved') {
          if (latest.kind === 'exit') { setState('exited'); await send('exited').catch(() => undefined); }
          else { setState('active'); await send('resumed').catch(() => undefined); }
        }
      } catch { /* keep waiting */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [request, send, session.id, token]);

  async function act(action: 'paused' | 'resumed') {
    setError('');
    setState(action === 'paused' ? 'paused' : 'active');
    await send(action).catch(() => setError('Saved on this phone. The teacher may not see this change until you are back online.'));
  }
  async function ask(kind: 'exit' | 'resume') {
    setError('');
    try { setRequest(await api<FocusRequest>(`/sessions/${session.id}/focus-${kind}-requests`, token, { method: 'POST' })); }
    catch (e) { setError((e as Error).message); }
  }
  async function exitWithQr(qr: string) {
    setScanning(false); setError('');
    try {
      await api(`/sessions/${session.id}/focus-exit/qr`, token, { method: 'POST', body: JSON.stringify({ qr }) });
      setState('exited'); await send('exited').catch(() => undefined);
    } catch (e) { setError((e as Error).message); }
  }

  const remaining = policy.current ? Math.max(0, policy.current.exp * 1000 - now) : 0;
  const clock = `${Math.floor(remaining / 60000)}:${String(Math.floor(remaining / 1000) % 60).padStart(2, '0')}`;
  const waiting = request?.status === 'pending';
  return <div className={`card focus focus-${state}`}>
    <p className="eyebrow">Voluntary focus</p>
    <h3>{{ off: 'Starts when class becomes active', active: 'Focus is on', paused: 'Focus paused', left: 'You left the page', exited: 'Focus ended', ended: 'Focus finished' }[state]}</h3>
    {['active', 'paused'].includes(state) && <p className="clock" aria-label="Time left in this focus period">{clock}</p>}
    {state === 'active' && <p>Stay on this page during class. Your phone remains yours; attendance is unchanged by focus.</p>}
    {state === 'paused' && <p>Paused on this phone. Resume when you are ready.</p>}
    {state === 'left' && <p>You left the page during focus. Your teacher received a neutral review flag. Ask your teacher to let you continue.</p>}
    {state === 'exited' && <p>Your teacher approved ending focus. Your attendance is unchanged.</p>}
    {state === 'ended' && <p>This focus period is over. Your attendance is unchanged.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    {waiting && <p className="success" role="status">Waiting for your teacher to {request!.kind === 'exit' ? 'approve ending focus' : 'let you continue'}…</p>}
    {request?.status === 'denied' && <p className="hint">Your teacher declined that request.</p>}
    <div className="actions">
      {state === 'active' && <button onClick={() => void act('paused')}>Pause now</button>}
      {state === 'paused' && <button onClick={() => void act('resumed')}>Resume</button>}
      {state === 'left' && <button disabled={waiting} onClick={() => void ask('resume')}>Ask teacher to continue</button>}
      {['active', 'paused'].includes(state) && <>
        <button className="secondary" onClick={() => setScanning(true)}>End focus with teacher’s QR</button>
        <button className="secondary" disabled={waiting} onClick={() => void ask('exit')}>Ask teacher to end focus</button>
      </>}
    </div>
    {scanning && <QrScanner title="Scan your teacher’s current QR to end focus" onResult={qr => void exitWithQr(qr)} onCancel={() => setScanning(false)}/>}
  </div>;
}

function History({ auth, onExpired }: { auth: Auth; onExpired: () => void }) {
  const token = auth.access_token;
  const { data: rows, error, refresh: refreshRows } = usePoll(() => api<HistoryRow[]>('/attendance/me', token), onExpired, 15000);
  const { data: requests, refresh: refreshRequests } = usePoll(() => api<DataRequest[]>('/privacy/requests', token), onExpired, 15000);
  const [form, setForm] = useState<{ kind: 'correction' | 'deletion'; sessionId: number | null } | null>(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState('');
  const [formError, setFormError] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setFormError('');
    try {
      await api('/privacy/requests', token, { method: 'POST', body: JSON.stringify({ kind: form!.kind, session_id: form!.sessionId, reason: reason.trim() }) });
      setForm(null); setReason(''); setMessage('Request sent for review. It does not change your records automatically.');
      await Promise.all([refreshRows(), refreshRequests()]);
    } catch (e) { setFormError((e as Error).message); }
  }
  return <section>
    <p className="eyebrow">Your records only</p><h1>Attendance history</h1>
    {error && <p className="error" role="alert">{error}</p>}
    {message && <p className="success" role="status">{message}</p>}
    {rows === null ? <p role="status">Loading…</p> : !rows.length ? <div className="card"><p>No attendance records yet.</p></div> :
      rows.map(r => <div key={r.session_id} className="card history-row">
        <div><strong>{r.session.title}</strong><small>{r.session.course_title} · {date(r.session.starts_at)}</small></div>
        <span className={`status ${r.status}`}>{r.status}</span><small>{r.method === 'qr' ? 'QR check-in' : 'Teacher-confirmed'}</small>
        <button className="secondary" onClick={() => { setForm({ kind: 'correction', sessionId: r.session_id }); setMessage(''); }}>Request correction</button>
      </div>)}
    <button className="secondary" onClick={() => { setForm({ kind: 'deletion', sessionId: null }); setMessage(''); }}>Request deletion of my data</button>
    {form && <form className="card confirmation" onSubmit={submit}>
      <h3>{form.kind === 'correction' ? 'Request a correction' : 'Request data deletion'}</h3>
      <label>Reason (at least 10 characters)<input required minLength={10} maxLength={500} value={reason} onChange={e => setReason(e.target.value)}/></label>
      {formError && <p className="error" role="alert">{formError}</p>}
      <div className="actions"><button>Send request</button><button type="button" className="secondary" onClick={() => setForm(null)}>Cancel</button></div>
    </form>}
    {!!requests?.length && <div className="card"><h3>Your requests</h3>{requests.map(q => <p key={q.id} className="resource-row"><strong>{q.kind === 'correction' ? 'Correction' : 'Deletion'} · {q.status}</strong><small>{q.reason}</small>{q.resolution && <small>Teacher: {q.resolution}</small>}</p>)}</div>}
  </section>;
}
