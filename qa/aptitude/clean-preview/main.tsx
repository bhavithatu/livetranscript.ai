import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { ArrowUpRight, Check, ChevronRight, FileQuestion, Layers, Sparkles } from 'lucide-react'
import { AptitudeComparison } from '@/components/aptitude/AptitudeComparison'
import { BehavioralGuidance } from '@/components/aptitude/BehavioralGuidance'
import { BEHAVIORAL_PRACTICE } from '@/lib/aptitude/behavioralFixtures'
import { parseAptitudeResult } from '@/lib/aptitude/schema'
import { formatAptitudeOption } from '@/components/aptitude/formatOption'
import examplesJson from './examples.json'
import './preview.css'

const examples = examplesJson.map(item => ({ ...item, result: parseAptitudeResult(item.result) }))
function Preview() {
  const [section, setSection] = useState<'cognitive' | 'behavioral'>('cognitive')
  const [selected, setSelected] = useState(0)
  const behavioral = section === 'behavioral'
  const current = behavioral ? BEHAVIORAL_PRACTICE[selected].observation : examples[selected].result
  const items = behavioral ? BEHAVIORAL_PRACTICE : examples
  const descriptions = behavioral ? ['Understand the wording', 'Consider the tradeoffs'] : ['Both models agree', 'One usable answer', 'Missing answer choices']
  return <>
    <header className="topbar">
      <a className="brand" href="#"><span className="brandIcon"><Layers size={20}/></span>LiveTranscript<span className="brandDivider">/</span><span className="brandSection">Practice</span></a>
      <span className="previewTag">Design preview</span>
      <a className="workspaceLink" href="/copilot?mode=aptitude" target="_blank" rel="noreferrer">Open updated workspace <ArrowUpRight size={15}/></a>
    </header>
    <main>
      <div className="pageHeading"><div><span className="eyebrow">TWO SECTIONS. ONE CLEAR WORKSPACE.</span><h1>{behavioral ? 'Understand the question.' : 'Focus on the answer.'}</h1><p>{behavioral ? 'Plain-language explanations to help you respond honestly.' : 'The best available answer, with confidence and difficulty at a glance.'}</p></div></div>
      <nav className="sectionSwitch" aria-label="Assessment section">
        <button aria-pressed={!behavioral} onClick={() => { setSection('cognitive'); setSelected(0) }}>01 · Cognitive ability</button>
        <button aria-pressed={behavioral} onClick={() => { setSection('behavioral'); setSelected(0) }}>02 · Behavioral assessment</button>
      </nav>
      <div className="previewNotice"><Sparkles size={15}/><p>{behavioral ? 'Authored practice examples, not model responses. No personal answers are selected or stored.' : 'Saved practice results. Logical, verbal, pattern, and math question types are supported in the workspace.'} This preview makes no new AI calls.</p></div>
      <div className="workbench">
        <aside className="leftColumn">
          <section className="exampleList"><div className="sectionTitle"><h2>Practice examples</h2><span>{String(items.length).padStart(2, '0')}</span></div>
            {items.map((item, i) => <button key={item.title} className={`example ${selected === i ? 'selected' : ''}`} onClick={() => setSelected(i)} aria-pressed={selected === i}><span className="exampleNumber">{String(i + 1).padStart(2, '0')}</span><span>{item.title}<small>{descriptions[i]}</small></span><ChevronRight size={16}/></button>)}
          </section>
          <section className="questionCard"><div className="sectionTitle"><h2><FileQuestion size={16}/>Question</h2><span>{behavioral ? 'Authored example' : 'Saved capture'}</span></div>
            <p className="questionStem">{current.question?.stem}</p>
            {behavioral && current.question?.instructions.map(text => <p key={text} className="missing">{text}</p>)}
            {!behavioral && selected === 2 && <p className="pattern" aria-label="Up triangle, down triangle, up triangle, question mark">▲ ▼ ▲ ?</p>}
            <ul className="options">{current.question?.options.map(o => <li key={o.id}>{formatAptitudeOption(o)}</li>)}</ul>
            {current.question?.missingEvidence.length ? <p className="missing">The choices were outside the captured area.</p> : null}
          </section>
          <p className="localNote"><Check size={14}/>{behavioral ? 'Your personal response stays yours.' : 'Difficulty is calculated locally. No additional model call.'}</p>
        </aside>
        <div className="answerPanel" key={`${section}-${selected}`}>{behavioral ? <BehavioralGuidance observations={[BEHAVIORAL_PRACTICE[selected].observation]}/> : <AptitudeComparison comparison={examples[selected].result.comparison}/>}</div>
      </div>
      <footer><span>{behavioral ? 'Personal preferences are not scored as correct or incorrect here.' : 'Confidence is an estimate, not measured accuracy.'}</span><span>Interactive design preview · live workspace is separate</span></footer>
    </main>
  </>
}
createRoot(document.getElementById('root')!).render(<Preview/>);
