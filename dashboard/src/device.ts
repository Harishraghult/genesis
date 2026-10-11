// Browser device key for student check-in: a non-extractable P-256 key kept in this browser's IndexedDB.
// Mirrors the Android Keystore flow; payload formats must match backend/app/qr_security.py exactly.
import { api, ApiError, url64 } from './api';

type Stored = { keys: CryptoKeyPair; deviceId: string | null };
type Challenge = { challenge_id: string; nonce: string };

const DB = 'focuslock-device';
const STORE = 'keys';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('This browser blocks secure storage, so it cannot hold a device key. Use another browser or ask your teacher to confirm attendance.'));
  });
}

async function read(studentId: number): Promise<Stored | undefined> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const request = db.transaction(STORE).objectStore(STORE).get(String(studentId));
    request.onsuccess = () => resolve(request.result as Stored | undefined);
    request.onerror = () => reject(request.error);
  });
}

async function write(studentId: number, value: Stored): Promise<void> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, String(studentId));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// WebCrypto returns ECDSA signatures as r||s; the server (like Android) verifies DER.
function der(raw: Uint8Array): Uint8Array {
  const integer = (bytes: Uint8Array) => {
    let start = 0;
    while (start < bytes.length - 1 && bytes[start] === 0) start++;
    let value = bytes.slice(start);
    if (value[0] & 0x80) value = Uint8Array.of(0, ...value);
    return Uint8Array.of(0x02, value.length, ...value);
  };
  const r = integer(raw.slice(0, 32)), s = integer(raw.slice(32));
  return Uint8Array.of(0x30, r.length + s.length, ...r, ...s);
}

async function sign(keys: CryptoKeyPair, payload: string): Promise<string> {
  const raw = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, new TextEncoder().encode(payload));
  return url64(der(new Uint8Array(raw)));
}

async function sha256Hex(value: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Returns this browser's registered device id for the student, registering a new key if needed. */
export async function ensureDevice(studentId: number, token: string, forceNew = false): Promise<{ deviceId: string; keys: CryptoKeyPair }> {
  if (!window.isSecureContext || !crypto.subtle) throw new Error('Check-in needs a secure (HTTPS) connection.');
  let stored = forceNew ? undefined : await read(studentId);
  if (!stored) {
    const keys = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
    stored = { keys, deviceId: null };
    await write(studentId, stored);
  }
  if (stored.deviceId) return { deviceId: stored.deviceId, keys: stored.keys };
  const challenge = await api<Challenge>('/devices/challenge', token, { method: 'POST' });
  const publicKey = url64(new Uint8Array(await crypto.subtle.exportKey('spki', stored.keys.publicKey)));
  const signature = await sign(stored.keys, `FL2|register|${studentId}|${challenge.challenge_id}|${challenge.nonce}`);
  const result = await api<{ device_id: string }>('/devices/register', token, { method: 'POST', body: JSON.stringify({ challenge_id: challenge.challenge_id, public_key: publicKey, signature }) });
  stored.deviceId = result.device_id;
  await write(studentId, stored);
  return { deviceId: result.device_id, keys: stored.keys };
}

/** Signed QR check-in. The focus disclosure must already have been accepted by the student. */
export async function checkIn(studentId: number, token: string, qr: string): Promise<{ status: string; duplicate: boolean; session_id: number }> {
  const attempt = async (forceNew: boolean) => {
    const { deviceId, keys } = await ensureDevice(studentId, token, forceNew);
    const challenge = await api<Challenge>('/check-ins/challenge', token, { method: 'POST', body: JSON.stringify({ device_id: deviceId, qr, focus_disclosure: 'accepted' }) });
    const payload = `FL2|checkin|${studentId}|${deviceId}|${challenge.challenge_id}|${challenge.nonce}|${await sha256Hex(qr)}|focus-disclosure-v1|accepted`;
    const signature = await sign(keys, payload);
    return api<{ status: string; duplicate: boolean; session_id: number }>('/check-ins', token, { method: 'POST', body: JSON.stringify({ device_id: deviceId, qr, challenge_id: challenge.challenge_id, signature, focus_disclosure: 'accepted' }) });
  };
  try {
    return await attempt(false);
  } catch (error) {
    // A device revoked or unknown on the server (e.g. a reset demo database): register a fresh key once.
    if (error instanceof ApiError && error.status === 404 && /device/i.test(error.message)) return attempt(true);
    throw error;
  }
}
