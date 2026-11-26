// 파형 띠: 음원의 소리 크기를 세로 타임라인 오른쪽 끝에 그린다 (DAW·DJ 소프트웨어의 파형처럼 가운데 세로선 기준 좌우 대칭).
// 시간은 타임라인과 같은 y좌표(같은 msOfY)로 계산하므로 스크롤·확대·축소·재생 위치에서 어긋나지 않는다.
// 파형 데이터(WaveMap)는 src/analysis/wave.ts 가 만든 0~255 값이다: 20ms마다 [전체, 저음, 중음, 고음].

// 띠 폭(px): 넓은 캔버스 84, 중간 64, 좁은 캔버스(폰) 44 — 레인이 좁아지지 않고 가로 스크롤이 생기지 않게 캔버스 폭에 맞춘다
export function stripWidth(canvasW) {
  return canvasW < 360 ? 44 : canvasW < 460 ? 64 : 84;
}

export const CH_ALL = 0;
export const CH_LOW = 1;
export const CH_MID = 2;
export const CH_HIGH = 3;
const CH = 4;

// '#rrggbb' / 'rgb(a)' 글자 → [r, g, b]
export function parseColor(str, fallback = [0, 0, 0]) {
  const s = String(str || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(s);
  if (m) return [parseInt(m[1].slice(0, 2), 16), parseInt(m[1].slice(2, 4), 16), parseInt(m[1].slice(4, 6), 16)];
  m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) return [...m[1]].map((c) => parseInt(c + c, 16));
  m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)/i.exec(s);
  if (m) return [Math.round(+m[1]), Math.round(+m[2]), Math.round(+m[3])];
  return fallback;
}

// 색 3개(저음 주황 / 중음 초록·청록 / 고음 하늘·흰)와 바탕을 [r,g,b] 로
export function waveColors(low, mid, high, bg) {
  return {
    low: parseColor(low, [255, 154, 61]),
    mid: parseColor(mid, [63, 214, 160]),
    high: parseColor(high, [143, 216, 255]),
    bg: parseColor(bg, [22, 22, 24]),
  };
}

// 시간 구간 [msA, msB] 안의 한 채널의 가장 센 값 (구간 밖이면 0)
export function valueInRange(wave, channel, msA, msB) {
  let a = Math.round(Math.min(msA, msB) / wave.hop_ms);
  let b = Math.round(Math.max(msA, msB) / wave.hop_ms);
  if (b < 0 || a >= wave.frames) return 0;
  a = Math.max(0, a);
  b = Math.min(wave.frames - 1, b);
  if (b - a > 64) b = a + 64;
  let v = 0;
  for (let f = a; f <= b; f++) {
    const x = wave.data[f * CH + channel];
    if (x > v) v = x;
  }
  return v;
}

// 작은 소리도 보이게 하는 보정(제곱근): 0~255 → 0~1
export function ampOf(value) {
  return Math.sqrt(Math.max(0, Math.min(255, value)) / 255);
}

// 저·중·고음 크기 비율로 섞은 색 [r,g,b]. 소리가 거의 없으면 고음색.
export function mixBandColor(low, mid, high, colors) {
  const wl = Math.sqrt(Math.max(0, low));
  const wm = Math.sqrt(Math.max(0, mid));
  const wh = Math.sqrt(Math.max(0, high));
  const sum = wl + wm + wh;
  if (sum < 1e-6) return colors.high;
  return [0, 1, 2].map((i) => Math.round((colors.low[i] * wl + colors.mid[i] * wm + colors.high[i] * wh) / sum));
}

// 띠 그림 픽셀을 채운다: rows 줄 x w 칸 (RGBA). msAtRowEdge(r) = r 번째 줄 위쪽 가장자리의 시간(줄 번호가 커질수록 시간이 앞으로 간다).
// 편집기의 msOfY 와 같은 함수를 넘겨 받으므로 타임라인과 같은 시간 축을 쓴다. 가운데 세로선 기준 좌우 대칭.
export function fillWavePixels(out, wave, w, rows, msAtRowEdge, colors) {
  const center = w / 2;
  const bg = colors.bg;
  for (let r = 0; r < rows; r++) {
    const msTop = msAtRowEdge(r);
    const msBottom = msAtRowEdge(r + 1);
    const all = valueInRange(wave, CH_ALL, msBottom, msTop);
    const half = ampOf(all) * (center - 0.5);
    const col = all > 0 ? mixBandColor(valueInRange(wave, CH_LOW, msBottom, msTop), valueInRange(wave, CH_MID, msBottom, msTop), valueInRange(wave, CH_HIGH, msBottom, msTop), colors) : bg;
    for (let x = 0; x < w; x++) {
      const d = Math.abs(x + 0.5 - center);
      const cover = all > 0 ? Math.max(0, Math.min(1, half - d + 0.5)) : 0;
      const o = (r * w + x) * 4;
      out[o] = bg[0] + (col[0] - bg[0]) * cover;
      out[o + 1] = bg[1] + (col[1] - bg[1]) * cover;
      out[o + 2] = bg[2] + (col[2] - bg[2]) * cover;
      out[o + 3] = 255;
    }
  }
}
