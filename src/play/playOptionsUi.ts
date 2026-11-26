// 게임 플레이 옵션 화면 부품(DOM): 볼륨 조절 줄과 [판정 설정] 창. 시작 전 창·일시정지 시트·PC 옆 패널이 같은 부품을 쓴다.
// 값은 playOptionsStore 의 보관소가 쥐고 있어서, 한 곳에서 바꾸면 열려 있는 다른 화면도 따라 바뀐다(화면에서 떼어지면 저절로 구독을 푼다).
// 규칙(판정·점수 계산)은 건드리지 않는다. 판정 설정은 "다음 시작(처음부터 다시 포함)부터" 적용된다.
import { el } from './dom';
import {
  JUDGE_MIN_GAP_MS,
  JUDGE_MS_LABEL,
  JUDGE_MS_LIMITS,
  JUDGE_MS_ORDER,
  VOLUME_CONFIG,
  adjustJudgeMsField,
  adjustWeightField,
  applyPreset,
  judgePresets,
  presetLabel,
  presetOf,
  type JudgeMsKey,
  type PlayJudgeOptions,
  type PlayVolumes,
  type WeightKey,
} from './playOptions';
import type { JudgeStore, VolumeStore } from './playOptionsStore';

/** 화면 종류: 겹침 창(무대 안, 큰 글씨) / 옆 패널(PC, 작은 글씨) */
export type OptionsLook = 'overlay' | 'panel';

/** 슬라이더·숫자 칸에 키가 눌려도 게임 입력으로 번지지 않게 한다(Esc 는 그대로 이어하기/일시정지에 쓰인다) */
function isolateKeys(input: HTMLElement): void {
  input.addEventListener('keydown', (event) => {
    if ((event as KeyboardEvent).code !== 'Escape') event.stopPropagation();
  });
}

/** 구독을 걸고, 요소가 화면에서 떼어지면 저절로 풀리게 한다 */
function bindWhileConnected<T>(root: HTMLElement, subscribe: (fn: (v: T) => void) => () => void, update: (v: T) => void): void {
  const off = subscribe((v) => {
    if (!root.isConnected) {
      off();
      return;
    }
    update(v);
  });
}

// ----------------------------------------------------------------------------- 볼륨

/**
 * 볼륨 조절: 음악 볼륨·효과음 볼륨(0~100) 슬라이더와 음소거 버튼.
 * 슬라이더를 움직이는 즉시 보관소가 바뀌고, 플레이 중이면 컨트롤러가 소리 크기를 바로 따라간다.
 */
export function volumeControls(store: VolumeStore, look: OptionsLook, title = ''): HTMLElement {
  const rowClass = look === 'overlay' ? 'pl-vol-row' : 'rcw-set-row';
  const headClass = look === 'overlay' ? 'pl-vol-head' : 'rcw-set-head';
  const updaters: Array<(v: PlayVolumes) => void> = [];

  const row = (label: string, key: 'music' | 'sfx'): HTMLElement => {
    const name = el('span', { text: label });
    const value = el('b', { text: '' });
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(VOLUME_CONFIG.min);
    input.max = String(VOLUME_CONFIG.max);
    input.step = '1';
    input.setAttribute('aria-label', label);
    input.dataset.volume = key;
    input.addEventListener('input', () => store.set({ [key]: Number(input.value) }));
    isolateKeys(input);
    updaters.push((v) => {
      input.value = String(v[key]);
      value.textContent = String(v[key]);
      input.classList.toggle('muted', v.muted);
    });
    return el('label', { class: rowClass }, el('span', { class: headClass }, name, value), input);
  };

  const muteButton = el('button', { class: look === 'overlay' ? 'pl-toggle pl-mute' : 'rcw-side-btn pl-mute', attrs: { type: 'button', 'data-mute': '1' } });
  muteButton.addEventListener('click', () => store.toggleMute());
  updaters.push((v) => {
    muteButton.textContent = v.muted ? '음소거 켜짐' : '음소거 꺼짐';
    muteButton.classList.toggle('on', v.muted);
    muteButton.setAttribute('aria-pressed', String(v.muted));
  });

  // 겹침 창: 제목 줄 오른쪽에 음소거 버튼을 놓아 세로 길이를 아낀다(일시정지 시트가 무대 높이를 넘지 않게)
  const root =
    look === 'overlay'
      ? el('div', { class: 'pl-volume' }, el('div', { class: 'pl-vol-top' }, el('span', { class: 'pl-vol-title', text: title }), muteButton), row('음악', 'music'), row('효과음', 'sfx'))
      : el('div', { class: 'rcw-volume' }, row('음악 볼륨', 'music'), row('효과음 볼륨', 'sfx'), muteButton);
  const paint = (v: PlayVolumes): void => {
    for (const fn of updaters) fn(v);
  };
  paint(store.get());
  bindWhileConnected(root, (fn) => store.subscribe(fn), paint);
  return root;
}

// ----------------------------------------------------------------------------- 판정 설정

/** 판정 설정 창을 만들 때 고를 수 있는 것 */
export interface JudgePanelOptions {
  /** 처음부터 펼쳐 둘지 */
  open?: boolean;
  /** 적용 시점 안내 문구 (시작 전: "이번 시작부터" / 일시정지: "처음부터 다시 할 때") */
  timingNote: string;
}

/** 숫자 칸 + 슬라이더 한 쌍(폭 또는 점수 비율) */
interface PairRefs {
  range: HTMLInputElement;
  num: HTMLInputElement;
  msg: HTMLElement;
}

/**
 * [판정 설정] 접이식 창: 프리셋(원본 기본/엄격/넉넉하게/직접), 판정 폭(ms) 4개, 점수 비율(%), 기본값으로 되돌리기.
 * 슬라이더는 움직이는 즉시, 숫자 칸은 Enter(또는 칸을 벗어날 때)에 확정된다. 어긋난 값은 한국어 안내와 함께 가까운 값으로 맞춘다.
 */
export function judgeSettingsPanel(store: JudgeStore, options: JudgePanelOptions): HTMLElement {
  let current = store.get();
  const summary = el('summary', { class: 'pl-judge-summary' });
  const body = el('div', { class: 'pl-judge-body' });
  const details = el('details', { class: 'pl-judge' }, summary, body);
  if (options.open === true) details.open = true;

  const presetRow = el('div', { class: 'pl-choice-row' });
  const presetButtons = new Map<string, HTMLButtonElement>();
  for (const preset of judgePresets()) {
    const b = el('button', { class: 'pl-choice', text: preset.label, attrs: { type: 'button', 'data-preset': preset.id } });
    b.addEventListener('click', () => store.set(applyPreset(current, preset.id)));
    presetButtons.set(preset.id, b);
    presetRow.append(b);
  }
  const customButton = el('button', { class: 'pl-choice', text: '직접', attrs: { type: 'button', 'data-preset': 'custom', title: '아래 숫자를 직접 고쳐 보세요' } });
  customButton.addEventListener('click', () => body.querySelector<HTMLInputElement>('input[type=number]')?.focus());
  presetButtons.set('custom', customButton);
  presetRow.append(customButton);

  const pairs = new Map<string, PairRefs>();
  /** 한 줄: 이름 + 슬라이더 + 숫자 칸 + 안내 */
  const pairRow = (id: string, label: string, unit: string, min: number, max: number, commit: (value: number) => string | null): HTMLElement => {
    const range = document.createElement('input');
    range.type = 'range';
    range.min = String(min);
    range.max = String(max);
    range.step = '1';
    range.setAttribute('aria-label', `${label} 슬라이더`);
    const num = document.createElement('input');
    num.type = 'number';
    num.min = String(min);
    num.max = String(max);
    num.step = '1';
    num.inputMode = 'numeric';
    num.setAttribute('aria-label', `${label} 숫자 (Enter로 확정)`);
    const msg = el('small', { class: 'pl-judge-msg', attrs: { role: 'status', 'aria-live': 'polite' } });
    range.addEventListener('input', () => {
      msg.textContent = commit(Number(range.value)) ?? '';
    });
    num.addEventListener('change', () => {
      msg.textContent = commit(Number(num.value)) ?? '';
    });
    isolateKeys(range);
    isolateKeys(num);
    pairs.set(id, { range, num, msg });
    return el('div', { class: 'pl-judge-row' }, el('span', { class: 'pl-judge-name', text: label }), range, el('span', { class: 'pl-judge-num' }, num, unit), msg);
  };

  const msRows = JUDGE_MS_ORDER.map((key) =>
    pairRow(key, `${JUDGE_MS_LABEL[key]} ±`, 'ms', JUDGE_MS_LIMITS[key].min, JUDGE_MS_LIMITS[key].max, (value) => {
      const r = adjustJudgeMsField(current, key, value);
      store.set(r.judge);
      return r.note;
    }),
  );
  const weightRow = (key: WeightKey): HTMLElement =>
    pairRow(`w_${key}`, `${JUDGE_MS_LABEL[`${key}Ms` as JudgeMsKey]} 점수`, '%', 0, 100, (value) => {
      const r = adjustWeightField(current, key, value);
      store.set(r.judge);
      return r.note;
    });
  const fixedLine = el('p', { class: 'pl-dialog-note pl-judge-fixed', text: 'PERFECT 100% · MISS 0%는 고정이에요. 표시 만점 1,000,000점이 "전부 PERFECT"일 때의 점수라서요.' });

  const resetButton = el('button', { class: 'pl-choice', text: '기본값으로 되돌리기', attrs: { type: 'button', 'data-judge-reset': '1' } });
  resetButton.addEventListener('click', () => {
    store.reset();
  });

  body.append(
    el('p', { class: 'pl-dialog-label', text: '프리셋' }),
    presetRow,
    el('p', { class: 'pl-dialog-label', text: `판정 폭 (±ms, PERFECT < GREAT < GOOD < BAD, 단계 사이 ${JUDGE_MIN_GAP_MS}ms 이상)` }),
    ...msRows,
    el('p', { class: 'pl-dialog-label', text: '점수 비율 (%)' }),
    weightRow('great'),
    weightRow('good'),
    weightRow('bad'),
    fixedLine,
    el('p', { class: 'pl-dialog-note pl-judge-burst', text: '연타 성공은 GREAT로 계산됩니다.' }),
    el('div', { class: 'pl-choice-row' }, resetButton),
    el('p', { class: 'pl-dialog-note', text: options.timingNote }),
    el('p', { class: 'pl-dialog-note', text: '이 설정은 게임 화면 테스트에만 적용돼요. 편집기 [테스트]·채보 파일·내보내기는 바뀌지 않아요.' }),
  );

  /** 값이 바뀌면 모든 칸과 요약을 다시 그린다 */
  const paint = (j: PlayJudgeOptions): void => {
    current = j;
    const id = presetOf(j);
    summary.textContent = `판정 설정 · ${presetLabel(id)}`;
    for (const [pid, b] of presetButtons) b.classList.toggle('on', pid === id);
    for (const key of JUDGE_MS_ORDER) {
      const p = pairs.get(key)!;
      p.range.value = String(j[key]);
      p.num.value = String(j[key]);
    }
    for (const key of ['great', 'good', 'bad'] as const) {
      const p = pairs.get(`w_${key}`)!;
      p.range.value = String(j.weights[key]);
      p.num.value = String(j.weights[key]);
    }
  };
  paint(current);
  bindWhileConnected(details, (fn) => store.subscribe(fn), paint);
  return details;
}
