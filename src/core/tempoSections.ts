/**
 * [04e] 변속(BPM 구간) 편집 규칙: 구간 추가·삭제·BPM 변경·위치 변경·박자 변경을 "새 bpm_map" 으로 계산한다.
 * 노트를 옮기는 일은 하지 않는다(적용은 `retime.ts` 의 retimeChart 가 한다). 화면은 이 파일의 결과를 retimeChart 에 넘기면 된다.
 *
 * 규칙: 구간 시작은 박(960 tick 배수) · 같은 위치 중복 금지 · 구간 길이 최소 2박 · BPM 40~300 · 구간 수 최대 32 · 첫 구간은 tick 0 고정(삭제·이동 불가).
 * 어긴 입력은 이유를 쉬운 한국어로 돌려주고 적용하지 않는다.
 */
import { RESOLUTION, ticksPerBar } from './schema.ts';
import type { BpmEntry } from './schema.ts';
import { BpmMap } from './timing.ts';

export const MAX_TEMPO_SECTIONS = 32;
export const MIN_SECTION_BEATS = 2;
export const TEMPO_MIN_BPM = 40;
export const TEMPO_MAX_BPM = 300;

/** 박자 선택지 (박 수 / 박 단위) */
export const METER_CHOICES: readonly { beats_per_bar: number; beat_unit: number; label: string }[] = [
  { beats_per_bar: 2, beat_unit: 4, label: '2/4' },
  { beats_per_bar: 3, beat_unit: 4, label: '3/4' },
  { beats_per_bar: 4, beat_unit: 4, label: '4/4' },
  { beats_per_bar: 5, beat_unit: 4, label: '5/4' },
  { beats_per_bar: 6, beat_unit: 8, label: '6/8' },
  { beats_per_bar: 7, beat_unit: 4, label: '7/4' },
];

export type TempoResult = { ok: true; entries: BpmEntry[] } | { ok: false; reason: string };

/** 모든 항목에 박자 값을 채워 tick 순서로 정렬한 복사본 */
export function normalizeEntries(entries: BpmEntry[]): Required<BpmEntry>[] {
  return entries
    .map((e) => ({ tick: Math.trunc(Number(e.tick)), bpm: Number(e.bpm), beats_per_bar: e.beats_per_bar ?? 4, beat_unit: e.beat_unit ?? 4 }))
    .sort((a, b) => a.tick - b.tick);
}

const fail = (reason: string): TempoResult => ({ ok: false, reason });
const ok = (entries: BpmEntry[]): TempoResult => ({ ok: true, entries });

/** 구간 목록이 규칙에 맞는지 검사한다. 맞으면 null, 아니면 이유. endTick 은 곡 끝 tick(알면). */
export function checkSections(entries: BpmEntry[], endTick?: number | null): string | null {
  const rows = normalizeEntries(entries);
  if (rows.length < 1) return 'BPM 구간이 비어 있습니다.';
  if (rows.length > MAX_TEMPO_SECTIONS) return `구간은 최대 ${MAX_TEMPO_SECTIONS}개까지 만들 수 있습니다.`;
  if (rows[0]!.tick !== 0) return '첫 구간은 곡 시작(tick 0)에서 시작해야 합니다.';
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i]!;
    if (!Number.isFinite(r.bpm)) return 'BPM은 숫자로 입력해 주세요.';
    if (r.bpm < TEMPO_MIN_BPM || r.bpm > TEMPO_MAX_BPM) return `BPM은 ${TEMPO_MIN_BPM}~${TEMPO_MAX_BPM} 사이로 입력해 주세요.`;
    if (!Number.isInteger(r.tick) || r.tick < 0 || r.tick % RESOLUTION !== 0) return '구간의 시작은 박 위치여야 합니다.';
    if (i > 0 && r.tick === rows[i - 1]!.tick) return '같은 위치에 이미 구간이 있습니다.';
    if (i > 0 && r.tick - rows[i - 1]!.tick < MIN_SECTION_BEATS * RESOLUTION) return `구간은 최소 ${MIN_SECTION_BEATS}박 이상이어야 합니다. 앞 구간과 너무 가깝습니다.`;
  }
  if (endTick !== undefined && endTick !== null && rows.length > 1) {
    const last = rows[rows.length - 1]!;
    if (last.tick >= endTick) return '곡 길이를 넘는 위치에는 구간을 만들 수 없습니다.';
    if (endTick - last.tick < MIN_SECTION_BEATS * RESOLUTION) return `곡 끝에 너무 가까워 구간을 만들 수 없습니다. (최소 ${MIN_SECTION_BEATS}박)`;
  }
  return null;
}

function finish(rows: BpmEntry[], endTick?: number | null): TempoResult {
  const reason = checkSections(rows, endTick);
  return reason ? fail(reason) : ok(normalizeEntries(rows));
}

/** 가장 가까운 박 위치(tick). */
export function nearestBeatTick(tick: number): number {
  return Math.max(0, Math.round(tick / RESOLUTION) * RESOLUTION);
}

/** 가장 가까운 마디선 위치(tick). 마디선이 없으면(곡 길이를 넘음) 가장 가까운 박. */
export function nearestBarTick(entries: BpmEntry[], tick: number, endTick: number): number {
  const lines = new BpmMap(entries).barLines(Math.max(endTick, Math.ceil(tick) + 8 * RESOLUTION));
  let best: number | null = null;
  for (const [t] of lines) {
    if (best === null || Math.abs(t - tick) < Math.abs(best - tick)) best = t;
  }
  return best === null ? nearestBeatTick(tick) : best;
}

/** 구간 추가. 새 구간의 BPM·박자는 그 위치가 속한 구간과 같다(bpm 을 주면 그 값). */
export function addSection(entries: BpmEntry[], tick: number, opts: { endTick?: number | null; bpm?: number } = {}): TempoResult {
  const rows = normalizeEntries(entries);
  if (!Number.isFinite(tick) || tick % RESOLUTION !== 0) return fail('구간의 시작은 박 위치여야 합니다.');
  if (tick <= 0) return fail('곡 맨 앞(첫 구간)에는 구간을 더 만들 수 없습니다.');
  const base = new BpmMap(rows).entryAt(tick);
  return finish([...rows, { tick, bpm: opts.bpm ?? base.bpm, beats_per_bar: base.beats_per_bar, beat_unit: base.beat_unit }], opts.endTick);
}

/** 구간 삭제(첫 구간은 삭제 불가). 지운 구간의 자리는 앞 구간이 이어받는다. */
export function removeSection(entries: BpmEntry[], index: number): TempoResult {
  const rows = normalizeEntries(entries);
  if (index <= 0) return fail('첫 구간은 삭제할 수 없습니다.');
  if (index >= rows.length) return fail('없는 구간입니다.');
  rows.splice(index, 1);
  return finish(rows);
}

/** 한 구간의 BPM 만 바꾼다(뒤 구간의 시작 tick 은 그대로라 그 뒤 시간이 모두 바뀐다). */
export function setSectionBpm(entries: BpmEntry[], index: number, bpm: number, endTick?: number | null): TempoResult {
  const rows = normalizeEntries(entries);
  if (index < 0 || index >= rows.length) return fail('없는 구간입니다.');
  rows[index]!.bpm = Number(bpm);
  return finish(rows, endTick);
}

/**
 * BPM 을 바꾸되 뒤 구간은 소리 위치를 유지한다: 뒤 구간의 시작을 "바뀌기 전 소리 위치에서 가장 가까운 박"으로 옮긴다.
 * (구간 시작은 박 단위라 최대 반 박까지 어긋날 수 있다.)
 */
export function setSectionBpmKeepAfter(entries: BpmEntry[], index: number, bpm: number, endTick?: number | null): TempoResult {
  const rows = normalizeEntries(entries);
  if (index < 0 || index >= rows.length) return fail('없는 구간입니다.');
  const oldMap = new BpmMap(rows);
  const targets = rows.map((r) => oldMap.tickToMs(r.tick));
  if (!Number.isFinite(bpm) || bpm < TEMPO_MIN_BPM || bpm > TEMPO_MAX_BPM) return fail(`BPM은 ${TEMPO_MIN_BPM}~${TEMPO_MAX_BPM} 사이로 입력해 주세요.`);
  rows[index]!.bpm = Number(bpm);
  for (let j = index + 1; j < rows.length; j++) {
    const prev = rows[j - 1]!;
    const prevStartMs = new BpmMap(rows.slice(0, j)).tickToMs(prev.tick);
    const beatMs = 60000 / prev.bpm;
    const beats = Math.round((targets[j]! - prevStartMs) / beatMs);
    if (beats < MIN_SECTION_BEATS) return fail(`BPM을 이렇게 바꾸면 ${j + 1}번 구간이 앞 구간과 너무 가까워집니다. (최소 ${MIN_SECTION_BEATS}박)`);
    rows[j]!.tick = prev.tick + beats * RESOLUTION;
  }
  return finish(rows, endTick);
}

/** 구간 시작 위치를 옮긴다(첫 구간은 이동 불가). tick 은 박 위치여야 한다. */
export function setSectionStart(entries: BpmEntry[], index: number, tick: number, endTick?: number | null): TempoResult {
  const rows = normalizeEntries(entries);
  if (index <= 0) return fail('첫 구간은 곡 시작에 고정되어 옮길 수 없습니다.');
  if (index >= rows.length) return fail('없는 구간입니다.');
  if (!Number.isFinite(tick) || tick % RESOLUTION !== 0) return fail('구간의 시작은 박 위치여야 합니다.');
  rows[index]!.tick = tick;
  // 옮긴 결과가 앞 구간을 넘어가면(순서 뒤바뀜) 정렬되기 전에 거절한다
  const before = rows[index - 1];
  const after = rows[index + 1];
  if (before && tick <= before.tick) return fail(`앞 구간(${index}번)보다 뒤로만 옮길 수 있습니다.`);
  if (after && tick >= after.tick) return fail(`다음 구간(${index + 2}번)보다 앞으로만 옮길 수 있습니다.`);
  return finish(rows, endTick);
}

/** 구간의 박자(마디당 박 수 / 박 단위)를 바꾼다. */
export function setSectionMeter(entries: BpmEntry[], index: number, beatsPerBar: number, beatUnit: number): TempoResult {
  const rows = normalizeEntries(entries);
  if (index < 0 || index >= rows.length) return fail('없는 구간입니다.');
  if (!METER_CHOICES.some((m) => m.beats_per_bar === beatsPerBar && m.beat_unit === beatUnit)) return fail('지원하지 않는 박자입니다.');
  rows[index]!.beats_per_bar = beatsPerBar;
  rows[index]!.beat_unit = beatUnit;
  return finish(rows);
}

/** 전체를 한 BPM 으로 되돌린다. bpm 을 안 주면 첫 구간의 BPM·박자를 쓴다. */
export function resetToSingle(entries: BpmEntry[], bpm?: number): TempoResult {
  const rows = normalizeEntries(entries);
  const first = rows[0] ?? { tick: 0, bpm: 120, beats_per_bar: 4, beat_unit: 4 };
  return finish([{ tick: 0, bpm: bpm ?? first.bpm, beats_per_bar: first.beats_per_bar, beat_unit: first.beat_unit }]);
}

/** 마디:박 → tick. index 번 구간 앞쪽(index-1 번 구간의 마디 번호 체계)에서 마디·박(정수)으로 위치를 읽는다. 읽을 수 없으면 null. */
export function barBeatToTick(entries: BpmEntry[], index: number, bar: number, beat: number): number | null {
  const rows = normalizeEntries(entries);
  const k = Math.min(index - 1, rows.length - 1);
  if (k < 0 || !Number.isInteger(bar) || !Number.isInteger(beat) || bar < 1 || beat < 1) return null;
  let barNo = 1;
  for (let i = 0; i < k; i++) {
    barNo += Math.ceil((rows[i + 1]!.tick - rows[i]!.tick) / ticksPerBar(rows[i]!.beats_per_bar, rows[i]!.beat_unit));
  }
  const r = rows[k]!;
  if (beat > r.beats_per_bar) return null;
  return r.tick + (bar - barNo) * ticksPerBar(r.beats_per_bar, r.beat_unit) + (beat - 1) * RESOLUTION;
}
