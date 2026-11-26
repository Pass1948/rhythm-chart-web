// 11단계 단위 테스트(순수 계산만): 10-C 레일 기하, 노트 위치, 체력 비율, 곡명 스크롤, 게이지 선, PC 양옆 덮개, 터치 구역, 설정
import { describe, expect, it } from 'vitest';
import { V10C, V10C_VIEW } from '../src/play10c/config10c.ts';
import {
  coverWidths, drainStep, edgeL, edgeR, gaugeLines, hpRatio, judgeCenter, judgeRadius, judgeYLane, laneX, noteY, notePose, stageFit, titleScrollOffset, widthAt, zoneBounds10c,
} from '../src/play10c/geometry10c.ts';
import { laneFromPointer, zoneIndex } from '../src/play/inputMapper.ts';
import { DEFAULT_APP_SETTINGS, sanitizeAppSettings } from '../src/storage/settingsStore.ts';

describe('레일 기하 (참고 HTML 식)', () => {
  it('레일 폭: 기준선(330)에서 217, 아래로 갈수록 0.445씩 넓어진다', () => {
    expect(widthAt(330)).toBeCloseTo(217, 6);
    expect(widthAt(1000)).toBeCloseTo(217 + 670 * 0.445, 6);
    expect(edgeL(1000) + edgeR(1000)).toBeCloseTo(2 * V10C.rail.cx, 6);
  });
  it('4레인: 판정선(1000)에서 레인 가운데는 같은 간격, 전체가 레일 가운데에 대칭', () => {
    const xs = [0, 1, 2, 3].map((l) => laneX(l, 1000, 4));
    const gap = xs[1]! - xs[0]!;
    expect(gap).toBeCloseTo(widthAt(1000) / 4, 6);
    expect(xs[2]! - xs[1]!).toBeCloseTo(gap, 6);
    expect((xs[0]! + xs[3]!) / 2).toBeCloseTo(V10C.rail.cx, 6);
  });
  it('2레인: 가운데 x 두 개, 판정원 높이는 모두 judgeY', () => {
    expect(laneX(0, 1000, 2)).toBeCloseTo(V10C.rail.cx - widthAt(1000) / 4, 6);
    expect(judgeYLane(0, 2)).toBe(V10C.rail.judgeY);
    expect(judgeYLane(1, 2)).toBe(V10C.rail.judgeY);
  });
  it('4레인 판정원 높이: 바깥 두 레인만 judgeY − arc (arc = −60 → 60 아래), 반지름 58 / 2레인 70', () => {
    expect(judgeYLane(0, 4)).toBe(V10C.rail.judgeY - V10C.rail.arc);
    expect(judgeYLane(3, 4)).toBe(1060);
    expect(judgeYLane(1, 4)).toBe(1000);
    expect(judgeRadius(4)).toBe(58);
    expect(judgeRadius(2)).toBe(70);
    const c = judgeCenter(0, 4);
    expect(c.y).toBe(1060);
    expect(c.x).toBeCloseTo(laneX(0, 1060, 4), 6);
  });
});

describe('노트 위치', () => {
  it('판정 시각(p = 1)에 노트는 자기 레인의 판정원 가운데에 있다 (2·4레인, 바깥 레인 포함)', () => {
    for (const lanes of [2, 4]) {
      for (let lane = 0; lane < lanes; lane += 1) {
        const pose = notePose(lane, 1, lanes, 0.88);
        const c = judgeCenter(lane, lanes);
        expect(pose.y).toBeCloseTo(c.y, 6);
        expect(pose.x).toBeCloseTo(c.x, 6);
        expect(pose.scale).toBeCloseTo(1, 6);
      }
    }
  });
  it('발사 구간(앞 60%): 시작은 몬스터 자리에서 작게, 구간 끝에서 레일 위치에 합류한다', () => {
    const start = notePose(1, 0, 4, 0.88);
    expect(start.x).toBeCloseTo(V10C.rail.cx, 6);
    expect(start.scale).toBeCloseTo(0.12, 6);
    const pe = V10C.note.emitLenPercent / 100;
    const edge = notePose(1, pe, 4, 0.88);
    const rail = noteY(1, pe, 4);
    expect(edge.y).toBeCloseTo(rail, 6);
    expect(edge.x).toBeCloseTo(laneX(1, rail, 4), 6);
    expect(notePose(1, 0.3, 4, 0.88).y).toBeLessThan(notePose(1, 0.6, 4, 0.88).y); // 시간이 흐르면 아래로
  });
  it('판정선을 지난 노트(p > 1)는 아래로 떨어지며 사라지고, 1.7 근처에서 거의 투명', () => {
    const a = notePose(0, 1.35, 4, 0.88);
    const b = notePose(0, 1.7, 4, 0.88);
    expect(a.y).toBeGreaterThan(judgeYLane(0, 4));
    expect(b.alpha).toBeLessThan(0.02);
    expect(b.y).toBeGreaterThan(a.y);
  });
});

describe('몬스터 체력·곡명·게이지', () => {
  it('체력 = 남은 노트 ÷ 전체 노트: 처음 1, 절반 0.5, 마지막 노트가 끝나면 0', () => {
    expect(hpRatio(80, 0)).toBe(1);
    expect(hpRatio(80, 40)).toBe(0.5);
    expect(hpRatio(80, 80)).toBe(0);
    expect(hpRatio(0, 0)).toBe(0);
    expect(hpRatio(10, 99)).toBe(0);
  });
  it('천천히 닳기: 초당 10%씩 줄고 목표 체력 아래로 내려가지 않으며, 체력이 늘면 바로 따라간다', () => {
    expect(drainStep(1, 0.5, 1, 0.1)).toBeCloseTo(0.9, 6);
    expect(drainStep(0.52, 0.5, 1, 0.1)).toBeCloseTo(0.5, 6);
    expect(drainStep(0.4, 1, 0.016, 0.1)).toBe(1);
  });
  it('곡명 스크롤: 속도 50px/초, 글자 폭마다 되풀이, 속도 0이면 멈춤', () => {
    expect(titleScrollOffset(0, 300, 50)).toBe(0);
    expect(titleScrollOffset(2000, 300, 50)).toBeCloseTo(100, 6);
    expect(titleScrollOffset(7000, 300, 50)).toBeCloseTo(50, 6);
    expect(titleScrollOffset(5000, 300, 0)).toBe(0);
  });
  it('게이지 선: 전체 길이 460, 색 구간 100%, 피버는 아래에서 위로(최소 8%), 부정수치는 위에서 침식', () => {
    const none = gaugeLines(0, 0);
    expect(none.bottom - none.top).toBe(460);
    expect(none.fever.y1 - none.fever.y0).toBeCloseTo(460 * 0.08, 6);
    expect(none.eroded).toBeNull();
    expect(none.safe.y1 - none.safe.y0).toBeCloseTo(460, 6);
    const half = gaugeLines(50, 25);
    expect(half.fever.y1 - half.fever.y0).toBeCloseTo(230, 6);
    expect(half.eroded!.y1 - half.eroded!.y0).toBeCloseTo(115, 6);
    expect(half.safe.y0).toBeCloseTo(half.top + 115, 6);
    expect(gaugeLines(300, 300).fever.y0).toBe(none.top); // 100% 로 맞춰진다
  });
});

describe('PC 양옆 덮개·터치 구역·설정', () => {
  it('비율을 유지해 가장 크게 넣고, 남는 가로는 양옆 덮개 (1920×1080 → 무대 607px, 덮개 각 656px)', () => {
    const fit = stageFit(1920, 1080);
    expect(fit.scale).toBeCloseTo(1080 / 1280, 6);
    const w = V10C_VIEW.width * fit.scale;
    expect(fit.coverLeft).toBeCloseTo((1920 - w) / 2, 6);
    expect(fit.coverLeft + w + fit.coverRight).toBeCloseTo(1920, 6);
    const phone = stageFit(390, 844);
    expect(phone.scale).toBeCloseTo(390 / 720, 6);
    expect(phone.coverLeft).toBeCloseTo(0, 6);
    const c = coverWidths(1920, fit.left, w);
    expect(c.left).toBeCloseTo(c.right, 6);
  });
  it('터치 구역은 10-C 판정원 사이(가장 가까운 레인): 4레인은 3개 경계, 가운데 0.5, 2레인은 0.5', () => {
    const b = zoneBounds10c(4);
    expect(b.length).toBe(3);
    expect(b[1]).toBeCloseTo(0.5, 2);
    const input = { keyboardEnabled: true, mouseEnabled: true, keyLeft: 'KeyS', keyRight: 'KeyF' };
    expect([0.05, b[0]! - 0.01, b[0]! + 0.01, 0.49, 0.51, b[2]! + 0.01, 0.95].map((x) => laneFromPointer(x, input, 4, b))).toEqual([0, 0, 1, 1, 2, 3, 3]);
    expect(zoneBounds10c(2)[0]).toBeCloseTo(0.5, 2);
    expect(zoneIndex(0.9, zoneBounds10c(2))).toBe(1);
  });
  it('설정: 화면 모양 기본은 기존 화면, 10-C 노트 속도 기본 1400ms, 이상한 값은 고친다', () => {
    expect(DEFAULT_APP_SETTINGS.playScreen).toBe('classic');
    expect(DEFAULT_APP_SETTINGS.fallTimeMs10c).toBe(1400);
    expect(V10C.note.travelMs).toBe(1400);
    const s = sanitizeAppSettings({ playScreen: 'v10c', fallTimeMs10c: 99999 }).settings;
    expect(s.playScreen).toBe('v10c');
    expect(s.fallTimeMs10c).toBe(2000);
    expect(sanitizeAppSettings({ playScreen: 'weird' }).settings.playScreen).toBe('classic');
  });
});
