// [테스트] 팝업의 시작 위치·MISS 노트 목록 규칙 — 화면과 분리된 순수 모듈 (Node 로 테스트한다).
// 채보 데이터는 읽기만 하고 바꾸지 않는다.

export const COUNT_IN_TARGET_MS = 2500; // 시작 전 박자 소리 카운트인의 목표 길이 (2~3초)
export const MISS_LIST_LIMIT = 50;

// 시작 위치 이후의 노트만 남긴다. 시작 전에 시작해 걸쳐 있는 롱노트·연타는 빠지고 다음 노트부터 나온다.
export function itemsFrom(items, startMs) {
  return items.filter((it) => it.startMs >= startMs);
}

// 카운트인: 한 박 길이(ms)에 맞춰 박자 소리 횟수를 정한다 (전체 길이가 2~3초 안에 들어오게, 2~8번)
export function countIn(beatMs) {
  const n = Math.max(2, Math.min(8, Math.round(COUNT_IN_TARGET_MS / beatMs)));
  return { beats: n, totalMs: n * beatMs };
}

// 마디 번호(1부터) → 그 마디가 시작하는 tick (타이밍 표의 박자·BPM 변경을 따른다)
export function barStartTick(map, bar) {
  let remaining = Math.max(1, Math.floor(Number(bar) || 1)) - 1;
  for (let i = 0; i < map.rows.length; i++) {
    const step = map.barTicks(i);
    const segEnd = i + 1 < map.rows.length ? map.rows[i + 1].tick : Infinity;
    const bars = Number.isFinite(segEnd) ? Math.ceil((segEnd - map.rows[i].tick) / step) : Infinity;
    if (remaining < bars) return map.rows[i].tick + remaining * step;
    remaining -= bars;
  }
  return 0;
}

// 그 시각(음원 ms)에서 한 박이 몇 ms 인지
export function beatMsAt(map, audioMs) {
  const i = map.segByMs(Math.max(0, audioMs - map.offsetMs));
  return 60000 / map.rows[i].bpm;
}

// 시작 위치를 정한다. mode = 'start'(처음부터) / 'current'(현재 위치부터) / 'selected'(선택한 노트부터) / 'bar'(마디 번호부터)
// hints = {positionMs, selectedTick} (메인 화면이 알려 준 값). 반환 {ok, full, ms, reason}
export function resolveStart({ mode, hints, bar, map }) {
  if (mode === 'start') return { ok: true, full: true, ms: 0, reason: '' };
  if (mode === 'current') {
    const p = hints ? Number(hints.positionMs) : NaN;
    if (!Number.isFinite(p)) return { ok: false, full: false, ms: 0, reason: '메인 화면의 현재 위치를 알 수 없습니다. 메인 화면에서 [테스트]를 다시 눌러 주세요.' };
    return { ok: true, full: false, ms: Math.max(0, p), reason: '' };
  }
  if (mode === 'selected') {
    const t = hints ? hints.selectedTick : null;
    if (t === null || t === undefined || !Number.isFinite(Number(t))) return { ok: false, full: false, ms: 0, reason: '메인 화면에서 시작할 노트를 먼저 선택해 주세요.' };
    return { ok: true, full: false, ms: map.tickToAudioMs(Number(t)), reason: '' };
  }
  if (mode === 'bar') return { ok: true, full: false, ms: map.tickToAudioMs(barStartTick(map, bar)), reason: '' };
  return { ok: false, full: false, ms: 0, reason: '시작 위치를 알 수 없습니다.' };
}

const TYPE_LABEL = { tap: '단타', hold: '롱노트', burst: '연타' };

// 몰려 있는 MISS 구간 요약: 3마디 안에 MISS 가 3개 이상이면 "12~14마디에 MISS 6개". 없으면 null
export function missSummary(bars) {
  const sorted = [...bars].sort((a, b) => a - b);
  let best = null;
  for (let i = 0; i < sorted.length; i++) {
    let j = i;
    while (j + 1 < sorted.length && sorted[j + 1] <= sorted[i] + 2) j++;
    const n = j - i + 1;
    if (n >= 3 && (!best || n > best.count)) best = { from: sorted[i], to: sorted[j], count: n };
  }
  if (!best) return null;
  return { ...best, text: best.from === best.to ? `${best.from}마디에 MISS ${best.count}개` : `${best.from}~${best.to}마디에 MISS ${best.count}개` };
}

// misses = [{id, type, tick, startMs}] → 시간 순 목록(최대 limit개) + 나머지 개수 + 구간 요약. map 은 마디:박 계산에 쓴다.
export function buildMissList(misses, map, limit = MISS_LIST_LIMIT) {
  const sorted = [...misses].sort((a, b) => a.startMs - b.startMs);
  const all = sorted.map((m) => {
    const [bar, beat] = map.barBeat(m.tick).split(':');
    return { id: m.id, bar: Number(bar), label: `${bar}마디 ${beat}박 · ${TYPE_LABEL[m.type] || m.type}` };
  });
  return { entries: all.slice(0, limit), extra: Math.max(0, all.length - limit), summary: missSummary(all.map((e) => e.bar)) };
}
