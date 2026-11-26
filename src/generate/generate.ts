import { loadPresets } from '../core/config.ts';
import type { Presets } from '../core/config.ts';
import { RESOLUTION, newChart } from '../core/schema.ts';
import type { ChartNote, ChartV2 } from '../core/schema.ts';
import { BpmMap } from '../core/timing.ts';
import { ERROR, validateIssues } from '../core/validate.ts';
import { pyRound } from '../core/util.ts';
import type { AnalysisResult } from '../analysis/types.ts';
import { AnalysisError } from '../analysis/types.ts';
import { snapCandidates, selectByBarBudget } from './noteTypes.ts';
import { assignNotes } from './lanes4.ts';
import { thumbRules } from './rules.ts';
import type { GenerateOptions, GenerateResult, NpsStats, TypeStats, ValidationSummary } from './types.ts';

export function resolveOptions(options:GenerateOptions={}, presets:Presets=loadPresets()) {
  const difficulty = (options.difficulty ?? 'NORMAL').toUpperCase().replace(/^GLITCH$/, 'GLIITCH');
  const cfg=presets.difficulties[difficulty];
  if (!cfg) throw new AnalysisError('알 수 없는 난이도입니다.');
  const rules={...thumbRules(difficulty)};
  for (const [key,value] of Object.entries(options.rule_overrides ?? {})) {
    if (Object.hasOwn(rules,key) && Number.isFinite(value) && value>=0) rules[key as keyof typeof rules]=value;
  }
  const tolerance: number=presets.generation.grid_tolerance_presets[options.grid_tolerance ?? 'strict'];
  if (!tolerance) throw new AnalysisError('박자 맞춤 값을 확인하세요.');
  const grid=Number(options.grid_division ?? cfg.grid_division);
  if (![4,8,12,16,24,32].includes(grid)) throw new AnalysisError('격자를 확인하세요.');
  const density=Number(options.density_scale ?? 1);
  if (!(density>0 && density<=2)) throw new AnalysisError('노트 양을 확인하세요.');
  const hold=Math.min(rules.hold,Math.max(0,options.hold_percent ?? rules.hold));
  return {difficulty,rules,grid_division:grid,tolerance,density,nps:cfg.nps_base*density,
    chord:Math.min(rules.chord,Math.max(0,options.four_key_simultaneous ?? rules.chord)),
    ratios:{tap:100-hold,hold,burst:0},allow_burst:false,key_mode:4,design_mode:'unified'};
}
export function npsStats(notes: ChartNote[], bpmMap: BpmMap): NpsStats {
  if (!notes.length) return { avg: 0.0, max: 0.0, p90: 0.0 };
  const times = notes.map((n) => bpmMap.tickToMs(n.tick)).sort((a, b) => a - b).map((t) => t / 1000.0);
  const span = Math.max(times[times.length - 1]! - times[0]!, 1.0);
  const counts: number[] = [];
  let j = 0;
  for (let i = 0; i < times.length; i++) {
    while (times[i]! - times[j]! >= 1.0) j += 1;
    counts.push(i - j + 1);
  }
  const perSec = new Array<number>(Math.floor(times[times.length - 1]! - times[0]!) + 1).fill(0);
  for (const t of times) perSec[Math.floor(t - times[0]!)]! += 1;
  const sorted = [...perSec].sort((a, b) => a - b);
  const pos = (sorted.length - 1) * 0.9;
  const lo = Math.floor(pos);
  const hi = Math.min(sorted.length - 1, lo + 1);
  const p90 = sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (pos - lo);
  return { avg: Math.round((times.length / span) * 100) / 100, max: Math.max(...counts), p90 };
}

/** 노트 종류별 개수와 실제 비율(%). */
export function typeStats(notes: ChartNote[]): TypeStats {
  const total = notes.length;
  const out: TypeStats = { total, tap: 0, hold: 0, burst: 0, tap_percent: 0, hold_percent: 0, burst_percent: 0 };
  for (const t of ['tap', 'hold', 'burst'] as const) {
    const c = notes.filter((n) => n.type === t).length;
    out[t] = c;
    out[`${t}_percent`] = total ? Math.round((1000.0 * c) / total) / 10 : 0.0;
  }
  return out;
}

/** 02단계 검증을 실행해 오류·경고 요약을 만든다. */
export function validationSummary(chart: ChartV2, limit = 30): ValidationSummary {
  const issues = validateIssues(chart);
  return {
    error_count: issues.filter((i) => i.level === ERROR).length,
    warning_count: issues.filter((i) => i.level !== ERROR).length,
    items: issues.slice(0, limit),
  };
}

export function generateChart(analysis:AnalysisResult, options:GenerateOptions={}):GenerateResult {
  if (!analysis) throw new AnalysisError('먼저 분석을 해 주세요.');
  const opt=resolveOptions(options), timing=analysis.timing;
  const map=new BpmMap(options.bpm_map?.length ? options.bpm_map : [{tick:0,bpm:timing.bpm,beats_per_bar:4,beat_unit:4}]);
  const offset=options.audio_offset_ms ?? timing.audio_offset_ms;
  const duration=analysis.info.duration_ms;
  const start=Math.max(0,options.range_start_ms ?? 0)+2000;
  const end=Math.min(duration,options.range_end_ms ?? duration)-1000;
  const step=4*RESOLUTION/opt.grid_division;
  const [snapped,droppedGrid]=snapCandidates(analysis.candidates,map,offset,duration,step,opt.tolerance);
  for (const tick of snapped.keys()) {
    const time=pyRound(map.tickToMs(tick)+offset);
    if(time<start || time>end) snapped.delete(tick);
  }
  const [selected]=selectByBarBudget(snapped,map,opt.nps,opt.rules.nps,0,
    p=>p<0.1 ? 0.75+p*2.5 : 1+Math.max(0,p-0.5)*0.4,true);
  const {notes,changes}=assignNotes(selected,map,offset,end,opt);
  const chart=newChart(analysis.song,'','',Math.round(duration),offset);
  chart.keyMode=chart.lanes=4;
  chart.song.audio_sha256=analysis.audio_sha256 ?? '';
  chart.timing.bpm_map=map.toList();
  chart.timing.grid_map=[{tick:0,division:opt.grid_division}];
  chart.difficulties=[{name:opt.difficulty,level:0,notes}];
  const stats=typeStats(notes), kept=new Set(notes.map(n=>n.tick));
  const strong=[...snapped.keys()].filter(t=>(t-map.entryAt(t).tick)%RESOLUTION===0);
  stats.process={dropped_grid:droppedGrid,drop_ratio:snapped.size ? 1-kept.size/snapped.size : 0,
    strong_beat_retention:strong.length ? strong.filter(t=>kept.has(t)).length/strong.length : 1};
  stats.nps=npsStats(notes,map);
  stats.design_mode='unified';
  stats.rule_problems=0;
  return {notes,chart,difficulty:chart.difficulties[0]!,stats,timing:{...chart.timing,audio_offset_ms:offset,source:timing.source},
    validation:validationSummary(chart,Infinity),messages:[`4키 노트 ${notes.length}개, 롱노트 ${stats.hold}개`],
    options_used:{...opt,changes}};
}
