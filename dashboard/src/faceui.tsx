import React, { useEffect, useRef, useState } from 'react';

/** Front-camera face capture dialog. Calls onTemplate once with 128 numbers; the camera picture is never stored or sent. */
export function FaceCamera({ title, intro, blink, frames, onTemplate, onCancel, extra }: {
  title: string; intro: string; blink: boolean; frames: number;
  onTemplate: (template: number[]) => void; onCancel: () => void; extra?: React.ReactNode;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const [status, setStatus] = useState('Starting camera…');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let stream: MediaStream | null = null;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('This browser cannot use the camera.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 640 } }, audio: false });
        if (controller.signal.aborted) return;
        if (video.current) { video.current.srcObject = stream; await video.current.play(); }
        const { captureTemplate } = await import('./face');
        const template = await captureTemplate(video.current!, { blink, frames, onStatus: setStatus, signal: controller.signal });
        if (!controller.signal.aborted) onTemplate(template);
      } catch (e) {
        if ((e as Error).name === 'AbortError') return;
        setError((e as Error).name === 'NotAllowedError' ? 'Camera permission was declined. Allow the camera in your browser settings and try again.' : (e as Error).message || 'The face check could not run.');
      } finally { stream?.getTracks().forEach(t => t.stop()); }
    })();
    return () => { controller.abort(); stream?.getTracks().forEach(t => t.stop()); };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="modal-backdrop" role="dialog" aria-modal="true" aria-label={title}>
    <div className="modal scanner face-modal">
      <h3>{title}</h3>
      <p className="hint">{intro}</p>
      <div className="viewfinder face"><video ref={video} muted playsInline/><span className="oval" aria-hidden="true"/></div>
      {error ? <p className="error" role="alert">{error}</p> : <p className="face-status" role="status">{status}</p>}
      {extra}
      <div className="actions">
        {error && <button type="button" onClick={() => { setError(''); setStatus('Starting camera…'); setAttempt(a => a + 1); }}>Try again</button>}
        <button type="button" className="secondary" onClick={onCancel}>Cancel</button>
      </div>
      <p className="hint">Only 128 numbers describing your face are used. The picture is not saved or uploaded.</p>
    </div>
  </div>;
}
