import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AptitudeCapture, AptitudeCaptureStatus, ScreenSample } from '@/lib/aptitude/captureDetector'
import type { AptitudeRequest, AptitudeResult } from '@/lib/aptitude/schema'

type WatchOptions = { enabled: boolean; sampleFrame: () => ScreenSample; onCapture: (capture: AptitudeCapture) => void }
const mocks = vi.hoisted(() => ({
  screen: { sharing: false, starting: false, error: null as string | null, sourceLabel: 'Practice window', start: vi.fn(), stop: vi.fn(), sampleFrame: vi.fn() },
  watcher: { status: 'watching' as AptitudeCaptureStatus, lastCapturedAt: null, reset: vi.fn() },
  options: null as WatchOptions | null,
  read: vi.fn(), practice: vi.fn(),
}))

vi.mock('@/lib/vision/useScreenStream', () => ({ useScreenStream: () => mocks.screen }))
vi.mock('@/lib/aptitude/useAptitudeCapture', () => ({ useAptitudeCapture: (options: WatchOptions) => {
  mocks.options = options
  return { ...mocks.watcher, status: options.enabled ? mocks.watcher.status : 'paused' }
} }))
vi.mock('./captureInput', () => ({ readCaptureFile: (...args: unknown[]) => mocks.read(...args), createPracticeCapture: () => mocks.practice() }))

import { AptitudeWorkspace } from './AptitudeWorkspace'
import { comparisonFixture } from './comparisonTestFixtures'

function capture(id: string): AptitudeCapture {
  return { id, image: `data:image/png;base64,${btoa(id)}`, width: 100, height: 80, capturedAt: Date.now(), sourceHash: id }
}
function frame(value: AptitudeCapture): ScreenSample {
  return { ...value, kind: 'available', fingerprint: { width: 1, height: 1, pixels: new Uint8Array([10, 20, 30]), hash: value.sourceHash } }
}
function answer(request: AptitudeRequest): AptitudeResult {
  return {
    schemaVersion: 1, captureId: request.captureId, questionVersion: request.questionVersion,
    questionId: 'a'.repeat(64), sourceHash: 'b'.repeat(64), category: 'numerical', status: 'solved',
    question: { stem: 'What was the percentage increase?', instructions: [], passage: null,
      options: [{ id: 'a', label: 'A', text: '20%' }, { id: 'b', label: 'B', text: '25%' }], responseType: 'single_choice', missingEvidence: [] },
    answer: { selectedOptionIds: ['b'], value: '25', unit: '%', summary: 'The increase is 25%.',
      workedExplanation: ['The increase is 18.', '18 divided by 72 is 25%.'], evidence: ['72 tasks then 90 tasks.'], calculation: null },
    verification: { method: 'arithmetic', outcome: 'passed', notes: ['25% verified.'] },
    model: 'test-model', provider: 'openai', durationMs: 200, message: null,
  }
}

type Pending = { request: AptitudeRequest; signal: AbortSignal; resolve: (response: Response) => void }
let pending: Pending[]
beforeEach(() => {
  vi.clearAllMocks()
  pending = []
  mocks.screen.sharing = false
  mocks.screen.starting = false
  mocks.screen.error = null
  mocks.screen.start.mockImplementation(async () => { mocks.screen.sharing = true })
  mocks.screen.stop.mockImplementation(() => { mocks.screen.sharing = false })
  mocks.screen.sampleFrame.mockReturnValue(frame(capture('screen-first')))
  mocks.watcher.status = 'watching'
  mocks.options = null
  mocks.read.mockResolvedValue(capture('upload-first'))
  mocks.practice.mockReturnValue(capture('practice'))
  // jsdom does not implement native dialog lifecycle; the browser suite covers it.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value: function (this: HTMLDialogElement) { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value: function (this: HTMLDialogElement) { this.removeAttribute('open') } })
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise<Response>((resolve) => {
    pending.push({ request: JSON.parse(init.body as string), signal: init.signal as AbortSignal, resolve })
  })))
})
afterEach(() => { cleanup(); vi.unstubAllGlobals() })

function chooseScreenshot() {
  fireEvent.change(screen.getByLabelText('Upload aptitude screenshot'), { target: { files: [new File(['image'], 'question.png', { type: 'image/png' })] } })
}
async function complete(index = 0, value: unknown = answer(pending[index].request), status = 200) {
  await act(async () => pending[index].resolve(new Response(JSON.stringify(value), { status })))
}
function openRegions() { fireEvent.click(screen.getByText('Question area & excluded regions')) }
async function manualAnswer() {
  fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
  await complete(pending.length - 1)
}

describe('aptitude workspace', () => {
  it('defaults to single and discloses additional model calls before comparison is started', async () => {
    render(<AptitudeWorkspace />)
    const mode = screen.getByRole('combobox', { name: 'Analysis mode' }) as HTMLSelectElement
    expect(mode.value).toBe('single')
    chooseScreenshot()
    await screen.findByRole('button', { name: 'Analyze this capture' })
    fireEvent.change(mode, { target: { value: 'compare' } })
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByText(/same screenshot to 2–3 configured models/).textContent).toContain('additional provider credits')
    expect(screen.getByRole('heading', { name: 'Ready to compare this capture.' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    expect(pending[0].request.strategy).toBe('compare')
    await complete(0, comparisonFixture(answer(pending[0].request), 'majority'))
    expect(screen.getByRole('region', { name: 'Model comparison' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Majority agreement' })).toBeTruthy()
  })

  it('cancels and pauses on mode change, keeps the screenshot, and rejects retired automatic callbacks and results', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    const mode = screen.getByRole('combobox', { name: 'Analysis mode' })
    fireEvent.change(mode, { target: { value: 'compare' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic capture' }))
    const retiredCallback = mocks.options!.onCapture
    const first = capture('compare-first')
    act(() => retiredCallback(first))
    expect(pending[0].request.strategy).toBe('compare')
    expect(screen.getByRole('heading', { name: 'Comparing models' })).toBeTruthy()
    fireEvent.change(mode, { target: { value: 'single' } })
    expect(pending[0].signal.aborted).toBe(true)
    expect(mocks.options?.enabled).toBe(false)
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(first.image)
    act(() => retiredCallback(capture('late-old-mode')))
    expect(pending).toHaveLength(1)
    await complete(0, comparisonFixture(answer(pending[0].request)))
    expect(screen.queryByRole('region', { name: 'Model comparison' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    expect(pending[1].request.strategy).toBeUndefined()
    expect(pending[1].request.image).toBe(first.image)
    await complete(1)
    expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
  })

  it('analyzes an uploaded screenshot without starting screen or microphone capture', async () => {
    render(<AptitudeWorkspace />)
    expect(mocks.screen.start).not.toHaveBeenCalled()
    expect(mocks.options?.enabled).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
    expect((screen.getByRole('button', { name: 'Capture now' }) as HTMLButtonElement).disabled).toBe(true)
    chooseScreenshot()
    await screen.findByRole('heading', { name: 'New capture ready to analyze.' })
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Clear captures and history' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    expect(fetch).toHaveBeenCalledWith('/api/aptitude/analyze', expect.objectContaining({ method: 'POST' }))
    expect(pending[0].request).toEqual({ captureId: 'upload-first', questionVersion: 1, image: capture('upload-first').image, category: 'auto' })
    expect(screen.getByRole('button', { name: 'Stop analysis' })).toBeTruthy()
    await complete()
    expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
    expect(screen.getByRole('region', { name: 'Worked explanation' }).textContent).toContain('18 divided by 72')
    expect(screen.getByRole('heading', { name: 'Calculation matches' })).toBeTruthy()
    expect(screen.getByText('Capture 1')).toBeTruthy()
    expect(screen.queryByText('a'.repeat(64), { exact: false })).toBeNull()
    expect(mocks.screen.start).not.toHaveBeenCalled()
  })

  it('hides the previous answer as soon as a different image is chosen, while allowing explicit history review', async () => {
    render(<AptitudeWorkspace />)
    chooseScreenshot()
    await screen.findByRole('button', { name: 'Analyze this capture' })
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    await complete()
    let finishUpload!: (value: AptitudeCapture) => void
    mocks.read.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve }))
    chooseScreenshot()
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    await act(async () => finishUpload(capture('upload-second')))
    expect(screen.getByRole('heading', { name: 'New capture ready to analyze.' })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('View a question'), { target: { value: 'upload-first' } })
    expect(screen.getByText(/^Viewing a saved capture/)).toBeTruthy()
    expect(screen.getByAltText('Screenshot for selected saved capture').getAttribute('src')).toBe(capture('upload-first').image)
    expect(screen.queryByRole('button', { name: 'Analyze this capture' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Follow latest' }))
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(capture('upload-second').image)
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Try a practice question' }))
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(document.getElementById('aptitude-practice')).toBeTruthy()
    expect((screen.getByLabelText('Question type') as HTMLSelectElement).value).toBe('numerical')
  })

  it('keeps automatic detection active while solving and coalesces an unchanged manual capture', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Capture now' }))
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic capture' }))
    expect(mocks.options?.enabled).toBe(true)
    act(() => mocks.options!.onCapture({ ...capture('screen-first'), id: 'same-auto-image' }))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(pending[0].signal.aborted).toBe(false)
    act(() => mocks.options!.onCapture(capture('screen-second')))
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(pending[0].signal.aborted).toBe(true)
    expect(mocks.options?.enabled).toBe(true)
    await complete(1)
    await complete(0)
    expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic capture' }))
    expect(mocks.options?.enabled).toBe(false)
    expect(mocks.screen.stop).not.toHaveBeenCalled()
  })

  it('keeps the selected saved image paired with its answer while newer automatic captures arrive', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    await manualAnswer()
    const history = screen.getByLabelText('View a question') as HTMLSelectElement
    fireEvent.change(history, { target: { value: history.options[1].value } })
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic capture' }))
    act(() => mocks.options!.onCapture(capture('newer-automatic')))
    await complete(1)
    expect(screen.getByAltText('Screenshot for selected saved capture').getAttribute('src')).toBe(capture('screen-first').image)
    expect(screen.getByAltText('Exact screenshot used for this question analysis').getAttribute('src')).toBe(capture('screen-first').image)
    fireEvent.click(screen.getByRole('button', { name: 'Return to latest capture' }))
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(capture('newer-automatic').image)
    expect(screen.getByAltText('Exact screenshot used for this question analysis').getAttribute('src')).toBe(capture('newer-automatic').image)
  })

  it('uses a local selector preview but analyzes a freshly sampled detailed crop', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    const selector = capture('selector-thumbnail')
    mocks.screen.sampleFrame.mockReturnValueOnce(frame(selector))
    fireEvent.click(screen.getByRole('button', { name: 'Select question area' }))
    expect(mocks.screen.sampleFrame).toHaveBeenLastCalledWith({ crop: { x: 0, y: 0, width: 1, height: 1 }, masks: [], previewOnly: true })
    const dialog = screen.getByRole('dialog', { name: 'Select question area' })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Left %' }), { target: { value: '20' } })
    fireEvent.change(within(dialog).getByRole('spinbutton', { name: 'Width %' }), { target: { value: '50' } })
    const detailed = capture('detailed-crop')
    mocks.screen.sampleFrame.mockReturnValueOnce(frame(detailed))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use selected area' }))
    expect(mocks.screen.sampleFrame).toHaveBeenLastCalledWith({ crop: { x: .2, y: 0, width: .5, height: 1 }, masks: [] })
    expect(fetch).not.toHaveBeenCalled()
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(detailed.image)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    expect(pending[0].request.image).toBe(detailed.image)
    expect(pending[0].request.image).not.toBe(selector.image)
    await complete()
  })

  it('keeps the previous capture if applying an area fails and closes a selector when the browser stops sharing', async () => {
    mocks.screen.sharing = true
    const view = render(<AptitudeWorkspace />)
    await manualAnswer()
    fireEvent.click(screen.getByRole('button', { name: 'Select question area' }))
    mocks.screen.sampleFrame.mockReturnValueOnce({ kind: 'unavailable', reason: 'The source ended.' })
    fireEvent.click(screen.getByRole('button', { name: 'Use selected area' }))
    expect(screen.getByRole('alert').textContent).toContain('The source ended.')
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(capture('screen-first').image)
    expect(pending).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'Select question area' }))
    mocks.screen.sharing = false
    view.rerender(<AptitudeWorkspace />)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(capture('screen-first').image)
  })

  it('withholds the previous choice while a changed screen settles, including when paused before capturing it', async () => {
    mocks.screen.sharing = true
    const { rerender } = render(<AptitudeWorkspace />)
    await manualAnswer()
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic capture' }))
    mocks.watcher.status = 'settling'
    rerender(<AptitudeWorkspace />)
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    expect(screen.getByRole('heading', { name: 'The question is changing.' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Pause automatic capture' }))
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'View previous capture' }))
    expect(screen.getByText('Viewing a saved capture.')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'B — 25%' })).toBeTruthy()
  })

  it('stops the existing source before requesting a replacement and never presents its old answer for the new preview', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    await manualAnswer()
    mocks.screen.sampleFrame.mockReturnValue(frame(capture('replacement-screen')))
    fireEvent.click(screen.getByRole('button', { name: 'Change shared screen' }))
    await screen.findByRole('heading', { name: 'New capture ready to analyze.' })
    expect(mocks.screen.stop).toHaveBeenCalledOnce()
    expect(mocks.screen.start).toHaveBeenCalledOnce()
    expect(mocks.screen.stop.mock.invocationCallOrder[0]).toBeLessThan(mocks.screen.start.mock.invocationCallOrder[0])
    expect(mocks.watcher.reset).toHaveBeenCalled()
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('invalidates unmasked previews on region changes and sends only the refreshed capture', async () => {
    mocks.screen.sharing = true
    render(<AptitudeWorkspace />)
    await manualAnswer()
    openRegions()
    fireEvent.click(screen.getByRole('button', { name: 'Add excluded region' }))
    expect(screen.queryByRole('button', { name: 'Analyze this capture' })).toBeNull()
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
    const masked = capture('masked-screen')
    mocks.screen.sampleFrame.mockReturnValue(frame(masked))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh capture preview' }))
    expect(mocks.screen.sampleFrame).toHaveBeenLastCalledWith({ crop: { x: 0, y: 0, width: 1, height: 1 }, masks: [{ x: 0.75, y: 0, width: 0.25, height: 0.12 }] })
    expect(screen.getByAltText('Question screenshot ready for analysis').getAttribute('src')).toBe(masked.image)
    expect(fetch).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    expect(pending[1].request.image).toBe(masked.image)
    fireEvent.click(screen.getByRole('button', { name: 'Clear captures and history' }))
    expect(pending[1].signal.aborted).toBe(true)
    expect(screen.queryByRole('button', { name: 'Analyze this capture' })).toBeNull()
    await complete(1)
    expect(screen.queryByRole('heading', { name: 'B — 25%' })).toBeNull()
  })

  it('prevents automatic or preview capture from racing an image load and discards a cancelled upload', async () => {
    mocks.screen.sharing = true
    let finishUpload!: (value: AptitudeCapture) => void
    mocks.read.mockImplementationOnce(() => new Promise((resolve) => { finishUpload = resolve }))
    render(<AptitudeWorkspace />)
    openRegions()
    chooseScreenshot()
    expect((screen.getByRole('button', { name: 'Start automatic capture' }) as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button', { name: 'Refresh capture preview' }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByRole('button', { name: 'Add excluded region' }))
    expect((mocks.read.mock.calls[0][1] as AbortSignal).aborted).toBe(true)
    await act(async () => finishUpload(capture('cancelled-upload')))
    expect(screen.queryByAltText('Question screenshot ready for analysis')).toBeNull()
    expect(fetch).not.toHaveBeenCalled()
  })

  it('resets automatic capture and aborts the request when sharing ends in the browser', () => {
    mocks.screen.sharing = true
    const { rerender } = render(<AptitudeWorkspace />)
    fireEvent.click(screen.getByRole('button', { name: 'Start automatic capture' }))
    act(() => mocks.options!.onCapture(capture('active-screen')))
    mocks.screen.sharing = false
    rerender(<AptitudeWorkspace />)
    expect(pending[0].signal.aborted).toBe(true)
    expect(mocks.options?.enabled).toBe(false)
    mocks.screen.sharing = true
    rerender(<AptitudeWorkspace />)
    expect(screen.getByRole('button', { name: 'Start automatic capture' }).getAttribute('aria-pressed')).toBe('false')
    expect(mocks.options?.enabled).toBe(false)
  })

  it('explains missing evidence without inventing an answer and keeps recapture reachable', async () => {
    render(<AptitudeWorkspace />)
    chooseScreenshot()
    await waitFor(() => expect(screen.getByRole('button', { name: 'Analyze this capture' })).toBeTruthy())
    fireEvent.click(screen.getByRole('button', { name: 'Analyze this capture' }))
    const incomplete = answer(pending[0].request)
    incomplete.status = 'needs_capture'
    incomplete.answer = null
    incomplete.question!.missingEvidence = ['The complete passage and all answer choices.']
    incomplete.message = 'Part of the passage is cut off.'
    incomplete.verification = { method: 'none', outcome: 'not_run', notes: [] }
    await complete(0, incomplete)
    expect(screen.getByRole('heading', { name: 'Needs another capture' })).toBeTruthy()
    expect(screen.getByText('The complete passage and all answer choices.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Capture a complete view' })).toBeTruthy()
    expect(screen.queryByText('Suggested answer')).toBeNull()
  })
})
