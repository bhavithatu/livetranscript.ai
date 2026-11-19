'use client'

import Image from 'next/image'
import { useEffect, useId, useRef, useState, type PointerEvent } from 'react'
import type { AptitudeCapture, NormalizedRegion } from '@/lib/aptitude/captureDetector'
import { FULL_REGION, RegionFields } from './RegionControls'
import styles from './AptitudeWorkspace.module.css'

type Point = { x: number; y: number }
const clamp = (value: number) => Math.min(1, Math.max(0, value))

export function regionFromPoints(start: Point, end: Point): NormalizedRegion {
  const left = Math.min(clamp(start.x), clamp(end.x))
  const top = Math.min(clamp(start.y), clamp(end.y))
  return { x: left, y: top, width: Math.max(0, Math.max(clamp(start.x), clamp(end.x)) - left), height: Math.max(0, Math.max(clamp(start.y), clamp(end.y)) - top) }
}

/** This local inspection/selection view never sends an image to a model. */
export function CaptureInspector({ capture, title, crop, onApply, onClose }: {
  capture: AptitudeCapture; title: string; crop?: NormalizedRegion
  onApply?: (region: NormalizedRegion) => void; onClose: () => void
}) {
  const dialog = useRef<HTMLDialogElement>(null)
  const anchor = useRef<Point | null>(null)
  const previous = useRef(crop ?? FULL_REGION)
  const [region, setRegion] = useState(crop ?? FULL_REGION)
  const [actualPixels, setActualPixels] = useState(false)
  const titleId = useId()
  const instructionsId = useId()
  const selecting = !!onApply
  useEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => element?.close()
  }, [])

  const position = (event: PointerEvent<HTMLDivElement>): Point => {
    const rect = event.currentTarget.getBoundingClientRect()
    return { x: clamp((event.clientX - rect.left) / Math.max(1, rect.width)), y: clamp((event.clientY - rect.top) / Math.max(1, rect.height)) }
  }
  const finish = (event: PointerEvent<HTMLDivElement>) => {
    if (!anchor.current) return
    const next = regionFromPoints(anchor.current, position(event))
    setRegion(next.width >= 0.01 && next.height >= 0.01 ? next : previous.current)
    anchor.current = null
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  return <dialog ref={dialog} className={styles.captureDialog} aria-labelledby={titleId} aria-describedby={instructionsId}
    onCancel={(event) => { event.preventDefault(); onClose() }}>
    <div className={styles.dialogHeading}>
      <div><h2 id={titleId}>{title}</h2><p id={instructionsId}>{selecting
        ? 'Keep the source layout unchanged. Drag around the complete question and all answer choices, or enter percentages below. Applying an area refreshes the preview; it does not start analysis.'
        : 'This is the exact image associated with this capture. Use Actual pixels to check small text and diagram details.'}</p></div>
      <button type="button" className="btn-ghost" onClick={onClose} autoFocus>Close</button>
    </div>
    {!selecting && <div className={styles.buttonRow}>
      <button type="button" className="btn-ghost" aria-pressed={!actualPixels} onClick={() => setActualPixels(false)}>Fit to window</button>
      <button type="button" className="btn-ghost" aria-pressed={actualPixels} onClick={() => setActualPixels(true)}>Actual pixels</button>
      <span className={styles.muted}>{capture.width} × {capture.height}</span>
    </div>}
    <div className={styles.inspectionViewport}>
      <div className={selecting ? styles.selectionSurface : styles.inspectionSurface}
        style={{ width: !selecting && actualPixels ? capture.width : `min(100%, ${58 * capture.width / capture.height}vh)`, maxWidth: actualPixels ? 'none' : '100%' }}
        role={selecting ? 'region' : undefined} aria-label={selecting ? 'Question area selection' : undefined}
        onPointerDown={selecting ? (event) => {
          if (event.button !== 0) return
          event.preventDefault()
          previous.current = region
          anchor.current = position(event)
          event.currentTarget.setPointerCapture?.(event.pointerId)
        } : undefined}
        onPointerMove={selecting ? (event) => { if (anchor.current) setRegion(regionFromPoints(anchor.current, position(event))) } : undefined}
        onPointerUp={selecting ? finish : undefined}
        onPointerCancel={selecting ? () => { anchor.current = null; setRegion(previous.current) } : undefined}>
        <Image src={capture.image} width={capture.width} height={capture.height} alt={selecting ? 'Shared source for selecting the question area' : 'Enlarged exact capture'}
          className={styles.inspectionImage} draggable={false} unoptimized />
        {selecting && <div className={styles.selectionBox} aria-hidden style={{ left: `${region.x * 100}%`, top: `${region.y * 100}%`, width: `${region.width * 100}%`, height: `${region.height * 100}%` }} />}
      </div>
    </div>
    {selecting && <>
      <RegionFields label="Selected question area" value={region} onChange={setRegion} />
      <div className={styles.buttonRow}>
        <button type="button" className="btn-signal" disabled={region.width < 0.01 || region.height < 0.01} onClick={() => onApply(region)}>Use selected area</button>
        <button type="button" className="btn-ghost" onClick={() => setRegion(FULL_REGION)}>Select full source</button>
        <button type="button" className="btn-ghost" onClick={onClose}>Cancel selection</button>
      </div>
    </>}
  </dialog>
}
