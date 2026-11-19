import { describe, expect, it } from 'vitest'
import { regionFromPoints } from './CaptureInspector'

describe('question area coordinates', () => {
  it('maps a reverse drag to the same source rectangle', () => {
    expect(regionFromPoints({ x: .8, y: .9 }, { x: .2, y: .1 })).toEqual({ x: .2, y: .1, width: .6000000000000001, height: .8 })
  })
  it('clamps a drag outside the source instead of capturing adjacent content', () => {
    expect(regionFromPoints({ x: -.1, y: .2 }, { x: 1.3, y: 1.4 })).toEqual({ x: 0, y: .2, width: 1, height: .8 })
  })
})
