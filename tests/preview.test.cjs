const { test, before, after, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { readFile } = require('node:fs/promises');
const path = require('node:path');
const { chromium } = require('playwright');

const root = path.resolve(__dirname, '..');
const storageKey = 'waves-tech-design-study';
let server, browser, page, base;
let pageErrors;

before(async () => {
  server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    try {
      if (!file.startsWith(root + path.sep)) throw new Error('Outside preview');
      const body = await readFile(file);
      res.setHeader('Content-Type', { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' }[path.extname(file)] || 'application/octet-stream');
      res.end(body);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  browser = await chromium.launch({ channel: 'chrome', headless: true });
});

beforeEach(async () => {
  page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  page.setDefaultTimeout(6000);
  // Logic and color checks do not depend on the external font service.
  await page.route('https://fonts.googleapis.com/**', route => route.abort());
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
});

afterEach(async () => {
  await page.context().close();
  assert.deepEqual(pageErrors, [], 'No browser JavaScript errors');
});

after(async () => {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
});

async function startVisit() {
  await page.goto(base);
  await page.getByRole('button', { name: 'Open visit', exact: true }).click();
  await page.getByRole('button', { name: 'Start service', exact: true }).click();
}

async function confirmProduct(index, amount) {
  await page.locator(`button[data-action="product"][data-product="${index}"]`).click();
  await page.getByLabel('Actual amount used · fl oz').fill(amount);
  await page.getByRole('button', { name: 'Confirm applied', exact: true }).click();
}

async function addPhoto() {
  await page.getByRole('button', { name: 'Add photo', exact: true }).click();
  await page.getByRole('button', { name: 'Add sample photo', exact: true }).click();
}

async function storedVisit() {
  return page.evaluate(key => JSON.parse(sessionStorage.getItem(key)), storageKey);
}

test('actual areas require selection and validation names and focuses only missing entries', async () => {
  await startVisit();
  assert.equal(await page.locator('[data-action="area"][aria-pressed="true"]').count(), 0);
  await confirmProduct(0, '6.5');
  await confirmProduct(1, '16');
  await page.getByRole('button', { name: 'No new concerns', exact: true }).click();
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  assert.deepEqual(await page.locator('#sheet-content li').allTextContents(), ['Select the areas you treated.']);
  await page.getByRole('button', { name: 'Review missing details', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'treated-areas');
  await page.getByRole('button', { name: 'Front lawn', exact: true }).click();
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  assert.equal(await page.locator('#attestation').count(), 0);
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  assert.equal(await page.locator('#app h1').innerText(), 'Visit saved.');
  assert.deepEqual((await storedVisit()).areas, ['Front lawn']);
});

test('unfinished products and findings get their own validation destinations', async () => {
  await startVisit();
  await confirmProduct(0, '6.5');
  await page.getByRole('button', { name: 'Front lawn', exact: true }).click();
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  assert.deepEqual(await page.locator('#sheet-content li').allTextContents(), ['Confirm each actual product amount.', 'Record what you found.']);
  await page.getByRole('button', { name: 'Review missing details', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'confirm-product-1');
  await confirmProduct(1, '16');
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  assert.deepEqual(await page.locator('#sheet-content li').allTextContents(), ['Record what you found.']);
  await page.getByRole('button', { name: 'Review missing details', exact: true }).click();
  assert.equal(await page.evaluate(() => document.activeElement.id), 'visit-findings');
});

test('finished records remain read only through Tools, deep links and desktop navigation', async () => {
  await startVisit();
  await confirmProduct(0, '6.5');
  await confirmProduct(1, '16');
  await page.getByRole('button', { name: 'Front lawn', exact: true }).click();
  await page.getByRole('button', { name: 'Concern observed', exact: true }).click();
  await page.locator('#visit-notes').fill('Internal sample note: locked gate.');
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  const saved = await storedVisit();
  await page.getByRole('button', { name: 'Tools', exact: true }).click();
  await page.getByRole('button', { name: /Saved service record/ }).click();
  assert.equal(await page.locator('#app h1').innerText(), 'Saved service record.');
  assert.match(await page.locator('#app').innerText(), /6\.5 fl oz/);
  assert.equal(await page.locator('#app button[data-go="treatment"], #app [data-action="finish"], #visit-notes').count(), 0);
  await page.getByRole('button', { name: /Preview full report/ }).click();
  const report = await page.locator('#sheet-content').innerText();
  assert.match(report, /6\.5 fl oz/);
  assert.doesNotMatch(report, /Internal sample note|locked gate/);
  await page.locator('#close-sheet').click();
  for (const scene of ['visit', 'treatment', 'review']) {
    await page.goto(base + '?scene=' + scene);
    assert.equal(await page.locator('#app h1').innerText(), 'Saved service record.');
  }
  await page.setViewportSize({ width: 1440, height: 1060 });
  await page.locator('[data-scene="treatment"]').click();
  assert.equal(await page.locator('#app h1').innerText(), 'Saved service record.');
  assert.deepEqual(await storedVisit(), saved);
});

test('new photos remain pending without resetting uploaded photos, including reload and offline retry', async () => {
  await startVisit();
  await addPhoto();
  await addPhoto();
  await page.getByRole('button', { name: 'Simulate photo sync', exact: true }).click();
  await addPhoto();
  assert.deepEqual(await page.locator('.photo-slot span:last-child').allTextContents(), ['Synced', 'Synced', 'Pending']);
  await page.reload();
  await page.getByRole('button', { name: 'Resume service', exact: true }).click();
  assert.deepEqual(await page.locator('.photo-slot span:last-child').allTextContents(), ['Synced', 'Synced', 'Pending']);
  await page.getByRole('button', { name: 'More', exact: true }).click();
  await page.getByRole('button', { name: /Connection & saved work/ }).click();
  for (const tab of ['Tools', 'Messages', 'Today']) {
    await page.getByRole('button', { name: tab, exact: true }).click();
    assert.equal(await page.locator('.offline-banner').count(), 1);
  }
  await page.getByRole('button', { name: 'Resume service', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate photo sync', exact: true }).click();
  assert.deepEqual((await storedVisit()).photos, ['synced', 'synced', 'pending']);
  await page.getByRole('button', { name: 'Review and finish', exact: true }).click();
  assert.match(await page.locator('#app').innerText(), /2 photos synced · 1 waiting to upload/);
});

test('access notes refresh immediately and paused visits are labeled on Today', async () => {
  await startVisit();
  await page.locator('#visit-notes').fill('Existing sample note.');
  await page.getByRole('button', { name: 'Visit options', exact: true }).click();
  await page.getByRole('button', { name: 'Unable to access', exact: true }).click();
  await page.getByLabel('What prevented access?').fill('Sample gate locked.');
  await page.getByRole('button', { name: 'Save sample access note', exact: true }).click();
  assert.equal(await page.locator('#visit-notes').inputValue(), 'Existing sample note.\nSample gate locked.');
  await page.getByRole('button', { name: 'Visit options', exact: true }).click();
  await page.getByRole('button', { name: 'Pause visit', exact: true }).click();
  assert.match(await page.locator('.card-topline').innerText(), /VISIT PAUSED/);
  await page.getByRole('button', { name: 'Resume service', exact: true }).click();
  assert.match(await page.locator('.service-banner').innerText(), /Service in progress/);
});

test('earlier browser drafts preserve actuals and photos but require areas; saved records retain their areas', async () => {
  await page.goto(base);
  const old = { started: true, paused: false, finished: false, confirmed: [true, true], quantities: ['6.5', '16'], areas: ['Front lawn', 'Back lawn'], finding: 'No new concerns', notes: 'Existing sample draft.', photos: 2, synced: true, attested: true, offline: false };
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: old });
  await page.goto(base + '?scene=treatment');
  assert.equal(await page.locator('[data-action="area"][aria-pressed="true"]').count(), 0);
  assert.deepEqual(await page.locator('.photo-slot span:last-child').allTextContents(), ['Synced', 'Synced']);
  assert.equal(await page.locator('#visit-notes').inputValue(), old.notes);
  await page.getByRole('button', { name: 'Front lawn', exact: true }).click();
  const migrated = await storedVisit();
  assert.deepEqual(migrated.quantities, old.quantities);
  assert.equal('synced' in migrated, false);
  assert.equal('attested' in migrated, false);
  await page.evaluate(({ key, value }) => sessionStorage.setItem(key, JSON.stringify(value)), { key: storageKey, value: { ...old, finished: true } });
  await page.goto(base + '?scene=treatment');
  assert.equal(await page.locator('#app h1').innerText(), 'Saved service record.');
  assert.match(await page.locator('#app').innerText(), /Front lawn \+ Back lawn/);
  assert.match(await page.locator('#app').innerText(), /2 photos synced/);
});

test('a completion deep link cannot claim a new visit was saved', async () => {
  await page.goto(base + '?scene=success');
  assert.equal(await page.getByRole('heading', { name: 'Visit saved.', exact: true }).count(), 0);
  await page.getByRole('button', { name: 'Finish visit', exact: true }).click();
  assert.equal(await page.locator('#sheet-title').innerText(), 'Start the visit first');
});

test('field controls meet 44px targets and reported small text clears 4.5:1 contrast', async () => {
  const contrast = async selector => page.locator(selector).first().evaluate(element => {
    const channels = value => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = color => channels(color).map(value => value / 255).map(value => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
    let parent = element;
    while (getComputedStyle(parent).backgroundColor === 'rgba(0, 0, 0, 0)') parent = parent.parentElement;
    const foreground = luminance(getComputedStyle(element).color);
    const background = luminance(getComputedStyle(parent).backgroundColor);
    return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
  });
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1060 });
    for (const scene of ['today', 'visit', 'treatment', 'review', 'success']) {
      await page.goto(base + `?scene=${scene}&fixture=1`);
      const small = await page.locator('#app button, #app summary').evaluateAll(elements => elements.filter(element => {
        const box = element.getBoundingClientRect();
        return box.width < 44 || box.height < 44;
      }).map(element => ({ text: element.innerText, width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height })));
      assert.deepEqual(small, [], `${scene} control targets at ${width}`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `${scene} has no overflow at ${width}`);
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base);
  for (const selector of ['.service-line', '.bottom-nav button:not(.active)', '.text-button']) assert.ok(await contrast(selector) >= 4.5, selector);
  await page.setViewportSize({ width: 1440, height: 1060 });
  for (const selector of ['.journey button:not(.selected)>span:first-child', '.note-index', '.story-foot', '.detail-note']) assert.ok(await contrast(selector) >= 4.5, selector);
  await page.setViewportSize({ width: 390, height: 844 });
  await startVisit();
  await addPhoto();
  assert.ok(await contrast('.photo-slot') >= 4.5, 'photo status contrast');
  for (const width of [360, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 1060 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth), false, `No overflow at ${width}`);
  }
});
