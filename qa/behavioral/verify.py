"""Behavioral UI integration against a local PREVIEW_NO_AUTH=1 Next dev server.

Run with the pinned playwright==1.55.0 runtime:
  BEHAVIORAL_QA_URL=http://127.0.0.1:3002 python3 qa/behavioral/verify.py

Every answer/classifier response is an authored fixture. Expected app start/stop
diagnostics receive a validated local receipt; all other browser API requests are
blocked, so this journey cannot start paid model, embedding, search or
transcription work. The real invalid-snapshot route is probed before browser
interception; it must reject the body with 400 under the dev-only owner bypass.
This checks application wiring and persistence, never model answer accuracy.
"""

import asyncio
import copy
import importlib.metadata
import json
import os
import pathlib
import re
import time
from urllib.parse import urlparse

from playwright.async_api import Error as PlaywrightError, async_playwright, expect


BASE = os.environ.get('BEHAVIORAL_QA_URL', 'http://127.0.0.1:3002').rstrip('/')
PARSED = urlparse(BASE)
assert (PARSED.scheme == 'http' and PARSED.hostname in ('localhost', '127.0.0.1')
        and PARSED.port is not None and 0 < PARSED.port < 65536
        and not PARSED.username and not PARSED.password
        and PARSED.path == '' and not PARSED.query and not PARSED.fragment), 'Behavioral QA accepts only an explicit local HTTP origin with a port.'
OUT = pathlib.Path('qa-results/behavioral')

COMPANY = 'Elm Labs QA'
ROLE = 'Platform engineer'
EXPECTATIONS = 'Explain careful measurement, collaborative delivery and accountable decisions.'
WORK_STYLE = 'I prepare a clear plan, invite feedback and ask for help when a risk is unclear.'
SOURCE = 'Original QA project notes: I owned retry validation in a queue migration. A teammate owned the dashboard. No improvement percentage was supplied in these source notes.'
FIRST_QUESTION = 'Tell me about the queue migration and what improved.'
FIRST_DRAFT = 'An unconfirmed QA draft suggests that I reduced duplicate work by 40%.'
ACTUAL = 'I measured a 14% reduction in duplicate work against the original four-week baseline.'
CORRECTION = 'Correction: the 14% reduction used a six-week baseline, not the four-week baseline I initially reported.'


def records_of(snapshot, kind):
    return [record for record in snapshot['records'] if record['kind'] == kind]


def assert_provenance(snapshot):
    actual = [record for record in records_of(snapshot, 'confirmed_answer') if record['text'] == ACTUAL]
    drafts = [record for record in records_of(snapshot, 'ai_suggestion') if record['text'] == FIRST_DRAFT]
    assert len(actual) == 1 and len(drafts) == 1, 'The actual 14% answer and unconfirmed 40% draft must remain separate records.'
    assert all('40%' not in record['text'] for record in records_of(snapshot, 'confirmed_answer')), 'An AI metric became a confirmed answer.'
    assert drafts[0]['contextProfile']['company'] == COMPANY
    assert isinstance(drafts[0]['contextRevision'], int)
    assert any(SOURCE in record['text'] for record in records_of(snapshot, 'source_context')), 'Original source evidence was dropped.'
    assert snapshot['profile']['company'] == COMPANY
    assert snapshot['profile']['selfDescription'] == WORK_STYLE
    assert snapshot['coverage']['includedRecords'] == len(snapshot['records'])
    assert snapshot['coverage']['complete'] is True
    return actual[0], drafts[0]


def assert_lifecycle_diagnostics(body):
    assert isinstance(body, dict) and set(body) == {'events'}, 'Unexpected diagnostics batch fields.'
    events = body['events']
    assert isinstance(events, list) and 1 <= len(events) <= 25, 'Diagnostics batch must contain 1–25 events.'
    assert len(json.dumps(body).encode('utf-8')) <= 32_000, 'Diagnostics batch exceeds the route limit.'
    fields = {'v', 'sessionId', 'operationId', 'seq', 'at', 'stage', 'event', 'attrs'}
    uuid = r'[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}'
    for event in events:
        assert isinstance(event, dict) and set(event) == fields and type(event['v']) is int and event['v'] == 1, 'Invalid diagnostics event schema.'
        assert event['stage'] == 'app' and event['event'] in ('start', 'stop'), f'Unexpected diagnostics stage/event: {event["stage"]}/{event["event"]}'
        assert all(isinstance(event[key], str) and re.fullmatch(uuid, event[key]) for key in ('sessionId', 'operationId')), 'Invalid diagnostics identity.'
        assert type(event['seq']) is int and 1 <= event['seq'] <= 10_000_000, 'Invalid diagnostics sequence.'
        assert type(event['at']) is int and time.time() * 1000 - 86_400_000 <= event['at'] <= time.time() * 1000 + 300_000, 'Invalid diagnostics event time.'
        attrs = event['attrs']
        assert isinstance(attrs, dict), 'Invalid diagnostics metadata.'
        if event['event'] == 'start':
            assert set(attrs) <= {'runtime', 'release'} and attrs.get('runtime') == 'web', 'Unexpected app-start metadata.'
            if 'release' in attrs:
                assert isinstance(attrs['release'], str) and re.fullmatch(r'[a-fA-F0-9]{7,40}', attrs['release']), 'Invalid diagnostics release.'
        else:
            assert attrs == {}, 'Unexpected app-stop metadata.'
    return len(events)


async def main():
    runtime_version = importlib.metadata.version('playwright')
    assert runtime_version == '1.55.0', 'Use the pinned playwright==1.55.0 runtime.'
    OUT.mkdir(parents=True, exist_ok=True)
    report = {'kind': 'behavioral-browser-integration', 'base': BASE, 'liveModel': False,
              'playwrightVersion': runtime_version,
              'previewOwner': True, 'persistenceTested': False, 'checks': [], 'layouts': [],
              'console': [], 'browserErrors': [], 'stubErrors': [], 'blockedApiRequests': [],
              'diagnosticBatches': [], 'diagnosticsFixture': 'Only bounded app/start and app/stop metadata receives a local count receipt; error/stall and every other stage/event fail.'}
    requests = []
    state = {'reply': FIRST_DRAFT}

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(executable_path=os.environ.get('CHROMIUM_PATH') or None, args=['--no-sandbox'])
        context = await browser.new_context(viewport={'width': 1280, 'height': 1000}, accept_downloads=True, service_workers='block')
        page = await context.new_page()
        page.set_default_timeout(15000)
        expect.set_options(timeout=15000)
        page.on('pageerror', lambda error: report['browserErrors'].append(str(error)))
        page.on('console', lambda message: report['console'].append({'type': message.type, 'text': message.text, 'location': message.location}))

        async def serve_api(route):
            path = urlparse(route.request.url).path
            try:
                assert urlparse(route.request.url).netloc == PARSED.netloc, 'Unexpected non-local API request.'
                if path == '/api/copilot/answer':
                    assert route.request.method == 'POST'
                    body = route.request.post_data_json
                    assert isinstance(body, dict) and body.get('mode') == 'behavioral'
                    assert isinstance(body.get('question'), str) and body['question'].strip()
                    snapshot = body.get('behavioralSession')
                    assert isinstance(snapshot, dict) and snapshot['version'] == 1
                    assert isinstance(snapshot['records'], list) and body.get('history') == []
                    assert not body.get('image'), 'This typed behavioral journey must not capture a screen.'
                    requests.append(copy.deepcopy(body))
                    await route.fulfill(status=200, content_type='text/plain; charset=utf-8', body=state['reply'], headers={'Cache-Control': 'no-store'})
                elif path == '/api/copilot/classify':
                    await route.fulfill(status=200, json={'result': {'isQuestion': True, 'mode': 'behavioral', 'needsWeb': False, 'confidence': 1}})
                elif route.request.url == BASE + '/api/diagnostics' and route.request.method == 'POST':
                    # Reload flushes app lifecycle metadata. Errors and unrelated
                    # stages must fail this fixture instead of receiving a receipt.
                    assert route.request.headers.get('content-type', '').startswith('application/json'), 'Diagnostics must use JSON.'
                    body = route.request.post_data_json
                    accepted = assert_lifecycle_diagnostics(body)
                    report['diagnosticBatches'].append(copy.deepcopy(body))
                    await route.fulfill(status=200, json={'accepted': accepted}, headers={'Cache-Control': 'no-store'})
                else:
                    report['blockedApiRequests'].append({'path': path, 'method': route.request.method})
                    await route.fulfill(status=403, json={'error': 'Unexpected API request blocked by the local behavioral QA harness.'})
            except Exception as error:
                report['stubErrors'].append(str(error))
                await route.fulfill(status=500, json={'error': 'Synthetic QA fixture assertion failed.'})

        async def wait_for_requests(count):
            deadline = time.monotonic() + 15
            while len(requests) < count and time.monotonic() < deadline:
                await asyncio.sleep(.05)
            assert len(requests) == count, f'Expected {count} intercepted answers, received {len(requests)}; fixture errors: {report["stubErrors"]}'

        async def details(summary, opened=True):
            if await summary.evaluate('(element) => element.parentElement.open') != opened:
                await summary.click()

        async def ask(question, reply):
            state['reply'] = reply
            await page.get_by_role('textbox', name='Your question', exact=True).fill(question)
            expected = len(requests) + 1
            await page.get_by_role('button', name='Send question', exact=True).click()
            await wait_for_requests(expected)
            await expect(page.get_by_role('button', name='Send question', exact=True)).to_be_visible()
            await expect(page.get_by_role('button', name='Stop generating', exact=True)).to_have_count(0)
            return requests[-1]['behavioralSession']

        async def export_round(filename):
            panel = page.get_by_role('region', name='Behavioral round context', exact=True)
            await details(panel.locator('summary').filter(has_text='Round history and controls'))
            async with page.expect_download() as download_info:
                await panel.get_by_role('button', name='Export round', exact=True).click()
            download = await download_info.value
            assert download.suggested_filename.startswith('behavioral-round-') and download.suggested_filename.endswith('.json')
            path = OUT / filename
            await download.save_as(str(path))
            data = json.loads(path.read_text())
            assert 'unconfirmed drafts' in data['provenance']
            assert 'do not establish external submission' in data['provenance']
            assert 'No candidate fact is independently verified' in data['provenance']
            assert data['version'] == 1 and isinstance(data['round']['records'], list)
            return data

        try:
            # The deliberately malformed snapshot is rejected before model/key
            # selection, even though the question itself is nonempty.
            probe = await page.request.post(BASE + '/api/copilot/answer', data={
                'mode': 'behavioral', 'question': 'Reject this invalid context before any provider work.', 'behavioralSession': {},
            })
            assert probe.status == 400, f'Expected real invalid-snapshot HTTP 400 under PREVIEW_NO_AUTH=1; received {probe.status}. Use a dev server with the preview owner bypass.'
            report['checks'].append('Real local answer API rejects an invalid behavioral snapshot before any provider request')

            # Install the complete API guard before loading application code.
            await context.route('**/api/**', serve_api)
            await page.goto(BASE + '/copilot?mode=behavioral', wait_until='networkidle', timeout=60000)
            await expect(page.get_by_role('heading', name='AI workspace', exact=True)).to_be_visible()
            panel = page.get_by_role('region', name='Behavioral round context', exact=True)
            await expect(panel).to_be_visible()
            await expect(panel.get_by_role('button', name='Record my answer', exact=True)).to_be_enabled()
            await expect(panel.get_by_text('Saved for this account in this tab.', exact=False)).to_be_visible()

            profile_summary = panel.locator('summary').filter(has_text='Company, role and your work style')
            await details(profile_summary)
            await panel.get_by_role('textbox', name='Company', exact=True).fill(COMPANY)
            await panel.get_by_role('textbox', name='Target role', exact=True).fill(ROLE)
            await panel.get_by_role('textbox', name='Company and role expectations', exact=True).fill(EXPECTATIONS)
            await panel.get_by_role('textbox', name='Your actual work style and facts', exact=True).fill(WORK_STYLE)
            await panel.get_by_role('button', name='Save behavioral context', exact=True).click()
            await expect(panel.get_by_text('Behavioral context updated for the next answer.', exact=True)).to_be_visible()
            await details(profile_summary, False)

            await page.get_by_role('button', name='Your context', exact=True).click()
            await page.get_by_role('textbox', name='Resume and background', exact=True).fill(SOURCE)
            await page.get_by_role('textbox', name='Job description', exact=True).fill(f'{COMPANY} seeks a {ROLE} who explains risks and measurements honestly.')
            await page.get_by_role('button', name='Close context editor', exact=True).click()
            assert requests == [], 'Editing context must not generate an answer.'
            first = await ask(FIRST_QUESTION, FIRST_DRAFT)
            assert first['profile']['company'] == COMPANY and first['profile']['role'] == ROLE
            assert first['coverage']['totalConfirmedRecords'] == 0
            assert not records_of(first, 'ai_suggestion')
            original_round = first['roundId']

            await panel.get_by_role('button', name='Record my answer', exact=True).click()
            await panel.get_by_role('textbox', name='Question', exact=True).fill(FIRST_QUESTION)
            await panel.get_by_role('textbox', name='Your actual answer or selected option text', exact=True).fill(ACTUAL)
            await panel.get_by_role('button', name='Save actual answer', exact=True).click()
            await expect(panel.get_by_text('Your answer is recorded and will ground the next question.', exact=True)).to_be_visible()
            second = await ask('How was the improvement measured?', 'QA follow-up: retain the user-reported 14% and its stated baseline.')
            actual, draft = assert_provenance(second)
            assert actual['id'] != draft['id']
            report['checks'].append('Visible company/source forms and explicit actual-answer form keep 14% separate from the unconfirmed 40% AI suggestion')

            # Each request sees earlier completions, not its own response. Eight
            # requests produce nine records in the final request: seven previous
            # suggestions, one original-source record and one actual answer.
            for index in range(3, 9):
                snapshot = await ask(f'Follow-up {index}: what did you personally validate in that project?', f'Authored QA follow-up {index}: keep the supplied ownership and measurement.')
                assert_provenance(snapshot)
            assert len(requests) == 8 and len(requests[-1]['behavioralSession']['records']) > 8, 'The long-round fixture must send eight questions and more than eight retained records.'
            report['checks'].append('Eight real UI answer requests retain the early actual answer and original source beyond the former four-pair history window')

            await details(panel.locator('summary').filter(has_text='Round history and controls'))
            actual_row = panel.locator('li').filter(has=page.get_by_text('Your recorded answer', exact=True)).filter(has_text=ACTUAL)
            await actual_row.get_by_role('button', name='Correct this', exact=True).click()
            await panel.get_by_role('textbox', name='Corrected answer and what changed', exact=True).fill(CORRECTION)
            await panel.get_by_role('button', name='Save correction', exact=True).click()
            corrected = await ask('What is the corrected baseline?', 'Authored QA response: the explicit correction identifies a six-week baseline.')
            actual, _ = assert_provenance(corrected)
            corrections = records_of(corrected, 'correction')
            assert len(corrections) == 1 and corrections[0]['supersedes'] == actual['id'] and corrections[0]['text'] == CORRECTION
            report['checks'].append('A correction entered through the UI preserves the original answer and references it explicitly')

            before_reload = len(requests)
            await page.reload(wait_until='networkidle')
            panel = page.get_by_role('region', name='Behavioral round context', exact=True)
            await expect(panel.get_by_role('button', name='Record my answer', exact=True)).to_be_enabled()
            assert len(requests) == before_reload, 'Reloading saved context must not generate another answer.'
            await details(panel.locator('summary').filter(has_text='Company, role and your work style'))
            await expect(panel.get_by_role('textbox', name='Company', exact=True)).to_have_value(COMPANY)
            await expect(panel.get_by_role('textbox', name='Your actual work style and facts', exact=True)).to_have_value(WORK_STYLE)
            exported = await export_round('behavioral-round-export.json')
            assert exported['round']['id'] == original_round
            assert exported['round']['profile'] == corrected['profile']
            retained = exported['round']['records']
            assert any(record['kind'] == 'confirmed_answer' and record['text'] == ACTUAL for record in retained)
            assert any(record['kind'] == 'ai_suggestion' and record['text'] == FIRST_DRAFT for record in retained)
            assert any(record['kind'] == 'correction' and record['text'] == CORRECTION for record in retained)
            assert len(retained) == len(corrected['records']) + 1
            report['persistenceTested'] = True
            report['checks'].append('Same-tab reload and UI export restore the complete account-scoped round and explicitly disclaim external submission or verified facts')

            await details(panel.locator('summary').filter(has_text='Round history and controls'), False)
            await panel.get_by_role('button', name='Record my answer', exact=True).click()
            for width in (390, 768, 1280):
                await page.set_viewport_size({'width': width, 'height': 1000})
                await page.evaluate('document.fonts.ready')
                await page.wait_for_timeout(100)
                dimensions = await page.evaluate('''() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth,
                  overflowing: [...document.querySelectorAll('body *')].flatMap(element => {
                    const r = element.getBoundingClientRect();
                    return r.width && r.right > innerWidth + 1 ? [{tag: element.tagName, className: String(element.className), right: Math.round(r.right)}] : [];
                  }).slice(-15) })''')
                assert dimensions['document'] <= dimensions['viewport'] + 1, f'Horizontal overflow at {width}px: {dimensions}'
                await expect(panel.get_by_role('textbox', name='Company', exact=True)).to_be_visible()
                await expect(panel.get_by_role('textbox', name='Your actual answer or selected option text', exact=True)).to_be_visible()
                await page.evaluate('window.scrollTo(0, 0)')
                await page.screenshot(path=str(OUT / f'behavioral-{width}.png'), full_page=True)
                report['layouts'].append({'width': width, 'height': 1000, 'horizontalOverflow': False})
            await panel.get_by_role('button', name='Cancel', exact=True).click()
            report['checks'].append('Mobile 390px, tablet 768px and desktop 1280px profile/actual-answer forms fit without horizontal overflow')

            await details(panel.locator('summary').filter(has_text='Round history and controls'))
            await panel.get_by_role('button', name='New behavioral round', exact=True).click()
            await expect(panel.get_by_text('0 recorded answers · 0 AI suggestions', exact=True)).to_be_visible()
            await expect(panel.get_by_role('textbox', name='Company', exact=True)).to_have_value(COMPANY)
            fresh = await ask('A fresh round: describe your approach to collaboration.', 'Authored QA fresh-round response using the retained profile only.')
            assert fresh['roundId'] != original_round and fresh['profile'] == corrected['profile']
            assert not records_of(fresh, 'confirmed_answer') and not records_of(fresh, 'correction') and not records_of(fresh, 'ai_suggestion')
            assert all(record['kind'] == 'source_context' for record in fresh['records'])
            assert not any(ACTUAL in record['text'] or FIRST_DRAFT in record['text'] or CORRECTION in record['text'] for record in fresh['records'])
            report['checks'].append('New round preserves company/work style, clears prior actual answers/corrections/suggestions, and sends a fresh round identity')

            assert not report['browserErrors'], report['browserErrors']
            assert not report['stubErrors'], report['stubErrors']
            assert not report['blockedApiRequests'], report['blockedApiRequests']
            console_errors = [message for message in report['console'] if message['type'] == 'error']
            assert not console_errors, console_errors
            report['passed'] = True
        except Exception as error:
            report['passed'] = False
            report['failure'] = str(error)
            try:
                await page.screenshot(path=str(OUT / 'failure.png'), full_page=True)
            except PlaywrightError as screenshot_error:
                report['failureScreenshotError'] = str(screenshot_error)
            raise
        finally:
            report['requests'] = requests
            (OUT / 'browser-report.json').write_text(json.dumps(report, indent=2))
            await browser.close()
    print(json.dumps({'passed': report['passed'], 'checks': len(report['checks']), 'layouts': len(report['layouts']),
                      'interceptedAnswers': len(requests), 'diagnosticBatches': len(report['diagnosticBatches']),
                      'liveModel': False, 'persistenceTested': report['persistenceTested']}))


if __name__ == '__main__':
    asyncio.run(main())
