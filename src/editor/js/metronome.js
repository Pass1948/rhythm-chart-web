// 메트로놈(박자 소리) 계산 — 화면·오디오와 분리된 순수 모듈 (Node 로 테스트한다).
// 시간 기준은 히트사운드(노트 소리)와 똑같다: 박의 tick → map.tickToAudioMs(tick) (= 채보 시간 + 시작점). 별도 계산을 하지 않는다.
import { RES } from './timing.js';

// 박자 소리 단위 → 소리 간격(tick). 'beat' = 박(4분음표), 'half' = 반 박(8분), 'grid' = 지금 선택한 격자 칸
export function unitTicks(unit, gridStepTick) {
  if (unit === 'half') return RES / 2;
  if (unit === 'grid') return gridStepTick > 0 ? gridStepTick : RES; // 격자 없음이면 박 단위
  return RES;
}

// 소리 세기 등급: 'bar'(마디 첫 박, 가장 높고 강함) / 'beat'(박) / 'sub'(박 사이, 가장 약함)
function levelOf(map, segIndex, tick) {
  const row = map.rows[segIndex];
  const barTicks = map.barTicks(segIndex);
  const mod = (x, m) => ((x % m) + m) % m;
  const into = tick - row.tick;
  if (mod(into, barTicks) === 0) return 'bar';
  if (mod(into, RES) === 0) return 'beat';
  return 'sub';
}

// 음원 시간 [fromMs, toMs] 안에 있는 박자 소리 목록 [{ms, tick, level}] (시간 순).
// - BPM 이 여러 개인 곡은 구간마다 그 구간의 시작 tick 부터 박을 센다 (마디도 구간마다 새로 시작)
// - 곡 시작 전(음수 시각) 박은 내지 않는다
// - 첫 구간은 tick 0 이전으로도 이어진다 (시작점이 양수여도 곡 앞부분에서 박자가 들리게)
export function beatsInWindow(map, fromMs, toMs, step = RES) {
  const out = [];
  if (!(toMs >= fromMs) || !(step > 0)) return out;
  const lo = map.audioMsToTick(fromMs);
  const hi = map.audioMsToTick(toMs);
  for (let i = 0; i < map.rows.length; i++) {
    const segStart = i === 0 ? -Infinity : map.rows[i].tick;
    const segEnd = i + 1 < map.rows.length ? map.rows[i + 1].tick : Infinity;
    const a = Math.max(lo, segStart);
    const b = Math.min(hi, segEnd);
    if (b < a) continue;
    const base = map.rows[i].tick;
    let k = Math.ceil((a - base) / step - 1e-9);
    for (let t = base + k * step; t <= b + 1e-9 && t < segEnd; t = base + ++k * step) {
      if (t < segStart) continue;
      const ms = map.tickToAudioMs(t);
      if (ms < 0 || ms < fromMs - 1e-6 || ms > toMs + 1e-6) continue; // 곡 시작 전이나 창 밖
      out.push({ ms, tick: t, level: levelOf(map, i, t) });
    }
  }
  return out;
}

// 소리 세기 등급 → 실제 소리 설정 (높이 Hz, 세기 0~1). 박 사이 소리는 더 약하다.
export const CLICK_SOUND = {
  bar: { freq: 1760, gain: 1.0 },
  beat: { freq: 1100, gain: 0.6 },
  sub: { freq: 880, gain: 0.3 },
};

// 시작점 미세 조정: 현재 값에 delta(ms)를 더한다 (소수 둘째 자리까지)
export function nudgeOffset(current, delta) {
  return Math.round((Number(current) + delta) * 100) / 100;
}
