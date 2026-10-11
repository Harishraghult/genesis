import React, { useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';

const isClassQr = (value: string) => value.startsWith('FL2.');

function decode(canvas: HTMLCanvasElement, source: CanvasImageSource, width: number, height: number): string | null {
  const scale = Math.min(1, 720 / Math.max(width, height));
  canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  const image = context.getImageData(0, 0, canvas.width, canvas.height);
  return jsQR(image.data, image.width, image.height, { inversionAttempts: 'dontInvert' })?.data ?? null;
}

/** Camera QR scanner with a photo fallback. Calls onResult once with a FocusLock class QR. */
export function QrScanner({ title, onResult, onCancel }: { title: string; onResult: (qr: string) => void; onCancel: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const done = useRef(false);
  const [message, setMessage] = useState('Starting camera…');

  function finish(value: string | null) {
    if (done.current || !value) return false;
    if (!isClassQr(value)) { setMessage('That is not a FocusLock class QR. Point the camera at the QR on your teacher’s screen.'); return false; }
    done.current = true;
    onResult(value);
    return true;
  }

  useEffect(() => {
    let stream: MediaStream | null = null;
    let frame = 0;
    let stopped = false;
    const tick = () => {
      if (stopped || done.current) return;
      const v = video.current, c = canvas.current;
      if (v && c && v.readyState >= 2 && v.videoWidth) finish(decode(c, v, v.videoWidth, v.videoHeight));
      frame = requestAnimationFrame(tick);
    };
    if (!navigator.mediaDevices?.getUserMedia) setMessage('Live camera is not available in this browser. Take a photo of the QR instead.');
    else navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false }).then(s => {
      if (stopped) { s.getTracks().forEach(t => t.stop()); return; }
      stream = s;
      if (video.current) { video.current.srcObject = s; void video.current.play(); }
      setMessage('Point the camera at the QR on your teacher’s screen.');
      frame = requestAnimationFrame(tick);
    }).catch((error: Error) => setMessage(error.name === 'NotAllowedError'
      ? 'Camera permission was declined. Allow the camera in your browser settings, or take a photo of the QR instead.'
      : 'The camera could not start. Take a photo of the QR instead.'));
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach(t => t.stop()); };
  }, []);

  async function fromPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !canvas.current) return;
    try {
      const bitmap = await createImageBitmap(file);
      const found = decode(canvas.current, bitmap, bitmap.width, bitmap.height);
      bitmap.close();
      if (!found) setMessage('No QR found in that photo. Hold the phone steady and closer, then try again.');
      else finish(found);
    } catch { setMessage('That photo could not be read. Try again.'); }
  }

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal scanner">
      <h3>{title}</h3>
      <div className="viewfinder"><video ref={video} muted playsInline/><span className="frame" aria-hidden="true"/></div>
      <canvas ref={canvas} hidden/>
      <p role="status">{message}</p>
      <div className="actions">
        <label className="button secondary">Take a photo instead<input type="file" accept="image/*" capture="environment" onChange={e => void fromPhoto(e)} hidden/></label>
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  </div>;
}
