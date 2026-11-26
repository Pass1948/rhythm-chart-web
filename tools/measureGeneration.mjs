import { rolldown } from 'rolldown';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const temp = await mkdtemp(join(tmpdir(), 'rcw-measure-'));
async function load(file, name) {
  const bundle = await rolldown({input:resolve(file)});
  const output = join(temp, name + '.mjs');
  await bundle.write({file:output,format:'esm'});
  await bundle.close();
  return import(pathToFileURL(output).href);
}
try {
  const {thumbIssues,thumbRules} = await load('src/generate/rules.ts','rules');
  const {BpmMap} = await load('src/core/timing.ts','timing');
  const old = process.argv[2];
  const {generateChart} = await load(resolve(old || '.', 'src/generate/generate.ts'),'generator');
  const rows = [];
  for (const difficulty of old ? ['EASY','NORMAL','HARD'] : ['EASY','NORMAL','HARD','GLIITCH']) {
    let notes=0, holds=0, violations=0, drops=0, retention=0;
    for (let song=1;song<=6;song++) {
      const analysis=JSON.parse(await readFile('log/ref_python/out/s'+song+'_analysis.json','utf8'));
      const result=generateChart(analysis,{difficulty,key_mode:4,design_mode:'unified',grid_division:{EASY:4,NORMAL:8,HARD:16,GLIITCH:16}[difficulty]});
      const chart=result.chart;
      notes+=result.notes.length;
      holds+=result.notes.filter(n=>n.type==='hold').length;
      violations+=thumbIssues(result.notes,new BpmMap(chart.timing.bpm_map),chart.song.audio_offset_ms,thumbRules(difficulty)).length;
      drops+=result.stats.process?.drop_ratio || 0;
      retention+=result.stats.process?.strong_beat_retention || 0;
    }
    rows.push({difficulty,notes,holds,violations,...old?{}:{dropPercent:100*drops/6,strongBeatPercent:100*retention/6}});
  }
  console.table(rows);
} finally {
  await rm(temp,{recursive:true,force:true});
}
