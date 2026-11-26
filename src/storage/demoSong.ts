/**
 * 체험용 데모 곡: 음원 파일 없이 코드로 합성한 30초 드럼 비트(킥·스네어·하이햇 + 낮은 베이스음).
 * 계산으로 직접 소리를 만들어 WAV(16비트 모노)로 감싼다. 같은 결과가 항상 나온다(난수는 고정 씨앗).
 * 어떤 파일도 내려받거나 포함하지 않는다.
 */

export const DEMO_NAME = '체험용 데모 곡 (합성 드럼 비트)';
export const DEMO_BPM = 120;
export const DEMO_SECONDS = 30;
export const DEMO_SAMPLE_RATE = 44100;

/** 고정 씨앗 난수(0~1): 같은 소리가 나오게 한다 */
function makeRandom(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** 킥(둥) 소리를 버퍼에 더한다: 낮아지는 사인파 */
function addKick(buf: Float32Array, start: number, sr: number): void {
  const len = Math.floor(sr * 0.22);
  let phase = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const freq = 50 + 110 * Math.exp(-t * 28);
    phase += (2 * Math.PI * freq) / sr;
    buf[start + i]! += Math.sin(phase) * Math.exp(-t * 14) * 0.9;
  }
}

/** 스네어(탁) 소리: 잡음 + 짧은 몸통음 */
function addSnare(buf: Float32Array, start: number, sr: number, rnd: () => number): void {
  const len = Math.floor(sr * 0.18);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const noise = (rnd() * 2 - 1) * Math.exp(-t * 26);
    const body = Math.sin(2 * Math.PI * 190 * t) * Math.exp(-t * 30);
    buf[start + i]! += noise * 0.55 + body * 0.35;
  }
}

/** 하이햇(칙) 소리: 짧은 고음 잡음(앞 값과의 차이로 저음을 덜어 낸다) */
function addHat(buf: Float32Array, start: number, sr: number, rnd: () => number, open: boolean): void {
  const len = Math.floor(sr * (open ? 0.12 : 0.045));
  let prev = 0;
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    const n = rnd() * 2 - 1;
    const hp = n - prev;
    prev = n;
    buf[start + i]! += hp * Math.exp(-t * (open ? 30 : 90)) * 0.22;
  }
}

/** 낮은 베이스음(마디 첫 박): 부드러운 사인파 */
function addBass(buf: Float32Array, start: number, sr: number, freq: number, seconds: number): void {
  const len = Math.floor(sr * seconds);
  for (let i = 0; i < len && start + i < buf.length; i++) {
    const t = i / sr;
    buf[start + i]! += Math.sin(2 * Math.PI * freq * t) * Math.exp(-t * 3) * 0.28;
  }
}

/** 데모 곡의 소리(모노 Float32Array, -1~1)를 합성한다. 120BPM 4/4, 첫 박은 0ms 에서 시작한다. */
export function renderDemoSamples(sr: number = DEMO_SAMPLE_RATE, seconds: number = DEMO_SECONDS): Float32Array {
  const buf = new Float32Array(Math.floor(sr * seconds));
  const rnd = makeRandom(19491);
  const beat = 60 / DEMO_BPM; // 0.5초
  const step = beat / 2; // 8분음표
  const steps = Math.floor(seconds / step);
  for (let k = 0; k < steps; k++) {
    const at = Math.floor(k * step * sr);
    const bar = Math.floor(k / 8);
    const pos = k % 8; // 마디 안 8분음표 위치 0~7
    const kickHit = pos === 0 || pos === 4 || (pos === 5 && bar % 2 === 1) || (pos === 3 && bar % 4 === 3);
    if (kickHit) addKick(buf, at, sr);
    if (pos === 2 || pos === 6) addSnare(buf, at, sr, rnd);
    addHat(buf, at, sr, rnd, pos === 7);
    if (bar >= 4 && pos % 2 === 1) addHat(buf, at + Math.floor((step / 2) * sr), sr, rnd, false); // 뒤 마디는 하이햇이 촘촘해진다
    if (pos === 0) addBass(buf, at, sr, bar % 2 === 0 ? 55 : 65.4, 0.9);
  }
  let peak = 0;
  for (let i = 0; i < buf.length; i++) peak = Math.max(peak, Math.abs(buf[i]!));
  const scale = peak > 0 ? 0.9 / peak : 1;
  for (let i = 0; i < buf.length; i++) buf[i]! *= scale;
  return buf;
}

/** Float32 소리를 WAV(16비트 PCM 모노) 바이트로 감싼다. */
export function encodeWav16(samples: Float32Array, sampleRate: number): Uint8Array {
  const dataLen = samples.length * 2;
  const out = new Uint8Array(44 + dataLen);
  const view = new DataView(out.buffer);
  const text = (pos: number, s: string): void => {
    for (let i = 0; i < s.length; i++) view.setUint8(pos + i, s.charCodeAt(i));
  };
  text(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // 모노
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, 'data');
  view.setUint32(40, dataLen, true);
  for (let i = 0; i < samples.length; i++) {
    const v = Math.max(-1, Math.min(1, samples[i]!));
    view.setInt16(44 + i * 2, Math.round(v * 32767), true);
  }
  return out;
}

/** 데모 곡 WAV 파일(Blob)을 만든다. 이름은 '체험용 데모 곡 (합성 드럼 비트).wav' */
export function makeDemoFile(): File {
  const wav = encodeWav16(renderDemoSamples(), DEMO_SAMPLE_RATE);
  return new File([wav as BlobPart], `${DEMO_NAME}.wav`, { type: 'audio/wav' });
}
