import { describe, it, expect } from 'vitest';
import { BpmMap } from '../src/core/timing.ts';
import type { ChartNote } from '../src/core/schema.ts';
import { thumbRules, thumbIssues } from '../src/generate/rules.ts';
import { difficultyEnum } from '../src/storage/unityBundle.ts';
import { generateChart } from '../src/generate/generate.ts';
import { readFileSync } from 'node:fs';
import type { AnalysisResult } from '../src/analysis/types.ts';

const map = new BpmMap([{tick:0,bpm:60,beats_per_bar:4,beat_unit:4}],1000);
const note = (tick:number,lane:number,id:number,length=0):ChartNote =>
  length ? {tick,lane,id,type:'hold',length_tick:length} : {tick,lane,id,type:'tap'};
function codes(notes:ChartNote[],diff='HARD') {
  return thumbIssues(notes,map,-100,thumbRules(diff)).map(issue=>issue.code);
}
describe('정수 ms 규칙', () => {
  for (const delta of [-1,0,1]) {
    it('간격 경계 '+delta, () => {
      const has=(list:ChartNote[],code:string)=>codes(list).includes(code);
      for (const [gap,lane,rule] of [[200,1,'R1'],[300,0,'R2'],[100,2,'R3']] as const)
        expect(has([note(0,0,1),note(gap+delta,lane,2)],rule)).toBe(delta<0);
      const chord=[note(0,0,1),note(0,2,2)];
      expect(has([...chord,note(200+delta,3,3)],'R6')).toBe(delta<0);
      expect(has([...chord,note(300+delta,0,3),note(300+delta,2,4)],'R5')).toBe(delta<0);
      const fast=Array.from({length:8},(_,i)=>note(i*125,i%4,i+1));
      expect(has([...fast,note(875+300+delta,0,9)],'R4')).toBe(delta<0);
      const many=Array.from({length:8},(_,i)=>note(i*122,i%4,i+1));
      expect(has([...many,note(1000+delta,1,9)],'R8')).toBe(delta<0);
      expect(has([note(0,0,1,750+delta)],'L1')).toBe(delta<0);
      expect(has([note(0,0,1,4000+delta)],'L2')).toBe(delta>0);
      expect(has([note(0,0,1,800),note(1000+delta,1,2)],'L3')).toBe(delta<0);
      expect(has([note(0,0,1,1800),note(500,2,2),note(750+delta,3,3)],'L4')).toBe(delta<0);
    });
  }
  it('동시 비율의 분모는 시작 tick 수이고 홀드 비율의 분모는 누름 수이다',()=>{
    const notes=Array.from({length:10},(_,i)=>note(i*2000,0,i+1,i===0?800:0));
    notes.push(note(0,2,11));
    expect(codes(notes)).not.toContain('R7');
    expect(codes(notes.slice(1))).not.toContain('R7');
    expect(codes(notes.filter(n=>n.id!==3))).toContain('R7');
    expect(codes(notes)).not.toContain('L5');
    expect(codes([...notes,note(22000,0,12,800)])).toContain('L5');
    expect(difficultyEnum('GLIITCH')).toBe('GLIITCH');
  });
  it('두 손 홀드 사이의 추가 입력은 오류이고 관련 ID를 표시한다',()=>{
    const issues=thumbIssues([note(0,0,1,2000),note(500,2,2,1200),note(900,3,3)],map,0,thumbRules('NORMAL'));
    expect(issues.find(i=>i.code==='too_many_held')).toMatchObject({level:'error',note_ids:[1,2,3]});
  });
  it('변속과 양·음 오프셋을 포함한 8초 채보 1000개',()=>{
    const analysis=JSON.parse(readFileSync('log/ref_python/out/s1_analysis.json','utf8')) as AnalysisResult;
    analysis.info.duration_ms=8000;
    let seed=947;
    const random=()=>((seed=Math.imul(1664525,seed)+1013904223>>>0)/4294967296);
    for(let i=0;i<1000;i++){
      const difficulty=['EASY','NORMAL','HARD','GLIITCH'][i%4]!;
      const bpm=[90,180,220][i%3]!;
      analysis.candidates=Array.from({length:i%61},()=>({time_ms:random()*8000,strength:random(),duration_ms:100,band:'low' as const}));
      const result=generateChart(analysis,{difficulty,audio_offset_ms:i%2 ? -173:251,
        bpm_map:[{tick:0,bpm,beats_per_bar:3,beat_unit:4},{tick:3840,bpm:180,beats_per_bar:6,beat_unit:8}]});
      const timing=new BpmMap(result.chart.timing.bpm_map);
      expect(thumbIssues(result.notes,timing,result.chart.song.audio_offset_ms,thumbRules(difficulty))).toEqual([]);
      expect(result.validation.error_count).toBe(0);
    }
  });
});
