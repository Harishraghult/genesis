import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from './api';
import { FaceCamera } from './faceui';

type Auth = { access_token: string; user: { id: number; name: string; email: string; role: string } };
type Student = { id: number; name: string; email: string; enrolled: boolean };
const STORAGE = 'focuslock-admin';

/** Administrator page: record or delete students' face templates (128 encrypted numbers, never photos). */
export function AdminApp() {
  const [auth, setAuthState] = useState<Auth | null>(() => { try { return JSON.parse(sessionStorage.getItem(STORAGE) ?? 'null'); } catch { return null; } });
  const setAuth = (value: Auth | null) => {
    try { if (value) sessionStorage.setItem(STORAGE, JSON.stringify(value)); else sessionStorage.removeItem(STORAGE); } catch { /* page-only session */ }
    setAuthState(value);
  };
  async function signOut() {
    try { if (auth) await api('/auth/logout', auth.access_token, { method: 'POST' }); } catch { /* expires anyway */ }
    setAuth(null);
  }
  return <div className="student admin">
    <header><div className="brand-row"><img className="brand-logo" src="/logo-64.png" alt="" width="40" height="40"/><div className="brand">FocusLock<span>ADMIN</span></div></div>{auth && <div className="account">{auth.user.name}<button className="secondary" onClick={() => void signOut()}>Sign out</button></div>}</header>
    <div className="dev-banner">DEMO · Sample accounts. Record faces only with each student's agreement.</div>
    <main className="student-shell admin-shell">{auth ? <FaceRecords auth={auth} onExpired={() => setAuth(null)}/> : <AdminLogin onSignedIn={setAuth}/>}</main>
    <footer>Face records are stored as 128 encrypted numbers. Photos are never saved or uploaded. A face match is evidence for teachers, not proof of identity.</footer>
  </div>;
}

function AdminLogin({ onSignedIn }: { onSignedIn: (auth: Auth) => void }) {
  const [email, setEmail] = useState('admin@focuslock.test');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      const result = await api<Auth>('/auth/dev-login', undefined, { method: 'POST', body: JSON.stringify({ email, password }) });
      if (result.user.role !== 'admin') {
        await api('/auth/logout', result.access_token, { method: 'POST' }).catch(() => undefined);
        throw new Error('This page is for administrators. Teachers sign in at the main page.');
      }
      onSignedIn(result);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <section className="card">
    <p className="eyebrow">Administrator</p><h1>Face records</h1>
    <form onSubmit={submit}>
      <label>Email<input type="email" autoComplete="username" required value={email} onChange={e => setEmail(e.target.value)}/></label>
      <label>Demo password<input type="password" autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}/></label>
      <button disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
    </form>
    {error && <p className="error" role="alert">{error}</p>}
  </section>;
}

function FaceRecords({ auth, onExpired }: { auth: Auth; onExpired: () => void }) {
  const token = auth.access_token;
  const [students, setStudents] = useState<Student[] | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [consentFor, setConsentFor] = useState<Student | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [recording, setRecording] = useState<Student | null>(null);
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    try { setStudents(await api<Student[]>('/face/roster', token)); }
    catch (e) { if (e instanceof ApiError && e.status === 401) onExpired(); else setError((e as Error).message); }
  }, [token, onExpired]);
  useEffect(() => { void load(); }, [load]);

  async function save(student: Student, template: number[]) {
    setRecording(null); setError(''); setNotice('Saving…');
    try {
      await api(`/face/templates/${student.id}`, token, { method: 'PUT', body: JSON.stringify({ template, model: 'sface-2021dec', consent: true }) });
      setNotice(`Face recorded for ${student.name}. Stored as 128 encrypted numbers; no photo was kept.`);
      await load();
    } catch (e) { setNotice(''); setError((e as Error).message); }
  }
  async function remove(student: Student) {
    if (!window.confirm(`Delete ${student.name}'s face record? They will need it recorded again for face checks.`)) return;
    setError('');
    try { await api(`/face/templates/${student.id}`, token, { method: 'DELETE' }); setNotice(`Face record deleted for ${student.name}.`); await load(); }
    catch (e) { setError((e as Error).message); }
  }

  const shown = (students ?? []).filter(s => `${s.name} ${s.email}`.toLowerCase().includes(query.trim().toLowerCase()));
  return <section>
    <p className="eyebrow">Administrator</p><h1>Face records</h1>
    <p className="hint">After a QR scan, students with a face record must pass a quick face check (blink, then match). Record a face in person, with the student looking at this device.</p>
    {error && <p className="error" role="alert">{error}</p>}
    {notice && <p className="success" role="status">{notice}</p>}
    <label>Find student<input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search name or email"/></label>
    {students === null ? <p role="status">Loading students…</p> : shown.map(s => <div key={s.id} className="card face-row">
      <div><strong>{s.name}</strong><small>{s.email}</small></div>
      <span className={`status ${s.enrolled ? 'present' : ''}`}>{s.enrolled ? 'Face recorded' : 'No face record'}</span>
      <div className="actions">
        <button onClick={() => { setConsentFor(s); setAgreed(false); setNotice(''); }}>{s.enrolled ? 'Record again' : 'Record face'}</button>
        {s.enrolled && <button className="secondary" onClick={() => void remove(s)}>Delete</button>}
      </div>
    </div>)}

    {consentFor && <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label="Student agreement"><div className="modal">
      <p className="eyebrow">Before recording</p><h3>Record {consentFor.name}'s face</h3>
      <ul>
        <li>Only 128 numbers describing the face are stored, encrypted. No photo is saved or uploaded.</li>
        <li>It is used only to check that the right student is checking in, and can be deleted at any time.</li>
        <li>Students who do not agree can still have attendance confirmed by their teacher.</li>
      </ul>
      <label className="check-label"><input type="checkbox" checked={agreed} onChange={e => setAgreed(e.target.checked)}/> {consentFor.name} agreed to have their face recorded</label>
      <div className="actions"><button disabled={!agreed} onClick={() => { setRecording(consentFor); setConsentFor(null); }}>Start camera</button><button className="secondary" onClick={() => setConsentFor(null)}>Cancel</button></div>
    </div></div>}
    {recording && <FaceCamera title={`Recording ${recording.name}`} blink frames={5}
      intro="Ask the student to look at the camera, blink once, then hold still."
      onTemplate={template => void save(recording, template)} onCancel={() => setRecording(null)}/>}
  </section>;
}
