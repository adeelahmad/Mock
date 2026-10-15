import { test, expect, type Page } from '@playwright/test';

// The canvas as a Meet add-on. The Add-ons SDK only runs inside Meet, so a stand-in
// `window.meet.addon` records what the app asks of Meet and plays the other participants.
const FAKE_SDK = (reason: string) => {
  const w = window as any;
  w.__meet = { started: [] as unknown[], ended: 0, broadcasts: [] as string[], delegate: null as any };
  const base = {
    getMeetingInfo: async () => ({ meetingId: 'm1', meetingCode: 'abc-defg-hij' }),
    getFrameOpenReason: async () => reason,
    getActivityStartingState: async () => ({}), setActivityStartingState: async () => {},
    on() {}, closeAddon: async () => {},
    startActivity: async (s: unknown) => { w.__meet.started.push(s); },
    endActivity: async () => { w.__meet.ended++; },
  };
  w.meet = { addon: {
    getFrameType: () => (location.search.includes('addon=side') ? 'SIDE_PANEL' : 'MAIN_STAGE'),
    createAddonSession: async ({ cloudProjectNumber }: { cloudProjectNumber: string }) => {
      w.__meet.project = cloudProjectNumber;
      return {
        createSidePanelClient: async () => ({ ...base, notifyMainStage: async () => {} }),
        createMainStageClient: async () => ({ ...base, notifySidePanel: async () => {}, loadSidePanel: async () => {}, unloadSidePanel: async () => {} }),
        createCoDoingClient: async (d: any) => { w.__meet.delegate = d; return { broadcastStateUpdate: (st: { bytes: Uint8Array }) => w.__meet.broadcasts.push(new TextDecoder().decode(st.bytes)) }; },
      };
    },
  } };
};

async function openAddon(page: Page, frame: 'side' | 'stage', reason = 'OPEN_ADDON') {
  await page.addInitScript(FAKE_SDK, reason);
  await page.goto(`/?repo=sample&meet_sdk=x&addon=${frame}&project=4242#/canvas`);
  await page.waitForSelector('.splash', { state: 'detached', timeout: 30_000 }).catch(() => {});
}

async function pickRightArea(page: Page) {
  const areas = page.getByRole('group', { name: 'Areas' }).getByRole('button');
  for (let i = 0; i < await areas.count(); i++) {
    const b = areas.nth(i);
    if (await b.isDisabled()) continue;
    await b.click();
    if (await page.getByRole('region', { name: 'Your answer' }).isVisible()) return;
  }
  throw new Error('no area opened the answer');
}

test('side panel: the canvas runs in Meet’s panel; Show everyone starts it on the main stage', async ({ page }) => {
  await openAddon(page, 'side');
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await expect(page.getByText('Question 1')).toBeVisible();
  await pickRightArea(page);
  await page.getByRole('button', { name: 'Show everyone' }).click();
  await expect(page.getByText('The canvas is on the main stage')).toBeVisible();
  const started = await page.evaluate(() => (window as any).__meet.started);
  expect(started[0].mainStageUrl).toMatch(/\?addon=stage&project=4242#\/canvas$/);
  expect(await page.evaluate(() => (window as any).__meet.project)).toBe('4242');
  await page.getByRole('button', { name: 'End it for everyone' }).click();
  await expect(page.getByText('Question 1')).toBeVisible();
  expect(await page.evaluate(() => (window as any).__meet.ended)).toBe(1);
});

test('main stage: the driver shares the canvas with the call', async ({ page }) => {
  await openAddon(page, 'stage', 'START_ACTIVITY');
  await expect(page.getByText('Question 1')).toBeVisible();
  await pickRightArea(page);
  await expect.poll(async () => {
    const all: string[] = await page.evaluate(() => (window as any).__meet.broadcasts);
    return all.length ? JSON.parse(all[all.length - 1]).s.phase : null;
  }).toBe('answer');
});

test('main stage: someone who joins watches the shared canvas', async ({ page }) => {
  await openAddon(page, 'stage', 'JOIN_ACTIVITY');
  await expect(page.getByText('Watching the canvas')).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!(window as any).__meet.delegate)).toBe(true);
  await page.evaluate(() => {
    const s = { questionId: 'x', questionText: 'Shared from the driver', phase: 'answer', misses: [], areaId: null, role: 'primary', phrases: [{ id: 'p1', text: 'I owned it.', mark: 'match', note: '', by: 'ai' }], partial: '', notes: [], strokes: [], chat: [], done: 0 };
    (window as any).__meet.delegate.onCoDoingStateChanged({ bytes: new TextEncoder().encode(JSON.stringify({ v: 1, s })) });
  });
  await expect(page.getByText('Shared from the driver')).toBeVisible();
  await expect(page.locator('[data-mark="match"]')).toHaveText(/I owned it\./);
  await expect(page.getByRole('textbox', { name: 'Message the AI' })).toHaveCount(0);

  // Like Miro: everyone edits the board. A viewer's sticky note goes out to the call, marked as not the driver's.
  await page.getByRole('button', { name: 'Sticky note' }).click();
  const board = page.getByRole('img', { name: 'Whiteboard drawing' });
  await board.scrollIntoViewIfNeeded();
  const box = (await board.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByTestId('wb-note')).toHaveCount(1);
  await expect.poll(async () => {
    const all: string[] = await page.evaluate(() => (window as any).__meet.broadcasts);
    const last = all.length ? JSON.parse(all[all.length - 1]) : null;
    return last ? [last.d, last.s.notes.length, last.s.questionText] : null;
  }).toEqual([false, 1, 'Shared from the driver']);
  // The driver's next state keeps the viewer's note.
  await page.evaluate(() => {
    const s = { questionId: 'x', questionText: 'Next from the driver', phase: 'pick', misses: [], areaId: null, role: null, phrases: [], partial: '', notes: [], strokes: [[]].slice(1), shapes: [], gone: [], timer: { end: null, t: 0 }, chat: [], done: 1 };
    (window as any).__meet.delegate.onCoDoingStateChanged({ bytes: new TextEncoder().encode(JSON.stringify({ v: 1, d: true, s })) });
  });
  await expect(page.getByText('Next from the driver')).toBeVisible();
  await expect(page.getByTestId('wb-note')).toHaveCount(1);

  // Following: the host brings everyone to their view; the viewer follows until they stop.
  await page.evaluate(() => {
    const s = { questionId: 'x', questionText: 'Next from the driver', phase: 'pick', misses: [], areaId: null, role: null, phrases: [], partial: '', notes: [], strokes: [], shapes: [], gone: [], timer: { end: null, t: 0 }, lead: { who: 'host1', name: 'the host', zoom: 1.5, x: 0.5, y: 0.5, t: Date.now() }, chat: [], done: 1 };
    (window as any).__meet.delegate.onCoDoingStateChanged({ bytes: new TextEncoder().encode(JSON.stringify({ v: 1, d: true, s })) });
  });
  await expect(page.getByText('Following the host')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Fit the board' })).toHaveText('150%');
  await page.getByRole('button', { name: 'Stop following' }).click();
  await expect(page.getByText('The host is leading')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Follow', exact: true })).toBeVisible();
});

test('main stage: Bring everyone here leads the call', async ({ page }) => {
  await openAddon(page, 'stage', 'START_ACTIVITY');
  await expect(page.getByText('Question 1')).toBeVisible();
  await page.getByRole('button', { name: 'Bring everyone here' }).click();
  await expect(page.getByText('Everyone is following you')).toBeVisible();
  await expect.poll(async () => {
    const all: string[] = await page.evaluate(() => (window as any).__meet.broadcasts);
    const last = all.length ? JSON.parse(all[all.length - 1]) : null;
    return last ? [last.s.lead.name, last.s.lead.zoom] : null;
  }).toEqual(['the host', 1]);
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await expect.poll(async () => {
    const all: string[] = await page.evaluate(() => (window as any).__meet.broadcasts);
    return all.length ? JSON.parse(all[all.length - 1]).s.lead.zoom : null;
  }).toBe(1.25);
  await page.getByRole('button', { name: 'Stop leading' }).click();
  await expect(page.getByText('Everyone is following you')).toHaveCount(0);
});

test('main stage: a video everyone watches together', async ({ page }) => {
  // YouTube stands in: a blank page at the embed address.
  await page.route('https://www.youtube-nocookie.com/**', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>player</title>' }));
  await openAddon(page, 'stage', 'START_ACTIVITY');
  await expect(page.getByText('Question 1')).toBeVisible();
  await page.getByRole('button', { name: 'Video' }).click();
  const link = page.getByLabel(/^A YouTube link/);
  await link.fill('https://example.com/page');
  await expect(page.getByText(/Use a YouTube link, a video file/)).toBeVisible();
  await link.fill('rtsp://cam.local/stream');
  await expect(page.getByText(/Browsers can’t play RTSP/)).toBeVisible();
  await link.fill('https://youtu.be/dQw4w9WgXcQ');
  await page.getByRole('button', { name: 'Show the video' }).click();
  const frame = page.getByTitle('Shared video');
  await expect(frame).toHaveAttribute('src', /youtube-nocookie\.com\/embed\/dQw4w9WgXcQ/);
  await expect(page.getByText('Paused for everyone')).toBeVisible();
  await page.getByRole('button', { name: 'Play for everyone' }).click();
  await expect(page.getByText('Playing for everyone')).toBeVisible();
  await expect.poll(async () => {
    const all: string[] = await page.evaluate(() => (window as any).__meet.broadcasts);
    const v = all.length ? JSON.parse(all[all.length - 1]).s.video : null;
    return v ? [v.url, v.playing] : null;
  }).toEqual(['https://youtu.be/dQw4w9WgXcQ', true]);
  await page.getByRole('button', { name: 'Remove' }).click();
  await expect(frame).toHaveCount(0);

  // A live HLS stream plays in a video element; an MJPEG camera is an image.
  await page.route('https://streams.example.com/**', (r) => r.fulfill({ status: 404, body: '' }));
  await page.getByRole('button', { name: 'Video' }).click();
  await link.fill('https://streams.example.com/live/index.m3u8');
  await page.getByRole('button', { name: 'Show the video' }).click();
  await expect(page.locator('.wb-video-frame video')).toHaveCount(1);
  await page.getByRole('button', { name: 'Remove' }).click();
  await page.getByRole('button', { name: 'Video' }).click();
  await link.fill('https://streams.example.com/cam/mjpeg');
  await page.getByRole('button', { name: 'Show the video' }).click();
  await expect(page.getByRole('img', { name: 'Live camera stream' })).toBeVisible();
  await expect(page.getByText('Live for everyone')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play for everyone' })).toHaveCount(0);
});
