"""Real Next UI and capture pipeline, synthetic screen and explicit provider stub.

Run against a local Next server with no Clerk configuration (CI uses `pnpm start`
after building). The unauthenticated probe must pass before any image is sent.
This is browser integration evidence, never a live-model accuracy benchmark or
an operating-system screen-picker certification. No paid API calls are made.
"""
import asyncio
import base64
import copy
import hashlib
import json
import os
import pathlib
import re
import time
from playwright.async_api import Error as PlaywrightError, async_playwright, expect

BASE = os.environ.get('APTITUDE_QA_URL', 'http://127.0.0.1:3000').rstrip('/')
OUT = pathlib.Path('qa-results/aptitude')
OUT.mkdir(parents=True, exist_ok=True)

# The app still calls getDisplayMedia, uses a real MediaStream and samples a real
# playing video. Only the browser picker/source is replaced with owned content.
SCREEN = r"""(() => {
  let canvas, stream, question = 1, displayCalls = 0, microphoneCalls = 0;
  function draw(n) {
    question = n;
    if (!canvas) return;
    const c = canvas.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0,0,1000,650);
    c.fillStyle = '#25271f'; c.font = 'bold 32px sans-serif';
    c.fillText('Original browser fixture ' + n, 50, 80);
    c.font = '28px sans-serif';
    c.fillText('A team completed 80 tasks in week 1',50,155);
    c.fillText('and ' + (80+20*n) + ' tasks in week 2.',50,200);
    c.fillText('What was the percentage increase?',50,265);
    ['A. 0%', 'B. '+(25*n)+'%', 'C. 88%', 'D. 125%'].forEach((x,i)=>c.fillText(x,60,350+60*i));
  }
  window.__aptitudeScreen = {
    show: draw,
    ended: () => { for (const t of stream?.getTracks() || []) { t.stop(); t.dispatchEvent(new Event('ended')); } },
    liveTracks: () => (stream?.getTracks() || []).filter(t=>t.readyState==='live').length,
    calls: () => ({ display: displayCalls, microphone: microphoneCalls })
  };
  const devices = navigator.mediaDevices || {};
  Object.defineProperty(devices, 'getDisplayMedia', { configurable: true, value: async () => {
    displayCalls++;
    canvas = document.createElement('canvas'); canvas.width=1000; canvas.height=650;
    draw(question); stream = canvas.captureStream(10); return stream;
  }});
  Object.defineProperty(devices, 'getUserMedia', { configurable: true, value: async () => {
    microphoneCalls++;
    throw new DOMException('Microphone access is unexpected in this browser test.', 'NotAllowedError');
  }});
  if (!navigator.mediaDevices) Object.defineProperty(navigator, 'mediaDevices', {value: devices});
})()"""


def response_for(body, number=0, status='solved'):
    before, after = (72, 90) if number == 0 else (80, 80 + 20 * number)
    value = 25 if number == 0 else 25 * number
    options = [('A', '20%'), ('B', '25%'), ('C', '18%'), ('D', '30%')] if number == 0 else [('A', '0%'), ('B', f'{value}%'), ('C', '88%'), ('D', '125%')]
    question = {
        'stem': f'A team completed {before} tasks in week 1 and {after} tasks in week 2. What was the percentage increase?',
        'instructions': [], 'passage': None,
        'options': [{'id': x, 'label': x, 'text': y} for x, y in options],
        'responseType': 'single_choice', 'missingEvidence': [],
    }
    image_hash = hashlib.sha256(base64.b64decode(body['image'].split(',', 1)[1])).hexdigest()
    answer = {'selectedOptionIds': ['B'], 'value': str(value), 'unit': '%',
              'summary': f'The increase is {value}%.',
              'workedExplanation': [f'The increase is {after} − {before} = {after-before}.', f'Divide by {before} and multiply by 100 to get {value}%.'],
              'evidence': [f'The captured question gives {before} and {after} tasks.'],
              'calculation': {'expression': f'({after}-{before})/{before}*100', 'claimedValue': value, 'decimalPlaces': None}}
    if status != 'solved':
        answer = None
        question['missingEvidence'] = ['Include all answer choices in the capture.']
    return {'schemaVersion': 1, 'captureId': body['captureId'], 'questionVersion': body['questionVersion'],
            'questionId': hashlib.sha256(question['stem'].encode()).hexdigest(), 'sourceHash': image_hash,
            'category': 'numerical', 'status': status, 'question': question, 'answer': answer,
            'message': None if status == 'solved' else 'The question is incomplete. Capture all choices.',
            'verification': {'method': 'arithmetic' if status == 'solved' else 'none',
                             'outcome': 'passed' if status == 'solved' else 'not_run',
                             'notes': ['Synthetic browser response; this does not measure model accuracy.']},
            'provider': 'openai', 'model': 'browser-qa-stub', 'durationMs': 12}


def comparison_response_for(body, decision):
    """Owned practice question, explicit sample responses, no model claims.

    Option IDs differ across providers on purpose. The wrong 20% response has a
    valid calculation but uses the final value as its denominator, demonstrating
    why the arithmetic badge cannot certify the chosen method.
    """
    base = response_for(body)
    models = [('anthropic', 'claude-sonnet-4-5'), ('openai', 'gpt-4.1')]
    if decision == 'majority':
        models.append(('openai', 'gpt-4.1-mini'))
    candidates = []
    for index, (provider, model) in enumerate(models):
        candidate = {'modelId': f'{provider}:{model}', 'provider': provider,
                     'model': model, 'status': 'complete', 'durationMs': 0, 'error': None}
        if decision == 'insufficient' and index == 1:
            candidate.update({'status': 'timed_out', 'model': None, 'observation': None,
                              'verification': None, 'error': 'Sample timeout: this model did not return an answer.'})
            candidates.append(candidate)
            continue
        observation = {key: copy.deepcopy(base[key]) for key in ['category', 'status', 'question', 'answer', 'message']}
        if decision == 'evidence_mismatch' and index == 1:
            observation['question']['stem'] = 'A team completed 72 tasks before and 90 after. What is the percentage increase?'
        for option in observation['question']['options']:
            option['id'] = f'{index}-{option["id"]}'
        wrong = (decision == 'disagreement' and index == 1) or (decision == 'majority' and index == 2)
        observation['answer']['selectedOptionIds'] = [f'{index}-A' if wrong else f'{index}-B']
        if wrong:
            observation['answer'].update({
                'value': '20', 'summary': 'The increase is 20%.',
                'workedExplanation': ['The increase is 90 − 72 = 18.', 'Divide by the final value, 90, and multiply by 100 to get 20%.'],
                'calculation': {'expression': '(90-72)/90*100', 'claimedValue': 20, 'decimalPlaces': None},
            })
        candidate.update({'observation': observation, 'verification': {
            'method': 'arithmetic', 'outcome': 'passed',
            'notes': ['The stated calculation is consistent. The choice of formula still needs review.'],
        }})
        candidates.append(candidate)
    resolved = decision in ['agreement', 'majority']
    selected = candidates[0] if resolved else None
    result = copy.deepcopy(base)
    if selected:
        result.update(copy.deepcopy(selected['observation']))
        result.update({'model': selected['model'], 'provider': selected['provider'],
                       'verification': copy.deepcopy(selected['verification'])})
    else:
        result.update({'status': 'ambiguous', 'answer': None, 'model': None, 'provider': None,
                       'message': 'Review the individual answers; this comparison does not support a recommendation.',
                       'verification': {'method': 'none', 'outcome': 'not_run', 'notes': []}})
    result['durationMs'] = 0
    result['comparison'] = {
        'decision': 'disagreement' if decision == 'evidence_mismatch' else decision, 'selectedModelId': selected['modelId'] if selected else None,
        'agreementCount': 2 if resolved else 1,
        'notes': ['Sample model responses for this screen preview. No live provider calls or model latency benchmark.',
                  'Agreement does not prove correctness. Models may share the same reading or reasoning mistake.'],
        'candidates': candidates,
    }
    return result


async def main():
    report = {'kind': 'aptitude-browser-integration', 'liveModel': False, 'nativePicker': False,
              'checks': [], 'layouts': [], 'browserErrors': [], 'stubErrors': []}
    requests = []
    state = {'number': 0, 'status': 'solved', 'delay': 0, 'comparison': 'agreement'}
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None, args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 1000})
        page.set_default_timeout(15000)
        # Locator assertions have their own timeout; page.set_default_timeout
        # does not change Playwright's otherwise five-second expect deadline.
        expect.set_options(timeout=15000)
        await page.add_init_script(SCREEN)
        page.on('pageerror', lambda error: report['browserErrors'].append(str(error)))

        async def wait_for_requests(expected):
            deadline = time.monotonic() + 15
            while len(requests) < expected and time.monotonic() < deadline:
                await asyncio.sleep(.05)
            assert len(requests) == expected, f'Expected {expected} stub requests, received {len(requests)}'

        async def click_for_request(button):
            expected = len(requests) + 1
            await button.click()
            await wait_for_requests(expected)

        try:
            # An empty body cannot reach a model even if this server was
            # accidentally launched with an auth preview bypass. Fail early in
            # that case, before testing the real image submission below.
            probe = await page.request.post(BASE + '/api/aptitude/analyze', data={})
            assert probe.status == 401, f'Expected an unauthenticated local server, received HTTP {probe.status}'
            await page.goto(BASE + '/tools', wait_until='networkidle')
            await expect(page.get_by_role('heading', name='Explore all tools', exact=True)).to_be_visible()
            for label in ['Questions and analysis', 'Practice and evaluation', 'Capture and collaboration', 'Make it yours']:
                await expect(page.get_by_role('heading', name=label, exact=True)).to_be_visible()
            await page.get_by_role('link', name='Open Aptitude', exact=True).click()
            await expect(page.get_by_role('heading', name='Aptitude', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='Share screen', exact=True)).to_be_visible()
            assert await page.get_by_role('button', name='Start listening', exact=True).count() == 0
            assert await page.evaluate('window.__aptitudeScreen.calls()') == {'display': 0, 'microphone': 0}
            report['checks'].append('Tools catalog and direct Aptitude navigation; no microphone starts')

            await page.get_by_role('button', name='Try a practice question', exact=True).click()
            preview = page.get_by_alt_text('Question screenshot ready for analysis')
            await expect(preview).to_be_visible()
            sample = await preview.get_attribute('src')
            upload = OUT / 'owned-practice-input.png'
            upload.write_bytes(base64.b64decode(sample.split(',', 1)[1]))
            await page.get_by_role('button', name='Analyze this capture', exact=True).click()
            await expect(page.get_by_role('alert').filter(has_text='Sign in')).to_be_visible()
            report['checks'].append('Real Next API rejects unauthenticated analysis and retains capture for retry')

            async def serve(route):
                body = route.request.post_data_json
                assert set(body) in [
                    {'captureId', 'questionVersion', 'image', 'category'},
                    {'captureId', 'questionVersion', 'image', 'category', 'strategy'},
                ]
                assert body.get('strategy', 'single') in ['single', 'compare']
                assert body['image'].startswith('data:image/')
                requests.append({'captureId': body['captureId'], 'version': body['questionVersion'], 'number': state['number'], 'strategy': body.get('strategy', 'single'),
                                 'imageHash': hashlib.sha256(base64.b64decode(body['image'].split(',', 1)[1])).hexdigest(), 'at': time.monotonic()})
                mode, number, delay = state['status'], state['number'], state['delay']
                comparison = state['comparison']
                if delay:
                    await asyncio.sleep(delay)
                try:
                    if mode == 'error':
                        await route.fulfill(status=502, json={'error': 'Synthetic provider interruption. Retry this capture.'})
                    else:
                        result = comparison_response_for(body, comparison) if body.get('strategy') == 'compare' else response_for(body, number, mode)
                        await route.fulfill(status=200, json=result)
                except PlaywrightError as error:
                    # Retired requests may fail fulfillment after an intentional
                    # abort. Do not swallow fixture/JSON errors or other route
                    # failures and accidentally report them as model behavior.
                    failure = route.request.failure or ''
                    if 'ERR_ABORTED' not in failure and not any(token in str(error) for token in ['Invalid InterceptionId', 'Target page, context or browser has been closed']):
                        report['stubErrors'].append(str(error))
            await page.route('**/api/aptitude/analyze', serve)
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            await expect(page.get_by_role('region', name='Worked explanation')).to_be_visible()
            await expect(page.get_by_role('region', name='Answer check')).to_be_visible()
            report['checks'].append('Capture → request → validated choice, worked explanation and check (provider stub)')

            state['status'] = 'needs_capture'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(page.get_by_role('button', name='Capture a complete view', exact=True)).to_be_visible()
            assert await page.get_by_text('Suggested answer', exact=True).count() == 0
            state['status'] = 'error'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(page.get_by_role('alert').filter(has_text='Synthetic provider interruption')).to_be_visible()
            state['status'] = 'solved'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            report['checks'].append('Missing evidence withholds choice; provider failure recovers on explicit retry')

            await page.get_by_label('Upload aptitude screenshot', exact=True).set_input_files(str(upload))
            await expect(page.get_by_text('Screenshot ready. Select Analyze this capture when you are ready.', exact=True)).to_be_visible()
            await expect(preview).to_have_attribute('src', sample)
            identical_upload_count = len(requests)
            await page.get_by_role('button', name='Analyze this capture', exact=True).click()
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            # Playwright's exact label matcher includes all descendant option
            # text from this wrapping label. Scope to the history's unique
            # native combobox instead; evaluate_all on a missing label locator
            # silently returned [], even while the UI correctly held two items.
            history_select = page.get_by_role('region', name='Question history', exact=True).get_by_role('combobox')
            await expect(history_select).to_have_count(1)
            history_options = history_select.locator('option[value]:not([value=""])')
            await expect(history_options).to_have_count(1)
            await asyncio.sleep(.3)
            assert len(requests) == identical_upload_count, 'Uploading identical PNG bytes should reuse the existing validated answer'
            assert await history_options.evaluate_all('(items)=>items.map(x=>x.value)') == [requests[0]['captureId']], 'Identical upload must not create duplicate question history'
            report['checks'].append('Identical lossless PNG upload reuses the validated answer and existing history without a provider request')

            # A genuine second image, not an incidental JPEG transcode difference:
            # add a visible banner above the same complete owned practice question.
            distinct_sample = await page.evaluate('''async (original) => {
                const image = new Image(); image.src = original; await image.decode();
                const canvas = document.createElement('canvas');
                canvas.width = image.naturalWidth; canvas.height = image.naturalHeight + 72;
                const context = canvas.getContext('2d');
                context.fillStyle = '#ffffff'; context.fillRect(0, 0, canvas.width, canvas.height);
                context.drawImage(image, 0, 72);
                context.fillStyle = '#e0e7ff'; context.fillRect(0, 0, canvas.width, 72);
                context.fillStyle = '#312e81'; context.font = 'bold 26px sans-serif';
                context.fillText('Uploaded fixture', 54, 46);
                return canvas.toDataURL('image/png');
            }''', sample)
            distinct_upload = OUT / 'owned-distinct-upload.png'
            distinct_upload.write_bytes(base64.b64decode(distinct_sample.split(',', 1)[1]))
            assert distinct_sample != sample
            await page.get_by_label('Upload aptitude screenshot', exact=True).set_input_files(str(distinct_upload))
            await expect(preview).not_to_have_attribute('src', sample)
            await expect(page.get_by_text('Screenshot ready. Select Analyze this capture when you are ready.', exact=True)).to_be_visible()
            await click_for_request(page.get_by_role('button', name='Analyze this capture', exact=True))
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            assert requests[-1]['imageHash'] != requests[0]['imageHash'], 'The second upload must contain genuinely different pixels'
            choices = await history_options.evaluate_all('(items)=>items.map(x=>x.value)')
            expected_choices = [requests[-1]['captureId'], requests[0]['captureId']]
            report['uploadedHistory'] = {'actualCaptureIds': choices, 'expectedCaptureIds': expected_choices}
            await expect(history_options).to_have_count(2)
            assert choices == expected_choices, f'History must contain the uploaded and original captures in newest-first order: {report["uploadedHistory"]}'
            await history_select.select_option(choices[-1])
            await expect(page.get_by_role('button', name='Follow latest', exact=True)).to_be_visible()
            saved_preview = page.get_by_alt_text('Screenshot for selected saved capture', exact=True)
            await expect(saved_preview).to_have_attribute('src', sample)
            await page.get_by_role('button', name='Enlarge capture', exact=True).click()
            inspector = page.get_by_role('dialog')
            await expect(inspector).to_be_visible()
            await expect(inspector.get_by_alt_text('Enlarged exact capture', exact=True)).to_have_attribute('src', sample)
            await inspector.get_by_role('button', name='Actual pixels', exact=True).click()
            await expect(inspector.get_by_role('button', name='Actual pixels', exact=True)).to_have_attribute('aria-pressed', 'true')
            await inspector.get_by_role('button', name='Close', exact=True).click()
            await expect(inspector).to_have_count(0)
            report['checks'].append('Real image upload, bounded question history and explicit history pinning')
            report['checks'].append('Enlarged saved capture uses the exact associated image and supports Actual pixels')

            state['number'] = 1
            await page.get_by_role('button', name='Share screen', exact=True).click()
            await expect(page.get_by_role('button', name='Start automatic capture', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='Follow latest', exact=True)).to_have_count(0)
            await expect(preview).to_be_visible()
            await expect(saved_preview).to_have_count(0)
            # Explicitly selecting a new source returns to its latest preview.
            # Pin the old result again to test background automatic capture while reviewing history.
            await history_select.select_option(choices[-1])
            await expect(saved_preview).to_have_attribute('src', sample)
            baseline = len(requests)
            await page.get_by_role('button', name='Start automatic capture', exact=True).click()
            await wait_for_requests(baseline + 1)
            await expect(page.get_by_role('button', name='Follow latest', exact=True)).to_be_visible()
            await expect(saved_preview).to_have_attribute('src', sample)
            saved_hash = hashlib.sha256(base64.b64decode(sample.split(',', 1)[1])).hexdigest()
            assert requests[-1]['imageHash'] != saved_hash, 'New automatic screen capture unexpectedly reused the old practice image'
            await page.get_by_role('button', name='Follow latest', exact=True).click()
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            latest_image = await preview.get_attribute('src')
            assert hashlib.sha256(base64.b64decode(latest_image.split(',', 1)[1])).hexdigest() == requests[-1]['imageHash'], 'Preview must match the currently displayed capture, including after Follow latest'
            count = len(requests)
            await asyncio.sleep(1.5)
            assert len(requests) == count, 'Unchanged screen caused a duplicate request'
            report['checks'].append('Actual video/canvas sampler auto-captures a stable screen once; history pin does not stop capture')
            report['checks'].append('Pinned history preview stays with its old answer while a different image is analyzed; Follow latest restores the new image')

            changed_at = time.monotonic()
            state['number'] = 2
            await page.evaluate('window.__aptitudeScreen.show(2)')
            await asyncio.sleep(.15)
            state['number'] = 3
            await page.evaluate('window.__aptitudeScreen.show(3)')
            await expect(page.get_by_role('heading', name='B — 75%', exact=True)).to_be_visible()
            assert len(requests) == count + 1, 'Intermediate unstable question was submitted'
            report['syntheticChangeToRequestMs'] = round((requests[-1]['at'] - changed_at) * 1000)
            report['checks'].append('Rapid A→B→C visual change captures final stable C without a 15-second blind period')

            await page.get_by_role('button', name='Pause automatic capture', exact=True).click()
            count = len(requests)
            state['number'] = 4
            await page.evaluate('window.__aptitudeScreen.show(4)')
            await asyncio.sleep(1.4)
            assert len(requests) == count
            await click_for_request(page.get_by_role('button', name='Capture now', exact=True))
            await expect(page.get_by_role('heading', name='B — 100%', exact=True)).to_be_visible()
            await page.get_by_role('button', name='Capture now', exact=True).click()
            await expect(page.get_by_role('heading', name='B — 100%', exact=True)).to_be_visible()
            await asyncio.sleep(.5)
            assert len(requests) == count + 1, 'Identical image should reuse its validated answer'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(page.get_by_role('heading', name='B — 100%', exact=True)).to_be_visible()
            assert len(requests) == count + 2, 'Explicit retry should force a fresh request'
            crop_request_count = len(requests)
            await page.get_by_role('button', name='Select question area', exact=True).click()
            crop_dialog = page.get_by_role('dialog', name='Select question area', exact=True)
            await expect(crop_dialog).to_be_visible()
            surface = crop_dialog.get_by_role('region', name='Question area selection', exact=True)
            bounds = await surface.bounding_box()
            assert bounds and bounds['width'] > 0 and bounds['height'] > 0
            await page.mouse.move(bounds['x'] + bounds['width'] * .05, bounds['y'] + bounds['height'] * .10)
            await page.mouse.down()
            await page.mouse.move(bounds['x'] + bounds['width'] * .95, bounds['y'] + bounds['height'] * .95, steps=5)
            await page.mouse.up()
            await expect(crop_dialog.get_by_role('spinbutton', name='Width %', exact=True)).to_have_value('90')
            await expect(crop_dialog.get_by_role('spinbutton', name='Height %', exact=True)).to_have_value('85')
            # Exact values make the applied output dimension check independent of fractional pointer pixels.
            for label, value in [('Left %', '10'), ('Top %', '10'), ('Width %', '80'), ('Height %', '80')]:
                await crop_dialog.get_by_role('spinbutton', name=label, exact=True).fill(value)
            await crop_dialog.get_by_role('button', name='Use selected area', exact=True).click()
            await expect(crop_dialog).to_have_count(0)
            await expect(preview).to_be_visible()
            await preview.evaluate('(image) => image.decode()')
            dimensions = await preview.evaluate('(image) => ({ width: image.naturalWidth, height: image.naturalHeight })')
            assert dimensions == {'width': 800, 'height': 520}, dimensions
            assert len(requests) == crop_request_count, 'Selecting or applying a crop must not send an analysis request'
            report['checks'].append('Visual crop dialog supports dragging and percentages, preserves crop dimensions, and applies without a provider request')
            await page.get_by_role('button', name='Stop sharing', exact=True).click()
            assert await page.evaluate('window.__aptitudeScreen.liveTracks()') == 0
            assert (await page.evaluate('window.__aptitudeScreen.calls()'))['microphone'] == 0
            report['checks'].append('Pause stops requests; unchanged recapture reuses exact image; Retry forces analysis; Stop releases tracks')

            await page.get_by_role('button', name='Clear captures and history', exact=True).click()
            await expect(page.get_by_role('heading', name='Start with the question.', exact=True)).to_be_visible()
            assert await page.get_by_alt_text('Question screenshot ready for analysis').count() == 0
            await expect(history_select).to_have_count(0)
            report['checks'].append('Clear removes retained captures and answers')

            # These are real product screens with explicit synthetic responses.
            # Switching mode must not send the image before the user's next action.
            state['number'] = 0
            await page.get_by_role('button', name='Try a practice question', exact=True).click()
            strategy = page.get_by_role('combobox', name='Analysis mode', exact=True)
            await expect(strategy).to_have_value('single')
            count = len(requests)
            await strategy.select_option('compare')
            await expect(strategy).to_have_value('compare')
            await expect(page.get_by_role('heading', name='Ready to compare this capture.', exact=True)).to_be_visible()
            await asyncio.sleep(.5)
            assert len(requests) == count, 'Selecting Compare models unexpectedly submitted a screenshot'
            await click_for_request(page.get_by_role('button', name='Analyze this capture', exact=True))
            comparison = page.get_by_role('region', name='Model comparison', exact=True)
            await expect(comparison.get_by_role('heading', name='Models agree', exact=True)).to_be_visible()
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            await expect(comparison.get_by_role('article')).to_have_count(2)
            assert requests[-1]['strategy'] == 'compare'
            report['checks'].append('Explicit comparison selection makes no call; two agreeing model answers support the visible recommendation')

            # A mode is part of history/cache identity. Looking at single mode
            # cannot accidentally reuse a comparison response or rewrite it.
            count = len(requests)
            await strategy.select_option('single')
            await asyncio.sleep(.2)
            assert len(requests) == count, 'Switching to Single model unexpectedly made a request'
            await click_for_request(page.get_by_role('button', name='Analyze this capture', exact=True))
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            await expect(comparison).to_have_count(0)
            assert requests[-1]['strategy'] == 'single'
            await expect(history_options).to_have_count(2)
            mode_history = await history_options.all_text_contents()
            assert any('Single model' in text for text in mode_history) and any('Compare models' in text for text in mode_history), mode_history
            count = len(requests)
            await strategy.select_option('compare')
            await page.get_by_role('button', name='Analyze this capture', exact=True).click()
            await expect(comparison.get_by_role('heading', name='Models agree', exact=True)).to_be_visible()
            await asyncio.sleep(.2)
            assert len(requests) == count, 'Returning to the same completed comparison should reuse only that strategy'
            report['checks'].append('Single and comparison analyses remain distinct in history and exact-image reuse')

            state['comparison'] = 'disagreement'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(comparison.get_by_role('heading', name='Models disagree', exact=True)).to_be_visible()
            assert await page.get_by_text('Suggested answer', exact=True).count() == 0
            await expect(comparison.get_by_role('article', name='anthropic:claude-sonnet-4-5', exact=True).locator('p').filter(has_text=re.compile(r'^B — 25%$'))).to_be_visible()
            await expect(comparison.get_by_role('article', name='openai:gpt-4.1', exact=True).locator('p').filter(has_text=re.compile(r'^A — 20%$'))).to_be_visible()
            await page.set_viewport_size({'width': 1440, 'height': 1000})
            if await page.evaluate('document.documentElement.classList.contains("lt-dark")'):
                await page.get_by_role('button', name='Switch to light mode', exact=True).click()
            await comparison.screenshot(path=str(OUT / 'aptitude-comparison-disagreement.png'))
            report['checks'].append('A one-to-one split withholds recommendation and exposes both explanations')

            state['comparison'] = 'evidence_mismatch'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(comparison.get_by_role('heading', name='Same answer, evidence needs review', exact=True)).to_be_visible()
            assert await page.get_by_text('Suggested answer', exact=True).count() == 0
            for model in ['anthropic:claude-sonnet-4-5', 'openai:gpt-4.1']:
                await expect(comparison.get_by_role('article', name=model, exact=True).locator('p').filter(has_text=re.compile(r'^B — 25%$'))).to_be_visible()
            report['checks'].append('Matching answer values with different source readings are labeled as evidence review, and no answer is promoted')

            state['comparison'] = 'insufficient'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(comparison.get_by_role('heading', name='Comparison incomplete', exact=True)).to_be_visible()
            assert await page.get_by_text('Suggested answer', exact=True).count() == 0
            await expect(comparison.get_by_text('Timed out', exact=True)).to_be_visible()
            report['checks'].append('One usable answer plus a timed-out model is incomplete and cannot publish a recommendation')

            state['comparison'] = 'majority'
            await click_for_request(page.get_by_role('button', name='Retry this capture', exact=True))
            await expect(comparison.get_by_role('heading', name='Majority agreement', exact=True)).to_be_visible()
            await expect(page.get_by_role('heading', name='B — 25%', exact=True)).to_be_visible()
            await expect(comparison.get_by_role('article')).to_have_count(3)
            await expect(comparison.get_by_role('article', name='openai:gpt-4.1-mini', exact=True).locator('p').filter(has_text=re.compile(r'^A — 20%$'))).to_be_visible()
            await expect(comparison.get_by_text('Sample model responses for this screen preview. No live provider calls or model latency benchmark.', exact=True)).to_be_visible()
            report['checks'].append('Two-to-one agreement is labeled as a majority; dissent and arithmetic-check limits remain visible')

            for theme in ['light', 'dark']:
                is_dark = await page.evaluate('document.documentElement.classList.contains("lt-dark")')
                if is_dark != (theme == 'dark'):
                    await page.get_by_role('button', name=f'Switch to {theme} mode', exact=True).click()
                await page.wait_for_function('(dark)=>document.documentElement.classList.contains("lt-dark") === dark', arg=theme == 'dark')
                for width in [375, 768, 1440]:
                    await page.set_viewport_size({'width': width, 'height': 1000})
                    await asyncio.sleep(.1)
                    assert await page.evaluate('document.documentElement.scrollWidth <= innerWidth+1'), f'Horizontal overflow {theme}/{width}'
                    await expect(page.get_by_role('button', name='Upload screenshot', exact=True)).to_be_visible()
                    report['layouts'].append({'theme': theme, 'width': width, 'passed': True})
                    if width in [375, 1440]:
                        await page.evaluate('window.scrollTo(0, 0)')
                        await page.screenshot(path=str(OUT / f'aptitude-{theme}-{width}.png'), full_page=True)
                        await comparison.screenshot(path=str(OUT / f'aptitude-comparison-{theme}-{width}.png'))
            report['checks'].append('Six light/dark responsive layouts without horizontal overflow')

            await page.get_by_role('button', name='Clear captures and history', exact=True).click()
            await expect(page.get_by_role('heading', name='Start with the question.', exact=True)).to_be_visible()
            assert await page.get_by_alt_text('Question screenshot ready for analysis').count() == 0
            await expect(history_select).to_have_count(0)
            await expect(comparison).to_have_count(0)
            report['checks'].append('Clear also removes multi-model candidates and comparison history')
            assert not report['browserErrors'], report['browserErrors']
            assert not report['stubErrors'], report['stubErrors']
            report['passed'] = True
        except Exception as error:
            report['passed'] = False
            report['failure'] = str(error)
            try:
                await page.evaluate('window.scrollTo(0, 0)')
                await page.screenshot(path=str(OUT / 'failure.png'), full_page=True)
            except PlaywrightError as screenshot_error:
                report['failureScreenshotError'] = str(screenshot_error)
            raise
        finally:
            report['requests'] = requests
            (OUT / 'browser-report.json').write_text(json.dumps(report, indent=2))
            await browser.close()
    print(json.dumps({'passed': report['passed'], 'checks': len(report['checks']), 'layouts': len(report['layouts']), 'liveModel': False}))


if __name__ == '__main__':
    asyncio.run(main())
