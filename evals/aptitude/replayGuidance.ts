import { it, expect } from 'vitest'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { parseAptitudeResult } from '@/lib/aptitude/schema'
import { buildAnswerGuidance, resultCandidates, estimateQuestionDifficulty } from '@/lib/aptitude/guidance'
import { AnswerGuidance } from '@/components/aptitude/AnswerGuidance'
import styles from '@/components/aptitude/AptitudeWorkspace.module.css'
import { APTITUDE_SELECTION_FIXTURES } from './selectionFixtures'

it.skipIf(!process.env.APTITUDE_GUIDANCE_REPLAY_DIR)('replays saved practice results and renders the real recommendation component without provider calls', () => {
  const source=resolve(process.env.APTITUDE_GUIDANCE_REPLAY_DIR!)
  const reports=['chrome-window-live-results.json','laptop-live-model-results.json']
  const rows=reports.flatMap(file => {
    const entries=JSON.parse(readFileSync(resolve(source,file),'utf8')).entries as {result:unknown}[]
    return entries.flatMap((e,i) => {
      if (!e.result) return []
      const result=parseAptitudeResult(e.result);const candidates=resultCandidates(result);const g=buildAnswerGuidance(candidates)
      return [{file,capture:i+1,status:result.status,question:result.question?.stem,guide:g,candidates}]
    })
  })
  const sequence=rows.find(r=>r.question?.includes('8, 12, 18, 26'))
  expect(sequence?.guide.candidate?.provider).toBe('openai');expect(sequence?.guide.candidate?.observation?.answer?.value).toBe('36')
  for(const row of rows.filter(r=>r.candidates.every(c=>c.observation?.status==='needs_capture'))){expect(row.guide.candidate).toBeNull();expect(row.guide.confidenceScore).toBe(0)}
  const start=performance.now();for(let i=0;i<10000;i++)buildAnswerGuidance(rows[i%rows.length].candidates)
  const averageMs=(performance.now()-start)/10000
  const difficulty=APTITUDE_SELECTION_FIXTURES.map(f=>({id:f.id,domain:f.domain,...estimateQuestionDifficulty({category:f.expected.category,status:f.cropped?'needs_capture':'ambiguous',answer:null,message:null,question:{stem:f.lines.join(' '),instructions:[],passage:null,responseType:'single_choice',options:f.choices.map((o,i)=>({...o,id:String(i)})),missingEvidence:f.cropped?['Cropped options']:[]}})}))
  const output=resolve(source,'answer-guidance-verification');mkdirSync(output,{recursive:true})
  writeFileSync(resolve(output,'results.json'),JSON.stringify({scope:'Replay of saved live practice outputs plus local difficulty checks; no new provider inference',providerCalls:0,averageGuidanceMs:averageMs,iterations:10000,difficulty,rows:rows.map(r=>({file:r.file,capture:r.capture,status:r.status,question:r.question,guide:{...r.guide,candidate:r.guide.candidate?.modelId??null}}))},null,2))
  let css=readFileSync('components/aptitude/AptitudeWorkspace.module.css','utf8')
  for(const [key,value]of Object.entries(styles)) css=css.replace(new RegExp('\\.'+key+'(?![A-Za-z0-9_-])','g'),'.'+value)
  const escape=(s:string)=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
  const previewRows=rows.filter(r=>r.file.startsWith('chrome')&&[1,7,8].includes(r.capture))
  const cards=previewRows.map(r=>`<section><h2>Saved Chrome capture ${r.capture}</h2><p>${escape(r.question??'')}</p>${renderToStaticMarkup(createElement(AnswerGuidance,{candidates:r.candidates}))}</section>`).join('')
  writeFileSync(resolve(output,'preview.html'),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Answer guidance verification</title><style>:root{--ink:#20372d;--reader:#fff;--paper:#edf4ef;--line:#d4e1d8;--signal:#146844}body{font:16px/1.55 system-ui;background:var(--paper);color:var(--ink);margin:0}main{max-width:1000px;margin:auto;padding:30px 20px}main>section{margin:35px 0}.btn-ghost{padding:9px 14px;border:1px solid #d4e1d8;border-radius:8px;background:white;color:#146844} ${css}</style></head><body><main><h1>Best answer, confidence and difficulty</h1><p>Actual new component rendered from saved practice results. Static review: copy controls are inactive. No new model calls.</p>${cards}<h2>Local difficulty coverage</h2><p>${difficulty.map(d=>escape(d.domain)+': '+d.level).join('<br>')}</p><p>Average local calculation: ${averageMs.toFixed(4)} ms across 10,000 runs on this laptop. This excludes model and network latency.</p></main></body></html>`)
  console.info(JSON.stringify({replayed:rows.length,difficultyCases:difficulty.length,averageMs,providerCalls:0}))
})
