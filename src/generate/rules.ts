import type { ChartNote } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import { pyRound } from '../core/util.ts';
import presets from '../../config/presets.json';

export function thumbRules(name: string) {
  const table = presets.thumb_rules;
  return table[name.toUpperCase() as keyof typeof table] ?? table.NORMAL;
}

export function thumbIssues(notes: ChartNote[], map: BpmMap, offset: number, r: ReturnType<typeof thumbRules>) {
  const timed = notes.filter(n => typeof n.lane === 'number').map(n => ({
    ...n, hand: Number(n.lane) < 2 ? 0 : 1,
    ms: pyRound(map.tickToMs(n.tick) + offset),
    end: pyRound(map.tickToMs(n.tick + (n.length_tick || 0)) + offset),
  })).sort((a,b) => a.tick-b.tick || a.id-b.id);
  type N = typeof timed[number];
  const issues: {code:string, level:string, message:string, note_ids:number[]}[] = [];
  function add(code:string, message:string, group:N[], level='warning') {
    issues.push({code, level, message, note_ids:group.map(n => n.id)});
  }
  const groups = new Map<number,N[]>();
  for (const n of timed) {
    if (!groups.has(n.tick)) groups.set(n.tick, []);
    groups.get(n.tick)!.push(n);
  }
  const history:N[] = [];
  const lastLane = new Map<number,N>();
  const lastHand = new Map<number,N>();
  const lastHold = new Map<number,N>();
  let active:N[] = [], prev:N[] = [], chords:N[] = [], holds:N[] = [], run=1;
  for (const group of groups.values()) {
    const first = group[0]!, ms = first.ms;
    active = active.filter(n => n.end > ms);
    const playing = [...active,...group];
    if (playing.length > 2) add(active.length ? 'too_many_held':'too_many_at_once','동시에 누르는 노트가 세 개 이상입니다.',playing,'error');
    if (group.length > 1) chords.push(first);
    if (prev.length) {
      const gap = ms-prev[0]!.ms, pair=[prev[0]!,first];
      if (gap < r.globalGap) add('R3','전체 입력 간격이 짧습니다.',pair);
      if (r.run && run >= r.run && gap < 300) add('R4','빠른 구간 뒤 쉼이 짧습니다.',pair);
      run = gap <= 150 ? run+1 : 1;
      if ((group.length>1 || prev.length>1) && gap<r.chordGap) add('R6','동시 입력 앞뒤 간격이 짧습니다.',pair);
    }
    while (history.length && history[0]!.ms <= ms-1000) history.shift();
    for (const n of group) {
      const hand=lastHand.get(n.hand), lane=lastLane.get(Number(n.lane)), hold=lastHold.get(n.hand);
      if (hand && hand.ms===ms) add('same_hand_at_once','한 손에 두 입력이 겹칩니다.',[hand,n],'error');
      else if (hand && ms-hand.ms<r.handGap) add('R1','같은 손 입력 간격이 짧습니다.',[hand,n]);
      if (lane && ms-lane.ms<r.laneGap) add('R2','같은 레인 입력 간격이 짧습니다.',[lane,n]);
      if (hold && ms>=hold.end && ms-hold.end<r.release) add('L3','롱노트를 뗀 뒤 여유가 부족합니다.',[hold,n]);
      for (const h of active) {
        if (h.hand===n.hand) add('held_hand','롱노트를 누르는 손에 입력이 겹칩니다.',[h,n],'error');
        else if (!r.inner || (hand && hand.ms>=h.ms && ms-hand.ms<r.inner)) add('L4','롱노트 중 반대 손 입력 제한을 넘었습니다.',[hand && hand.ms>=h.ms ? hand:h,n]);
      }
      if (!r.inner && group.length>1 && group.some(x=>x.type==='hold') && n===first) add('L4','롱노트 시작에 반대 손 입력이 있습니다.',group);
      if (n.type==='hold') {
        const min = Math.max(r.holdMs, 60000/map.entryAt(n.tick).bpm*r.beats);
        if (n.end-ms<min) add('L1','롱노트 길이가 짧습니다.',[n]);
        if (n.end-ms>r.maxHold) add('L2','롱노트 길이가 깁니다.',[n]);
        holds.push(n);
        lastHold.set(n.hand,n);
      }
      history.push(n);
      const recent = history.filter(x=>x.ms>ms-300);
      if (recent.length>r.window) add('R5','300ms 안에 입력이 많습니다.',recent);
      const same = history.filter(x=>x.hand===n.hand);
      if (history.length>r.nps || same.length>r.handNps) add('R8','1초 안에 입력이 많습니다.',history.length>r.nps ? history.slice():same);
      lastHand.set(n.hand,n);
      lastLane.set(Number(n.lane),n);
    }
    active.push(...group.filter(n=>n.type==='hold'));
    prev=group;
  }
  if (100*chords.length>r.chord*groups.size) add('R7','동시 입력 비율을 넘었습니다.',chords);
  if (100*holds.length>r.hold*timed.length) add('L5','롱노트 비율을 넘었습니다.',holds);
  return issues;
}
