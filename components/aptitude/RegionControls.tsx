'use client'

import { useId } from 'react'
import type { NormalizedRegion } from '@/lib/aptitude/captureDetector'
import styles from './AptitudeWorkspace.module.css'

export const FULL_REGION: NormalizedRegion = { x: 0, y: 0, width: 1, height: 1 }

export function RegionFields({ label, value, onChange }: { label: string; value: NormalizedRegion; onChange: (next: NormalizedRegion) => void }) {
  const id = useId()
  function change(key: keyof NormalizedRegion, raw: string) {
    const number = Number(raw)
    if (!Number.isFinite(number)) return
    const next = { ...value, [key]: Math.min(1, Math.max(0, number / 100)) }
    next.x = Math.min(0.99, next.x)
    next.y = Math.min(0.99, next.y)
    next.width = Math.min(1 - next.x, Math.max(0.01, next.width))
    next.height = Math.min(1 - next.y, Math.max(0.01, next.height))
    onChange(next)
  }
  return <fieldset className={styles.regionFields}>
    <legend>{label}</legend>
    <div className={styles.coordinateGrid}>
      {(['x', 'y', 'width', 'height'] as const).map((key) => <label key={key} htmlFor={`${id}-${key}`}>
        <span>{{ x: 'Left', y: 'Top', width: 'Width', height: 'Height' }[key]} %</span>
        <input id={`${id}-${key}`} type="number" min={key === 'width' || key === 'height' ? 1 : 0} max={100} step={1}
          value={Math.round(value[key] * 100)} onChange={(event) => change(key, event.target.value)} />
      </label>)}
    </div>
  </fieldset>
}

export function RegionControls({ crop, masks, onCropChange, onMasksChange, onRefresh, canPreview }: {
  crop: NormalizedRegion; masks: NormalizedRegion[]
  onCropChange: (crop: NormalizedRegion) => void
  onMasksChange: (masks: NormalizedRegion[]) => void
  onRefresh: () => void; canPreview: boolean
}) {
  return <details className={styles.settings}>
    <summary>Question area & excluded regions</summary>
    <p className={styles.muted}>These settings apply to shared-screen captures. Coordinates are percentages of the full shared source. Keep the complete question, diagrams and all answer choices in the question area. Changing these settings pauses automatic analysis.</p>
    <RegionFields label="Question area" value={crop} onChange={onCropChange} />
    <div className={styles.buttonRow}>
      <button type="button" className="btn-ghost" onClick={() => onCropChange(FULL_REGION)}>Use full screen</button>
      <button type="button" className="btn-ghost" disabled={masks.length >= 3} onClick={() => onMasksChange([...masks, { x: 0.75, y: 0, width: 0.25, height: 0.12 }])}>Add excluded region</button>
    </div>
    {masks.map((mask, index) => <div className={styles.mask} key={index}>
      <RegionFields label={`Excluded region ${index + 1}`} value={mask} onChange={(next) => onMasksChange(masks.map((item, i) => i === index ? next : item))} />
      <button type="button" className={styles.textButton} onClick={() => onMasksChange(masks.filter((_, i) => i !== index))}>Remove excluded region {index + 1}</button>
    </div>)}
    <p className={styles.muted}>Excluded regions are blanked before the screen capture is sent for analysis. This can leave a clock or unrelated page controls out of the question.</p>
    <button type="button" className="btn-ghost" onClick={onRefresh} disabled={!canPreview}>Refresh capture preview</button>
  </details>
}
