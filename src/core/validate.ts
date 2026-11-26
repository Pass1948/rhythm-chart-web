/**
 * 채보 검증. 결과는 오류(내보내기 차단)와 경고(내보내기 가능)로 나뉜다. 메시지는 쉬운 한국어.
 * 원본: app\core\validate.py (같은 규칙·같은 코드 이름·같은 메시지)
 */
import { loadValidateConfig } from './config.ts';
import type { ValidateConfig } from './config.ts';
import {
  BURST_MAX_COUNT,
  BURST_MIN_COUNT,
  DECODER_DELAY_LIMIT_MS,
  FOUR_KEY_MAX_HELD,
  FOUR_KEY_MAX_SIMULTANEOUS,
  fourKeyHand,
  KEY_MODES,
  LANE_BOTH,
  NOTE_BURST,
  NOTE_HOLD,
  NOTE_TYPE_NAMES,
  NOTE_TYPES,
  RESOLUTION,
  laneLabel,
  laneSortKey,
  occupies,
} from './schema.ts';
import type { ChartNote, ChartV2, Difficulty } from './schema.ts';
import { BpmMap } from './timing.ts';
import { fmt } from './util.ts';

export const ERROR = 'error';
export const WARNING = 'warning';

/** 검사 결과 항목 하나. */
export interface Issue {
  level: string; // error / warning
  code: string; // 기계가 구분하는 코드
  message: string; // 사람이 읽는 한국어 설명
  difficulty: string;
  note_ids: number[]; // 해당 노트로 이동할 때 쓰는 id
}

/** 검증 결과(원본 /validate 응답과 같은 모양) */
export interface ValidationResult {
  errors: number;
  warnings: number;
  issues: Issue[];
}

/** validateChart 옵션: 기준 설정을 바꿔 넣고 싶을 때 */
export interface ValidateOptions {
  config?: ValidateConfig;
}

function isInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isInteger(v);
}
function laneName(lane: unknown, keyMode: number = 2): string {
  return laneLabel(lane, keyMode);
}
function idsText(ids: number[]): string {
  return ids.map((i) => `#${i}`).join(', ');
}

/** 채보 전체를 검사해 Issue 목록을 돌려준다. 잘못된 데이터가 있어도 멈추지 않는다. */
export function validateIssues(chart: ChartV2, config?: ValidateConfig): Issue[] {
  const cfg = config ?? loadValidateConfig();
  const issues: Issue[] = [];
  const song = chart.song ?? ({} as ChartV2['song']);
  const offset = song.audio_offset_ms || 0;
  const duration = song.duration_ms || 0;

  let delay: number = song.decoder_delay_ms || 0;
  if (typeof delay !== 'number' || Math.abs(delay) > DECODER_DELAY_LIMIT_MS) {
    issues.push({
      level: WARNING,
      code: 'decoder_delay',
      message: `디코더 지연 보정값(${delay} ms)이 보통 범위(±${DECODER_DELAY_LIMIT_MS} ms)를 벗어났습니다.`,
      difficulty: '',
      note_ids: [],
    });
    delay = 0;
  }

  // [10단계] 키 모드: 없으면 2키. 2·4 외의 값, 또는 레인 수가 키 모드와 다르면 오류(4키 채보를 2키 코드가 잘못 읽지 않게)
  const rawKm = (chart as { keyMode?: unknown }).keyMode;
  let km = 2;
  if (rawKm !== undefined && rawKm !== null) {
    if (typeof rawKm === 'number' && KEY_MODES.includes(rawKm)) km = rawKm;
    else issues.push({ level: ERROR, code: 'key_mode', message: `키 모드(${String(rawKm)})를 지원하지 않습니다. 2키 또는 4키만 쓸 수 있습니다.`, difficulty: '', note_ids: [] });
  }
  if ((chart.lanes ?? km) !== km) {
    const msg = km === 2 ? '레인 수는 2개(왼쪽·오른쪽)만 지원합니다.' : `키 모드(${km}키)와 레인 수(${String(chart.lanes)})가 맞지 않습니다. 4키 채보는 레인 수가 4여야 합니다.`;
    issues.push({ level: ERROR, code: 'lanes', message: msg, difficulty: '', note_ids: [] });
  }

  let bpmMap: BpmMap | null = null;
  try {
    const timing = chart.timing ?? ({} as ChartV2['timing']);
    bpmMap = new BpmMap(timing.bpm_map || [], timing.resolution ?? RESOLUTION);
  } catch (exc) {
    issues.push({
      level: ERROR,
      code: 'timing',
      message: `BPM 정보에 문제가 있습니다: ${exc instanceof Error ? exc.message : String(exc)}`,
      difficulty: '',
      note_ids: [],
    });
  }

  for (const diff of chart.difficulties || []) {
    // Unity 에서 실제로 재생되는 시각(디코더 지연 포함)으로 검사
    issues.push(...validateDifficulty(diff, bpmMap, offset + delay, duration, cfg, km));
  }
  return issues;
}

/** 계약 함수: 채보를 검사해 {errors, warnings, issues} 를 돌려준다. */
export function validateChart(chart: ChartV2, opts?: ValidateOptions): ValidationResult {
  const issues = validateIssues(chart, opts?.config);
  return {
    errors: issues.filter((i) => i.level === ERROR).length,
    warnings: issues.filter((i) => i.level !== ERROR).length,
    issues,
  };
}

export function hasErrors(issues: Issue[]): boolean {
  return issues.some((i) => i.level === ERROR);
}

function validateDifficulty(diff: Difficulty, bpmMap: BpmMap | null, offset: number, duration: number, cfg: ValidateConfig, km: number = 2): Issue[] {
  const name = diff.name ?? '?';
  const issues: Issue[] = [];
  const add = (level: string, code: string, msg: string, ids: number[] = []): void => {
    issues.push({ level, code, message: `[${name}] ${msg}`, difficulty: name, note_ids: [...ids] });
  };

  const valid: ChartNote[] = []; // 기본 형식이 맞아 이후 검사에 쓸 수 있는 노트
  const seenIds = new Set<number>();
  for (const n of diff.notes || []) {
    const nid = n.id;
    if (seenIds.has(nid)) add(ERROR, 'dup_id', `노트 번호 #${nid} 가 두 번 이상 쓰였습니다.`, [nid]);
    seenIds.add(nid);
    let ok = true;
    const ntype = n.type;
    if (!NOTE_TYPES.includes(ntype as string)) {
      add(ERROR, 'bad_type', `노트 #${nid}: 알 수 없는 노트 종류입니다 (${String(ntype)}).`, [nid]);
      ok = false;
    }
    const lane = n.lane;
    if (ntype === NOTE_BURST) {
      if (lane !== LANE_BOTH) {
        add(ERROR, 'bad_lane', `연타노트 #${nid}: 연타노트는 레인 없이 양쪽(both)이어야 합니다 (${String(lane)}).`, [nid]);
        ok = false;
      }
    } else if (!(typeof lane === 'number' && Number.isInteger(lane) && lane >= 0 && lane < km)) {
      const want = km === 4 ? '레인은 0~3(1~4레인)이어야 합니다' : '레인은 왼쪽(0)이나 오른쪽(1)이어야 합니다';
      add(ERROR, 'bad_lane', `노트 #${nid}: ${want} (${String(lane)}).`, [nid]);
      ok = false;
    }
    if (!isInt(n.tick) || n.tick < 0) {
      add(ERROR, 'bad_tick', `노트 #${nid}: 위치(tick)가 올바르지 않습니다.`, [nid]);
      ok = false;
    }
    if (ntype === NOTE_HOLD || ntype === NOTE_BURST) {
      const ln = n.length_tick;
      if (!isInt(ln) || ln <= 0) {
        add(ERROR, 'bad_length', `${NOTE_TYPE_NAMES[ntype]} #${nid}: 길이가 0 이하이거나 없습니다.`, [nid]);
        ok = false;
      }
    }
    if (ntype === NOTE_BURST) {
      const c = n.count;
      if (!isInt(c) || !(BURST_MIN_COUNT <= c && c <= BURST_MAX_COUNT)) {
        add(ERROR, 'bad_count', `연타노트 #${nid}: 연타 횟수는 ${BURST_MIN_COUNT}~${BURST_MAX_COUNT}회여야 합니다 (현재 ${String(c)}).`, [nid]);
        ok = false;
      }
    }
    if (ok) valid.push(n);
  }

  // 같은 레인·같은 위치 중복
  const byPos = new Map<string, number[]>();
  for (const n of valid) {
    const key = `${String(n.lane)}|${n.tick}`;
    const list = byPos.get(key);
    if (list) list.push(n.id);
    else byPos.set(key, [n.id]);
  }
  for (const [key, ids] of byPos) {
    if (ids.length > 1) {
      const lane = key.split('|')[0]!;
      add(ERROR, 'duplicate', `${km === 4 ? laneName(Number(lane), km) : laneName(lane) + ' 레인'}의 같은 위치에 노트가 겹쳐 있습니다: ${idsText(ids)}`, ids);
    }
  }

  // 곡 길이 초과 / 곡 시작 앞
  if (bpmMap !== null) {
    for (const n of valid) {
      const endTick = n.tick + (n.length_tick || 0);
      const endMs = bpmMap.tickToMs(endTick) + offset;
      const startMs = bpmMap.tickToMs(n.tick) + offset;
      if (duration && endMs > duration) {
        add(ERROR, 'over_duration', `노트 #${n.id} 가 곡 길이(${fmt(duration / 1000.0, 1)}초)를 넘어섭니다 (끝 ${fmt(endMs / 1000.0, 1)}초).`, [n.id]);
      }
      if (startMs < -0.5) {
        add(WARNING, 'before_start', `노트 #${n.id} 가 음원 시작보다 앞(${fmt(startMs / 1000.0, 2)}초)에 있습니다.`, [n.id]);
      }
    }
  }

  // 연타노트 구간: 양쪽 레인 어디에도 다른 노트를 둘 수 없다 (연타끼리 겹침 포함, 한 쌍은 한 번만 알린다)
  for (const n of valid.filter((x) => x.type === NOTE_BURST)) {
    const end = n.tick + (n.length_tick as number);
    for (const other of valid) {
      if (other.id === n.id || !occupies(other, n.tick, end)) continue;
      if (other.type === NOTE_BURST && other.id < n.id) continue;
      add(
        ERROR,
        'burst_overlap',
        `연타노트 #${n.id} 구간 안에는 다른 노트를 둘 수 없습니다 (겹친 노트: ${NOTE_TYPE_NAMES[other.type as string]} #${other.id}).`,
        [n.id, other.id],
      );
    }
  }

  // 롱노트 구간 검사 (롱노트·연타노트 길이 경고 포함)
  const byLane: Record<number, ChartNote[]> = {};
  for (let l = 0; l < km; l++) byLane[l] = [];
  for (const n of valid) {
    if (typeof n.lane === 'number' && byLane[n.lane]) byLane[n.lane]!.push(n);
  }
  for (let l = 0; l < km; l++) byLane[l]!.sort((a, b) => a.tick - b.tick);
  for (const n of valid) {
    if (n.type !== NOTE_HOLD && n.type !== NOTE_BURST) continue;
    const end = n.tick + (n.length_tick as number);
    const label = NOTE_TYPE_NAMES[n.type as string]!;
    if (n.type === NOTE_HOLD) {
      const lane = n.lane as number;
      for (const other of byLane[lane]!) {
        if (other.id === n.id) continue;
        if (n.tick <= other.tick && other.tick < end && other.tick !== n.tick) {
          add(ERROR, 'overlap_same_lane', `${label} #${n.id} 구간 안에 같은 레인의 다른 노트 #${other.id} 가 겹칩니다.`, [n.id, other.id]);
        }
      }
      const opposite = km === 2 ? byLane[1 - lane]!.filter((o) => n.tick <= o.tick && o.tick < end).map((o) => o.id) : [];
      const policy = cfg.opposite_lane_policy;
      if (opposite.length && (policy === 'warn' || policy === 'error')) {
        const level = policy === 'error' ? ERROR : WARNING;
        add(level, 'opposite_lane', `${label} #${n.id} 구간 중 반대 레인에 노트가 있습니다: ${idsText(opposite)}`, [n.id, ...opposite]);
      }
    }
    if (bpmMap !== null) {
      const lengthMs = bpmMap.tickToMs(end) - bpmMap.tickToMs(n.tick);
      if (n.type === NOTE_BURST && lengthMs > 0) {
        const perSec = (n.count as number) / (lengthMs / 1000.0);
        if (perSec > cfg.max_burst_per_sec) {
          add(
            WARNING,
            'burst_too_fast',
            `연타노트 #${n.id}: 구간이 너무 짧아 초당 ${fmt(perSec, 1)}회를 눌러야 합니다 (권장 ${cfg.max_burst_per_sec}회 이하).`,
            [n.id],
          );
        }
      }
      if (n.type === NOTE_HOLD && (n.length_tick as number) < cfg.min_hold_beats * RESOLUTION) {
        add(WARNING, 'hold_too_short', `롱노트 #${n.id} 가 너무 짧습니다 (${cfg.min_hold_beats}박 미만).`, [n.id]);
      }
    }
  }

  const ordered = [...valid].sort((a, b) => a.tick - b.tick || laneSortKey(a.lane) - laneSortKey(b.lane));
  const single = ordered.filter((n) => typeof n.lane === 'number'); // 연타(양쪽)는 좌우 비율·같은 레인 연속 계산에서 제외

  // 같은 레인 연속
  let run: ChartNote[] = [];
  for (const n of single) {
    if (run.length && run[run.length - 1]!.lane === n.lane) {
      run.push(n);
    } else {
      flushRun(run, cfg, add, km);
      run = [n];
    }
  }
  flushRun(run, cfg, add, km);

  // 초당 노트 수와 동시 입력
  if (bpmMap !== null && ordered.length) {
    const times = ordered.map((n) => bpmMap.tickToMs(n.tick));
    let j = 0;
    let worst: [number, number] = [0, 0];
    for (let i = 0; i < ordered.length; i++) {
      while (times[i]! - times[j]! >= 1000) j += 1;
      if (i - j + 1 > worst[0]) worst = [i - j + 1, j];
    }
    if (worst[0] > cfg.max_nps) {
      const startIdx = worst[1];
      add(
        WARNING,
        'too_dense',
        `${fmt(times[startIdx]! / 1000.0, 1)}초 근처에서 1초에 노트가 ${worst[0]}개 나옵니다 (권장 ${cfg.max_nps}개 이하).`,
        [ordered[startIdx]!.id],
      );
    }
  }
  const groups = new Map<number, ChartNote[]>();
  for (const n of single) {
    const g = groups.get(n.tick);
    if (g) g.push(n);
    else groups.set(n.tick, [n]);
  }
  let simultaneous = 0;
  for (const g of groups.values()) {
    if (new Set(g.map((x) => x.lane)).size === 2) simultaneous += 1;
  }
  if (km === 2 && single.length >= 10 && (simultaneous * 2) / single.length > cfg.max_simultaneous_ratio) {
    add(WARNING, 'too_many_simultaneous', `양쪽 레인 동시 입력이 너무 많습니다 (전체 노트의 ${Math.round((simultaneous * 2 * 100) / single.length)}%).`);
  }
  if (km === 4) validateFourKeyHeld(valid, add);
  return issues;
}

/**
 * [10단계] 4키 동시 입력 규칙: 같은 시각(같은 틱)에 시작하는 노트는 최대 2개, 롱노트 유지 + 새로 시작하는 노트는 합쳐 최대 3개.
 * (연타노트는 구간 안에 다른 노트가 없으므로 여기서 다루지 않는다.)
 */
function validateFourKeyHeld(valid: ChartNote[], add: (level: string, code: string, msg: string, ids?: number[]) => void): void {
  const singles = valid.filter((n) => typeof n.lane === 'number');
  const byTick = new Map<number, ChartNote[]>();
  for (const n of singles) {
    const g = byTick.get(n.tick);
    if (g) g.push(n);
    else byTick.set(n.tick, [n]);
  }
  for (const [tick, g] of [...byTick].sort((a, b) => a[0] - b[0])) {
    if (g.length > FOUR_KEY_MAX_SIMULTANEOUS) {
      add(ERROR, 'too_many_at_once', `같은 위치에 노트가 ${g.length}개 겹쳐 있습니다. 4키에서는 동시에 최대 ${FOUR_KEY_MAX_SIMULTANEOUS}개까지입니다: ${idsText(g.map((x) => x.id))}`, g.map((x) => x.id));
      continue;
    }
    if (g.length === 2 && fourKeyHand(g[0]!.lane as number) === fourKeyHand(g[1]!.lane as number)) {
      add(WARNING, 'same_hand_at_once', `같은 손(${fourKeyHand(g[0]!.lane as number) === 0 ? '왼손 S·D' : '오른손 K·L'})의 두 레인이 같은 위치에 있습니다. 양손 엄지로 치기 어려우니 다른 손 레인으로 옮겨 보세요: ${idsText(g.map((x) => x.id))}`, g.map((x) => x.id));
    }
    const held = singles.filter((o) => o.type === NOTE_HOLD && o.tick < tick && o.tick + (o.length_tick as number) > tick);
    if (held.length + g.length > FOUR_KEY_MAX_HELD) {
      const ids = [...held, ...g].map((x) => x.id);
      add(ERROR, 'too_many_held', `롱노트를 누르는 동안 동시에 눌러야 하는 노트가 ${held.length + g.length}개입니다. 4키에서는 최대 ${FOUR_KEY_MAX_HELD}개까지입니다: ${idsText(ids)}`, ids);
    }
  }
}

/** 같은 레인이 연속된 묶음이 기준 이상이면 경고. */
function flushRun(run: ChartNote[], cfg: ValidateConfig, add: (level: string, code: string, msg: string, ids?: number[]) => void, km: number = 2): void {
  if (run.length >= cfg.max_same_lane_run) {
    const ids = run.map((n) => n.id);
    add(WARNING, 'same_lane_run', `${km === 4 ? laneName(run[0]!.lane, km) : laneName(run[0]!.lane) + ' 레인'}에 노트가 ${run.length}개 연속됩니다 (#${ids[0]} 부터).`, ids.slice(0, 1));
  }
}
