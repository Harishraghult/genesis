// Browser face check. Mirrors the Android pipeline (FaceMath.kt / FaceEngine.kt) so templates match across platforms:
// one face -> 5 landmarks (eye centres, nose base, mouth corners) -> similarity transform onto the 112x112 ArcFace
// template -> SFace (same model file, SHA-256 checked) -> L2-normalised 128 numbers.
// Camera frames stay in memory; only the 128 numbers ever leave this function.

type Point = { x: number; y: number };
type Engine = {
  faceapi: typeof import('@vladmandic/face-api');
  ort: typeof import('onnxruntime-web/wasm');
  session: import('onnxruntime-web/wasm').InferenceSession;
};

export const FACE_MODEL = 'sface-2021dec';
const SIZE = 112;
const TEMPLATE = [38.2946, 51.6963, 73.5318, 51.5014, 56.0252, 71.7366, 41.5493, 92.3655, 70.7299, 92.2041];

let engine: Promise<Engine> | null = null;
export function loadFaceEngine(): Promise<Engine> {
  engine ??= (async () => {
    const [faceapi, ort] = await Promise.all([import('@vladmandic/face-api'), import('onnxruntime-web/wasm')]);
    // face-api's bundled TensorFlow types omit these runtime functions.
    const tf = faceapi.tf as unknown as { setBackend(name: string): Promise<boolean>; ready(): Promise<void> };
    try { if (!(await tf.setBackend('webgl'))) await tf.setBackend('cpu'); } catch { await tf.setBackend('cpu'); }
    await tf.ready();
    await Promise.all([faceapi.nets.tinyFaceDetector.loadFromUri('/models/faceapi'), faceapi.nets.faceLandmark68Net.loadFromUri('/models/faceapi')]);
    ort.env.wasm.wasmPaths = '/models/ort/';
    ort.env.wasm.numThreads = 1;
    ort.env.logLevel = 'error';
    const session = await ort.InferenceSession.create('/models/sface_2021dec.onnx', { executionProviders: ['wasm'], logSeverityLevel: 3 });
    return { faceapi, ort, session };
  })();
  engine.catch(() => { engine = null; });
  return engine;
}

const mean = (points: Point[]): Point => ({ x: points.reduce((s, p) => s + p.x, 0) / points.length, y: points.reduce((s, p) => s + p.y, 0) / points.length });
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

/** Eye centres, nose base and mouth corners, each pair ordered by image x (FaceMath.orderLandmarks). */
function fivePoints(p: Point[]): number[] {
  const eyes = [mean(p.slice(36, 42)), mean(p.slice(42, 48))].sort((a, b) => a.x - b.x);
  const mouth = [p[48], p[54]].sort((a, b) => a.x - b.x);
  return [eyes[0].x, eyes[0].y, eyes[1].x, eyes[1].y, p[33].x, p[33].y, mouth[0].x, mouth[0].y, mouth[1].x, mouth[1].y];
}

/** Least-squares similarity transform src -> dst: x' = a*x - b*y + tx, y' = b*x + a*y + ty (FaceMath.similarity). */
export function similarity(src: number[], dst: number[]): [number, number, number, number] {
  const n = src.length / 2;
  let sx = 0, sy = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i++) { sx += src[2 * i]; sy += src[2 * i + 1]; dx += dst[2 * i]; dy += dst[2 * i + 1]; }
  sx /= n; sy /= n; dx /= n; dy /= n;
  let re = 0, im = 0, norm = 0;
  for (let i = 0; i < n; i++) {
    const ax = src[2 * i] - sx, ay = src[2 * i + 1] - sy, bx = dst[2 * i] - dx, by = dst[2 * i + 1] - dy;
    re += ax * bx + ay * by; im += ax * by - ay * bx; norm += ax * ax + ay * ay;
  }
  if (norm < 1e-9) throw new Error('Landmarks are degenerate');
  const a = re / norm, b = im / norm;
  return [a, b, dx - (a * sx - b * sy), dy - (b * sx + a * sy)];
}

export function normalize(values: ArrayLike<number>): number[] {
  const norm = Math.sqrt(Array.from(values).reduce((s, v) => s + v * v, 0));
  if (norm < 1e-6) throw new Error('Empty face template');
  return Array.from(values, v => v / norm);
}

function average(templates: number[][]): number[] {
  return normalize(templates[0].map((_, i) => templates.reduce((s, t) => s + t[i], 0)));
}

/** Eye aspect ratio from the 68-point landmarks; low values mean the eyes are closed. */
function eyeOpenness(p: Point[]): number {
  const ear = (e: Point[]) => (dist(e[1], e[5]) + dist(e[2], e[4])) / (2 * dist(e[0], e[3]));
  return (ear(p.slice(36, 42)) + ear(p.slice(42, 48))) / 2;
}

async function embed(e: Engine, source: CanvasImageSource, points: number[]): Promise<number[]> {
  const [a, b, tx, ty] = similarity(points, TEMPLATE);
  const canvas = document.createElement('canvas');
  canvas.width = SIZE; canvas.height = SIZE;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.setTransform(a, b, -b, a, tx, ty);
  ctx.drawImage(source, 0, 0);
  const pixels = ctx.getImageData(0, 0, SIZE, SIZE).data;
  const data = new Float32Array(3 * SIZE * SIZE);
  for (let i = 0; i < SIZE * SIZE; i++) {
    data[i] = pixels[4 * i]; data[SIZE * SIZE + i] = pixels[4 * i + 1]; data[2 * SIZE * SIZE + i] = pixels[4 * i + 2];
  }
  const input = new e.ort.Tensor('float32', data, [1, 3, SIZE, SIZE]);
  const output = await e.session.run({ [e.session.inputNames[0]]: input });
  return normalize(output[e.session.outputNames[0]].data as Float32Array);
}

export type CaptureOptions = { blink: boolean; frames: number; onStatus: (text: string) => void; signal: AbortSignal; timeoutMs?: number };

/** Watches the video until one live face is seen (with a blink if asked), then returns the averaged 128-number template. */
/** Luma contrast around one eye: high for an open eye (white sclera, dark iris), low for a closed lid (skin). */
function eyeContrast(ctx: CanvasRenderingContext2D, eye: Point[]): number {
  const xs = eye.map(q => q.x), ys = eye.map(q => q.y);
  const width = Math.max(...xs) - Math.min(...xs);
  const cx = (Math.max(...xs) + Math.min(...xs)) / 2, cy = (Math.max(...ys) + Math.min(...ys)) / 2;
  const box = [cx - width * 0.6, cy - width * 0.35, width * 1.2, width * 0.7].map(Math.round);
  if (box[2] < 4 || box[3] < 2) return 0;
  const px = ctx.getImageData(box[0], box[1], box[2], box[3]).data;
  let sum = 0, sq = 0;
  const n = px.length / 4;
  for (let i = 0; i < px.length; i += 4) { const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]; sum += l; sq += l * l; }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sq / n - mean * mean));
}

/**
 * Watches the video until one live face is seen, then returns the averaged 128-number template.
 * With blink: true, a blink is required first. It is detected from two signals because the landmark model alone
 * underestimates eye closure: the eye-openness ratio and the contrast of the eye region (an eyelid is plain skin).
 */
export async function captureTemplate(video: HTMLVideoElement, options: CaptureOptions): Promise<number[]> {
  options.onStatus('Loading the face check…');
  const e = await loadFaceEngine();
  const detector = new e.faceapi.TinyFaceDetectorOptions({ inputSize: 320, scoreThreshold: 0.5 });
  const deadline = Date.now() + (options.timeoutMs ?? 40_000);
  const probe = document.createElement('canvas');
  const probeCtx = probe.getContext('2d', { willReadFrequently: true })!;
  let earBase = 0, contrastBase = 0, openFrames = 0, closedAt = 0, blinked = !options.blink;
  const samples: number[][] = [];
  while (samples.length < options.frames) {
    if (options.signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    if (Date.now() > deadline) throw new Error(blinked ? 'No clear face was seen in time.' : 'No blink was seen in time. Face the camera in good light and blink once.');
    await new Promise(resolve => setTimeout(resolve, 60));
    if (video.readyState < 2 || !video.videoWidth) continue;
    const faces = await e.faceapi.detectAllFaces(video, detector).withFaceLandmarks();
    if (faces.length === 0) { options.onStatus('Look at the camera'); openFrames = 0; continue; }
    if (faces.length > 1) { options.onStatus('Only one face, please'); openFrames = 0; continue; }
    const face = faces[0];
    if (face.detection.box.width < video.videoWidth * 0.18) { options.onStatus('Move a little closer'); continue; }
    const points = face.landmarks.positions;
    probe.width = video.videoWidth; probe.height = video.videoHeight;
    probeCtx.drawImage(video, 0, 0);
    const ear = eyeOpenness(points);
    const contrast = (eyeContrast(probeCtx, points.slice(36, 42)) + eyeContrast(probeCtx, points.slice(42, 48))) / 2;
    const now = Date.now();
    if (!blinked) {
      if (!closedAt) {
        // Learn this person's open-eye level, then wait for a clear drop.
        if (openFrames >= 4 && (ear < earBase * 0.8 || contrast < contrastBase * 0.8)) closedAt = now;
        else { earBase = Math.max(earBase * 0.995, ear); contrastBase = Math.max(contrastBase * 0.995, contrast); openFrames++; }
        options.onStatus('Blink once');
      } else if (ear > earBase * 0.9 && contrast > contrastBase * 0.9) {
        if (now - closedAt <= 1500) { blinked = true; options.onStatus('Hold still…'); }
        else { closedAt = 0; openFrames = 0; } // a long closure is not a blink
      } else if (now - closedAt > 1500) { closedAt = 0; openFrames = 0; options.onStatus('Blink once'); }
      continue;
    }
    if (contrastBase > 0 && (contrast < contrastBase * 0.85 || ear < earBase * 0.85)) continue; // skip frames with closed eyes
    samples.push(await embed(e, video, fivePoints(points)));
    options.onStatus(`Hold still… ${samples.length}/${options.frames}`);
  }
  return average(samples);
}
