import React, { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, date, stateLabel } from './api';
import { checkIn } from './device';
import { QrScanner } from './scanner';
import { FaceCamera } from './faceui';

type User = { id: number; name: string; email: string; role: string };
type Auth = { access_token: string; user: User };
type Own = { status: string; method: string; updated_at: string };
type ClassSession = { id: number; course_id: number; course_title: string; title: string; room_code: string; starts_at: string; ends_at: string; state: 'ready' | 'checkin_pending' | 'active' | 'paused' | 'ended'; attendance: Own | null; pending_review: boolean };
type Resource = { id: number; title: string; url: string; kind: 'pdf' | 'text'; downloadable: boolean };
type HistoryRow = Own & { session_id: number; session: ClassSession };
type DataRequest = { id: number; session_id: number | null; kind: 'correction' | 'deletion'; reason: string; status: string; resolution: string | null };
type FocusState = 'off' | 'active' | 'paused' | 'out' | 'quit' | 'ended';

const STORAGE = 'focuslock-student';
// Android app download (GitHub Releases). Only the installed app can turn on Do Not Disturb and silence calls.
export const APP_DOWNLOAD_URL = 'https://github.com/Harishraghult/genesis/releases/latest';
const isAndroid = /Android/i.test(navigator.userAgent);
function GetTheApp() {
  return <div className="get-app">
    <div><strong>Get the FocusLock app</strong><small>{isAndroid ? 'The Android app can turn on Do Not Disturb and silence calls during class, with your permission.' : 'On Android phones, the app can turn on Do Not Disturb and silence calls during class.'}</small></div>
    <a className="button" href={APP_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer">Download for Android</a>
  </div>;
}
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
  const [flash, setFlash] = useState('');
  // The open class lives in the URL (/student?class=ID) so a refresh keeps the student's place and Back returns to the list.
  const fromUrl = () => { const id = Number(new URLSearchParams(window.location.search).get('class')); return Number.isInteger(id) && id > 0 ? id : null; };
  const [sessionId, setSessionIdState] = useState<number | null>(fromUrl);
  const setSessionId = (id: number | null) => {
    setSessionIdState(id);
    const url = id === null ? '/student' : `/student?class=${id}`;
    if (window.location.pathname + window.location.search !== url) window.history.pushState(null, '', url);
  };
  useEffect(() => { const onPop = () => setSessionIdState(fromUrl()); window.addEventListener('popstate', onPop); return () => window.removeEventListener('popstate', onPop); }, []);
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
    <header><div className="brand-row"><img className="brand-logo" src="/logo-64.png" alt="" width="40" height="40"/><div className="brand">FocusLock<span>STUDENT</span></div></div>{auth && <div className="account">{auth.user.name}<button className="secondary" onClick={() => void signOut()}>Sign out</button></div>}</header>
    {enabled && <div className="dev-banner">DEMO · Sample accounts and courses. Do not enter real student data.</div>}
    <main className="student-shell">
      {!auth ? <StudentLogin enabled={enabled} onSignedIn={setAuth}/>
        : sessionId !== null ? <SessionView auth={auth} sessionId={sessionId} onBack={() => setSessionId(null)} onLeft={message => { setFlash(message); setSessionId(null); setView('today'); }} onExpired={expired}/>
        : view === 'today' ? <Today auth={auth} onOpen={id => { setFlash(''); setSessionId(id); }} onExpired={expired} flash={flash}/>
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
    <GetTheApp/>
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

function Today({ auth, onOpen, onExpired, flash }: { auth: Auth; onOpen: (id: number) => void; onExpired: () => void; flash?: string }) {
  const { data, error } = usePoll(() => api<ClassSession[]>('/sessions', auth.access_token), onExpired);
  const sessions = (data ?? []).filter(s => s.state !== 'ended').sort((a, b) => Number(isOpen(b)) - Number(isOpen(a)) || a.starts_at.localeCompare(b.starts_at));
  return <section>
    <p className="eyebrow">Hello, {auth.user.name.split(' ')[0]}</p><h1>Today’s classes</h1>
    {flash && <p className="success" role="status">{flash}</p>}
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

type CheckResult = { ok: true; duplicate: boolean } | { ok: false; message: string; review?: boolean };

/** QR check-in, adding the server-side face check when the student has a recorded face. */
function useCheckInFlow(auth: Auth) {
  const token = auth.access_token;
  const pass = useRef<{ token: string; until: number } | null>(null);
  const [face, setFace] = useState<{ qr: string; failures: number; resolve: (result: CheckResult) => void } | null>(null);

  async function finish(qr: string, faceToken?: string): Promise<CheckResult> {
    try { return { ok: true, duplicate: (await checkIn(auth.user.id, token, qr, faceToken)).duplicate }; }
    catch (e) {
      if (e instanceof ApiError && e.status === 410 && faceToken)
        return { ok: false, message: 'Face verified. The class QR changed while you were checking; scan it once more to finish. No face check is needed for the next 2 minutes.' };
      const message = (e as Error).message;
      if (/Face enrollment is required/i.test(message)) return { ok: false, message: 'No face is recorded for you yet. Ask your administrator to record it, or ask your teacher to confirm your attendance.', review: true };
      return { ok: false, message };
    }
  }
  async function run(qr: string): Promise<CheckResult> {
    const status = await api<{ mode: string; enrolled: boolean }>('/face/templates/me', token).catch(() => ({ mode: 'off', enrolled: false }));
    if (status.mode === 'off' || !status.enrolled) return finish(qr);
    if (pass.current && pass.current.until > Date.now()) return finish(qr, pass.current.token);
    return new Promise(resolve => setFace({ qr, failures: 0, resolve }));
  }
  async function verified(template: number[]) {
    const current = face!;
    const result = await api<{ match: boolean; face_token?: string }>('/face/verify', token, { method: 'POST', body: JSON.stringify({ template, model: 'sface-2021dec' }) })
      .catch((e: Error) => ({ match: false, error: e.message }));
    if (result.match && 'face_token' in result && result.face_token) {
      pass.current = { token: result.face_token, until: Date.now() + 110_000 };
      setFace(null);
      current.resolve(await finish(current.qr, result.face_token));
    } else if (current.failures + 1 >= 3) {
      setFace(null);
      current.resolve({ ok: false, message: 'Your face did not match after three tries. Ask your teacher to confirm your attendance.', review: true });
    } else setFace({ ...current, failures: current.failures + 1 });
  }
  const modal = face && <FaceCamera key={face.failures} title="Confirm it is you" blink frames={3}
    intro="Look at the camera and blink once. FocusLock compares your face with the record your college made."
    extra={face.failures > 0 ? <p className="error" role="alert">That did not match. Try again ({face.failures} of 3).</p> : undefined}
    onTemplate={template => void verified(template)}
    onCancel={() => { face.resolve({ ok: false, message: 'Face check cancelled. Scan again when you are ready, or ask your teacher.' }); setFace(null); }}/>;
  return { run, modal };
}

function SessionView({ auth, sessionId, onBack, onLeft, onExpired }: { auth: Auth; sessionId: number; onBack: () => void; onLeft: (message: string) => void; onExpired: () => void }) {
  const token = auth.access_token;
  const { data: session, error: loadError, refresh } = usePoll(() => api<ClassSession>(`/sessions/${sessionId}`, token), onExpired, 4000);
  const [resources, setResources] = useState<Resource[]>([]);
  const [step, setStep] = useState<'idle' | 'disclosure' | 'scan' | 'review'>('idle');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [reason, setReason] = useState('');
  useEffect(() => { api<Resource[]>(`/sessions/${sessionId}/resources`, token).then(setResources).catch(() => setResources([])); }, [sessionId, token, session?.state]);

  const flow = useCheckInFlow(auth);
  async function scanned(qr: string) {
    setStep('idle'); setBusy(true); setError(''); setNotice('Checking you in…');
    try {
      const result = await flow.run(qr);
      if (result.ok) {
        setNotice(result.duplicate ? 'You were already checked in.' : 'Checked in. Your attendance is recorded as present.');
        await refresh();
      } else { setNotice(''); setError(result.message); if (result.review) setStep('review'); }
    } finally { setBusy(false); }
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

    {focusEligible && session.state !== 'ready' && <FocusPanel auth={auth} session={session} checkInFlow={flow.run} onQuitApproved={() => onLeft(`Your teacher let you leave focus in “${session.title}”. Your attendance is unchanged; to rejoin, open the class and ask your teacher.`)}/>}

    <div className="card">
      <h3>Course resources</h3>
      {!resources.length ? <p className="hint">No resources attached to this class.</p> : resources.map(r => <p key={r.id} className="resource-row">
        {/^https:\/\//i.test(r.url) ? <a href={r.url} target="_blank" rel="noopener noreferrer">{r.title}</a> : <strong>{r.title} (unavailable: not a secure link)</strong>}<small>{r.kind.toUpperCase()} · {r.downloadable ? 'Offline copy allowed' : 'View only'}</small></p>)}
    </div>

    {step === 'disclosure' && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Voluntary focus disclosure"><div className="modal">
      <p className="eyebrow">Before you check in</p><h3>Voluntary class focus</h3>
      <p>Checking in with the QR also turns on voluntary focus while the class is running.</p>
      <ul>
        <li>Pause any time. To quit focus, ask your teacher. To come back in after quitting or leaving, ask your teacher again.</li>
        <li>Leaving this page, or locking your screen, while focus is on sends your teacher a neutral “left the page” note and locks focus until your teacher lets you back in. Quit requests go to your teacher. FocusLock cannot see other apps or why you left.</li>
        <li>Turning on Do Not Disturb is up to you.</li>
        <li>Focus never changes your attendance.</li>
      </ul>
      <div className="actions"><button onClick={() => setStep('scan')}>Accept and scan</button><button className="secondary" onClick={() => setStep('review')}>Decline · ask teacher instead</button></div>
    </div></div>}
    {step === 'scan' && <QrScanner title="Scan your class QR" onResult={qr => void scanned(qr)} onCancel={() => setStep('idle')}/>}
    {flow.modal}
  </section>;
}

function FocusPanel({ auth, session, checkInFlow, onQuitApproved }: { auth: Auth; session: ClassSession; checkInFlow: (qr: string) => Promise<CheckResult>; onQuitApproved: () => void }) {
  const token = auth.access_token;
  const key = `focuslock-focus-${auth.user.id}-${session.id}-${session.starts_at}`;
  const saved = (() => { try { return JSON.parse(sessionStorage.getItem(key) ?? 'null') as { state: FocusState; policy: { token: string; exp: number } | null } | null; } catch { return null; } })();
  const [state, setStateRaw] = useState<FocusState>(saved?.state ?? 'off');
  const stateRef = useRef(state);
  // Kept so Pause/Quit can still be reported while the teacher has paused class (no new policy is issued then).
  const policy = useRef<{ token: string; exp: number } | null>(saved?.policy ?? null);
  const persist = () => { try { sessionStorage.setItem(key, JSON.stringify({ state: stateRef.current, policy: policy.current })); } catch { /* best effort */ } };
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [quitRequest, setQuitRequest] = useState<'none' | 'pending' | 'denied'>('none');
  const [backRequest, setBackRequest] = useState<'none' | 'pending' | 'denied' | 'approved'>('none');
  const setState = (next: FocusState) => { stateRef.current = next; setStateRaw(next); persist(); };

  const send = useCallback(async (action: string) => {
    const fresh = async () => {
      const result = await api<{ policy: string }>(`/sessions/${session.id}/focus-policy?nonce=${crypto.randomUUID()}`, token);
      const payload = JSON.parse(atob(result.policy.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))) as { exp: number };
      policy.current = { token: result.policy, exp: payload.exp };
      persist();
    };
    if (!policy.current || policy.current.exp * 1000 <= Date.now() + 5000) await fresh();
    const post = () => api(`/sessions/${session.id}/focus-events`, token, { method: 'POST', body: JSON.stringify({ id: crypto.randomUUID(), policy: policy.current!.token, action }) });
    // Events are best effort: a missing event means "unknown" for the teacher, never misconduct.
    await post().catch(async e => { if (e instanceof ApiError && e.status === 422) { await fresh(); await post(); } else throw e; });
  }, [session.id, token]);

  // Focus turns on by itself once the class is active after a QR check-in, and off when the class ends.
  useEffect(() => {
    if (session.state === 'ended' && stateRef.current !== 'off') { setState('ended'); return; }
    if (session.state !== 'active' || stateRef.current !== 'off') return;
    setState('active');
    send('started').catch(e => {
      // Opened elsewhere after leaving or quitting: the server wants the teacher's approval first.
      if (/back into focus/i.test((e as Error).message)) setState('quit');
      else setError((e as Error).message);
    });
  }, [session.state, send]);

  // Leaving the page while focus is on locks focus until the teacher lets the student back in.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden' && stateRef.current === 'active' && session.state === 'active') {
        setState('out'); setBackRequest('none');
        void send('backgrounded').catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [send, session.state]);

  // After a refresh, pick up any request that is still waiting for the teacher.
  useEffect(() => {
    if (state === 'active' || state === 'paused')
      api<{ status: string }>(`/sessions/${session.id}/focus-exit-requests/mine`, token).then(r => { if (r.status === 'pending') setQuitRequest('pending'); }).catch(() => undefined);
    if (state === 'out' || state === 'quit')
      api<{ status: string }>(`/sessions/${session.id}/focus-resume-requests/mine`, token).then(r => { if (r.status === 'pending') setBackRequest('pending'); }).catch(() => undefined);
  }, [session.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teacher's decision on quitting: on approval, focus ends and the student goes back to the class list.
  useEffect(() => {
    if (quitRequest !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const latest = await api<{ status: string }>(`/sessions/${session.id}/focus-exit-requests/mine`, token);
        if (latest.status === 'approved') {
          setQuitRequest('none');
          await send('exited').catch(() => undefined);
          setState('quit');
          onQuitApproved();
        } else if (latest.status === 'denied') setQuitRequest('denied');
      } catch { /* keep waiting */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [quitRequest, send, session.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  // Teacher's decision on coming back (after leaving the page or after quitting).
  useEffect(() => {
    if (backRequest !== 'pending') return;
    const timer = setInterval(async () => {
      try {
        const latest = await api<{ status: string }>(`/sessions/${session.id}/focus-resume-requests/mine`, token);
        if (latest.status === 'approved') {
          if (stateRef.current === 'out') { setBackRequest('none'); setState('active'); await send('resumed').catch(() => undefined); }
          else setBackRequest('approved'); // after quitting: now scan the QR to rejoin
        } else if (latest.status === 'denied') setBackRequest('denied');
      } catch { /* keep waiting */ }
    }, 4000);
    return () => clearInterval(timer);
  }, [backRequest, send, session.id, token]); // eslint-disable-line react-hooks/exhaustive-deps

  async function ask(kind: 'exit' | 'resume') {
    setError('');
    try {
      await api(`/sessions/${session.id}/focus-${kind}-requests`, token, { method: 'POST' });
      if (kind === 'exit') setQuitRequest('pending'); else setBackRequest('pending');
    } catch (e) { setError((e as Error).message); }
  }
  async function act(next: FocusState, action: 'paused' | 'resumed') {
    setError(''); setState(next);
    await send(action).catch(() => setError('Saved on this phone. Your teacher may not see this until you are back online.'));
  }
  async function rejoin(qr: string) {
    setScanning(false); setBusy(true); setError('');
    try {
      const result = await checkInFlow(qr); // includes the face check when one is recorded
      if (!result.ok) { setError(result.message); return; }
      await send('started');
      setBackRequest('none'); setState('active');
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }

  const live = session.state === 'active';
  const title = { off: 'Starts when your teacher starts class', active: 'Focus is on', paused: 'Focus paused', out: 'You left during class', quit: 'You are out of focus', ended: 'Class ended' }[state];
  return <div className={`card focus focus-${state}`}>
    <p className="eyebrow">Voluntary focus</p>
    <h3>{title}</h3>
    {session.state === 'paused' && (state === 'active' || state === 'paused') && <p className="hint">Your teacher paused the class.</p>}
    {state === 'active' && <p>Stay with the class. Your phone remains yours, and focus never changes your attendance.</p>}
    {state === 'paused' && <p>Paused. Resume whenever you are ready.</p>}
    {state === 'out' && <p>You left this page while focus was on. Ask your teacher to let you back in. Your attendance is unchanged.</p>}
    {state === 'quit' && backRequest !== 'approved' && <p>Your teacher let you quit focus. To join again, ask your teacher first.</p>}
    {state === 'quit' && backRequest === 'approved' && <p className="success" role="status">Your teacher said you can rejoin. Scan the class QR to come back in.</p>}
    {quitRequest === 'pending' && (state === 'active' || state === 'paused') && <p className="success" role="status">Asked your teacher to let you quit. Focus continues until they decide.</p>}
    {quitRequest === 'denied' && (state === 'active' || state === 'paused') && <p className="hint">Your teacher asked you to stay in focus.</p>}
    {backRequest === 'pending' && <p className="success" role="status">Waiting for your teacher to let you back in…</p>}
    {backRequest === 'denied' && <p className="hint">Your teacher said not yet. You can ask again.</p>}
    {error && <p className="error" role="alert">{error}</p>}
    <div className="actions">
      {state === 'active' && <button onClick={() => void act('paused', 'paused')}>Pause</button>}
      {state === 'paused' && <button onClick={() => void act('active', 'resumed')}>Resume</button>}
      {(state === 'active' || state === 'paused') && <button className="secondary" disabled={quitRequest === 'pending'} onClick={() => void ask('exit')}>{quitRequest === 'pending' ? 'Waiting for teacher…' : 'Ask teacher to quit'}</button>}
      {state === 'out' && live && <button disabled={backRequest === 'pending'} onClick={() => void ask('resume')}>{backRequest === 'pending' ? 'Waiting for teacher…' : 'Ask teacher to let me back in'}</button>}
      {state === 'quit' && live && backRequest !== 'approved' && <button disabled={backRequest === 'pending'} onClick={() => void ask('resume')}>{backRequest === 'pending' ? 'Waiting for teacher…' : 'Ask teacher to rejoin'}</button>}
      {state === 'quit' && live && backRequest === 'approved' && <button disabled={busy} onClick={() => setScanning(true)}>{busy ? 'Joining…' : 'Scan QR to rejoin'}</button>}
    </div>
    {(state === 'active' || state === 'paused') && <DndCard/>}
    {scanning && <QrScanner title="Scan the class QR to rejoin" onResult={qr => void rejoin(qr)} onCancel={() => setScanning(false)}/>}
  </div>;
}

function DndCard() {
  const [on, setOn] = useState(() => { try { return sessionStorage.getItem('focuslock-dnd') === 'on'; } catch { return false; } });
  const [open, setOpen] = useState(false);
  const ios = /iPhone|iPad|iPod/i.test(navigator.userAgent);
  const toggle = () => { const next = !on; setOn(next); try { sessionStorage.setItem('focuslock-dnd', next ? 'on' : 'off'); } catch { /* best effort */ } };
  return <div className="dnd">
    <div><strong>Do Not Disturb</strong><small>{on ? 'Marked as on. Remember to turn it off after class.' : 'Silence calls and notifications during class.'}</small></div>
    <div className="actions"><button className={on ? 'secondary' : ''} onClick={toggle}>{on ? 'I turned it off' : 'I turned it on'}</button><button className="secondary" onClick={() => setOpen(o => !o)}>{open ? 'Hide steps' : 'How?'}</button></div>
    {open && <p className="hint">{ios ? 'Swipe down from the top-right corner to open Control Center, tap Focus, then Do Not Disturb.' : 'Swipe down from the top of the screen twice to open Quick Settings, then tap Do Not Disturb.'} Websites cannot switch it on or silence calls for you. The FocusLock Android app can do both automatically if you allow it.</p>}
    {isAndroid && <GetTheApp/>}
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
