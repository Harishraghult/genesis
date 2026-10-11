// Puts the face-check models where the site serves them (public/models, not committed):
// - face-api detector and 68-point landmarks (from the npm package),
// - onnxruntime-web WebAssembly files,
// - the SFace recognition model, the same file the Android app bundles (copied, or downloaded and SHA-256 checked).
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'models');
const SFACE_SHA256 = '0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79';
const SFACE_URL = 'https://github.com/opencv/opencv_zoo/raw/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx';

function copy(from, to) { mkdirSync(dirname(to), { recursive: true }); copyFileSync(from, to); }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

const faceapi = join(root, 'node_modules', '@vladmandic', 'face-api', 'model');
for (const name of ['tiny_face_detector_model-weights_manifest.json', 'tiny_face_detector_model.bin',
  'face_landmark_68_model-weights_manifest.json', 'face_landmark_68_model.bin']) copy(join(faceapi, name), join(out, 'faceapi', name));

const ort = join(root, 'node_modules', 'onnxruntime-web', 'dist');
for (const name of ['ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs']) copy(join(ort, name), join(out, 'ort', name));

const target = join(out, 'sface_2021dec.onnx');
if (!existsSync(target) || sha256(readFileSync(target)) !== SFACE_SHA256) {
  const local = join(root, '..', 'android', 'app', 'src', 'main', 'assets', 'face', 'sface_2021dec.onnx');
  let bytes;
  if (existsSync(local)) bytes = readFileSync(local);
  else {
    const response = await fetch(SFACE_URL);
    if (!response.ok) throw new Error(`SFace download failed: HTTP ${response.status}`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  if (sha256(bytes) !== SFACE_SHA256) throw new Error('SFace model hash mismatch: refusing to use an unreviewed model');
  mkdirSync(out, { recursive: true });
  writeFileSync(target, bytes);
}
console.log('face models ready in public/models');
