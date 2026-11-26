import type { ChartNote } from '../core/schema.ts';
import { RESOLUTION } from '../core/schema.ts';
import type { BpmMap } from '../core/timing.ts';
import type { SnappedCandidate } from './types.ts';
import type { resolveOptions } from './generate.ts';
import { thumbIssues } from './rules.ts';

export function assignNotes(candidates:SnappedCandidate[], map:BpmMap, offset:number, end:number, opt:ReturnType<typeof resolveOptions>) {
  const notes:ChartNote[]=[], changes:{tick:number,action:string}[]=[];
  const uses=[0,0,0,0];
  const r=opt.rules;
  const check=(list:ChartNote[])=>thumbIssues(list,map,offset,r).length===0;
  const ranks=[...candidates].sort((a,b)=> {
    const beat=(t:number)=>Number((t-map.entryAt(t).tick)%RESOLUTION===0);
    return beat(b.tick)-beat(a.tick) || b.strength-a.strength || a.tick-b.tick;
  });
  let id=1;
  for (const c of ranks) {
    const lanes=[0,1,2,3].sort((a,b)=>{
      const handCount=(l:number)=>l<2 ? uses[0]!+uses[1]! : uses[2]!+uses[3]!;
      return handCount(a)-handCount(b) || uses[a]!-uses[b]! || a-b;
    });
    const nearby=notes.filter(n=>Math.abs(map.tickToMs(c.tick)-map.tickToMs(n.tick))<=Math.max(3000,r.run*150+300,r.handGap,r.laneGap));
    const n:ChartNote={id,tick:c.tick,lane:0,type:'tap'};
    if (!lanes.some(lane=>{ n.lane=lane; return check([...nearby,n]); })) {
      changes.push({tick:c.tick,action:'제외'});
      continue;
    }
    uses[Number(n.lane)]!++;
    notes.push(n); id++;
  }
  notes.sort((a,b)=>a.tick-b.tick);
  const byTick=new Map(notes.map(n=>[n.tick,n]));
  let chords=0;
  const localRules={...r,chord:100,hold:100};
  const radius=Math.max(1000,r.maxHold+r.release,300+150*r.run,r.globalGap,r.laneGap,r.handGap,r.chordGap,r.inner);
  const context=(n:ChartNote)=>notes.filter(x=>Math.abs(map.tickToMs(x.tick)-map.tickToMs(n.tick))<=radius);
  for(const c of ranks) {
    if(chords+1>byTick.size*opt.chord/100) break;
    const n=byTick.get(c.tick);
    if(!n) continue;
    const other={...n,id};
    const lanes=Number(n.lane)<2 ? [2,3]:[0,1];
    const local=context(n);
    if(lanes.some(lane=>{other.lane=lane;return !thumbIssues([...local,other],map,offset,localRules).length;})) {
      notes.push(other);id++;chords++;
    }
  }
  notes.sort((a,b)=>a.tick-b.tick || a.id-b.id);
  let holds=0;
  const source = new Map(candidates.map(c => [c.tick,c]));
  const holdOrder = [...notes].sort((a,b) => {
    const x = source.get(a.tick)!, y = source.get(b.tick)!;
    return y.duration_ms-x.duration_ms || y.strength-x.strength || a.tick-b.tick || a.id-b.id;
  });
  for(const n of holdOrder) {
    if(holds+1>notes.length*opt.ratios.hold/100) break;
    const ms=map.tickToMs(n.tick);
    const next=notes.find(x=>x.tick>n.tick && Number(x.lane)<2===(Number(n.lane)<2));
    const limit=Math.min(end-offset,ms+r.maxHold,next ? map.tickToMs(next.tick)-r.release : Infinity);
    const step=RESOLUTION/2;
    const max=Math.floor((map.msToTick(limit)-n.tick)/step)*step;
    const local=context(n);
    for(let length=max;length>0;length-=step) {
      n.type='hold'; n.length_tick=length;
      if(!thumbIssues(local,map,offset,localRules).length){holds++;changes.push({tick:n.tick,action:'롱노트'});break;}
      n.type='tap'; delete n.length_tick;
    }
  }
  // Every accepted repair strictly reduces the violation count or removes one note.
  const priority = new Map(ranks.map((c,index) => [c.tick,index]));
  const budget = notes.length * 4 + 1;
  for (let pass = 0; pass < budget; pass++) {
    const issues = thumbIssues(notes,map,offset,r);
    if (!issues.length) break;
    const ids = new Set(issues[0]!.note_ids);
    const affected = notes.filter(n => ids.has(n.id)).sort((a,b) =>
      priority.get(b.tick)! - priority.get(a.tick)! || b.id-a.id);
    const n = affected[0];
    if (!n) throw new Error('규칙 위반 위치를 찾지 못했습니다.');
    let action = '제외';
    const original = n.lane;
    for (const lane of [0,1,2,3]) {
      n.lane = lane;
      if (thumbIssues(notes,map,offset,r).length < issues.length) { action = '레인 이동'; break; }
    }
    if (action === '제외') {
      n.lane = original;
      if (n.type === 'hold') {
        n.type = 'tap';
        delete n.length_tick;
        action = '단타로 변경';
      } else notes.splice(notes.indexOf(n),1);
    }
    changes.push({tick:n.tick,action});
  }
  if (!check(notes)) throw new Error('생성 결과 규칙 검사 실패');
  return {notes:notes.sort((a,b)=>a.tick-b.tick || Number(a.lane)-Number(b.lane)),changes};
}
