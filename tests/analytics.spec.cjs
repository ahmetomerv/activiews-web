const { test, expect } = require('@playwright/test');
const KEY = 'activiews.umami-consent.v1';
let tracker;
test.beforeAll(async () => {
  // Fetch code only. Every browser request to the analytics host is intercepted below.
  const response = await fetch('https://analytics.ahmeto.com/script.js');
  if (!response.ok) throw new Error('Unable to fetch the hosted tracker');
  tracker = await response.text();
});
async function intercept(context) {
  const requests = [];
  await context.route('https://analytics.ahmeto.com/**', async route => {
    requests.push({ url: route.request().url(), body: route.request().postDataJSON() });
    if (route.request().url().endsWith('/script.js')) {
      await route.fulfill({ contentType: 'text/javascript', body: tracker });
    } else {
      await route.fulfill({ contentType: 'application/json', body: '{}' });
    }
  });
  return requests;
}
const views = requests => requests.filter(r => r.body);
const settle = page => page.waitForTimeout(450); // Covers delayed SDK navigation sends.
test('first visit, rejection, reload and footer keyboard controls', async ({ page, context }) => {
  const requests = await intercept(context);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeVisible();
  await settle(page);
  expect(requests).toEqual([]);
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.reload();
  await expect(page.locator('#analytics-banner')).toBeHidden();
  await page.goto('/privacy.html');
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Decline', exact: true })).toBeFocused();
  await page.keyboard.press('Enter');
  await settle(page);
  expect(requests).toEqual([]);
});
test('acceptance, clean pageviews, SPA navigation, withdrawal and reacceptance', async ({ page, context }) => {
  const requests = await intercept(context);
  await page.goto('/?private=secret#private');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(1);
  expect(views(requests)[0].body.payload.url).toBe('/');
  await page.evaluate(() => history.pushState({}, '', '/contact.html?email=secret#secret'));
  await expect.poll(() => views(requests).length).toBe(2);
  expect(views(requests)[1].body.payload.url).toBe('/contact.html');
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.evaluate(() => history.pushState({}, '', '/terms.html?secret=yes#secret'));
  await settle(page);
  expect(views(requests)).toHaveLength(2);
  await page.reload();
  await settle(page);
  expect(views(requests)).toHaveLength(2);
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(3);
  await page.goto('/privacy.html?secret=yes#secret');
  await expect.poll(() => views(requests).length).toBe(4);
  for (const { body } of views(requests)) {
    expect(body.type).toBe('event');
    expect(body.payload).not.toHaveProperty('name');
    expect(body.payload).not.toHaveProperty('id');
    expect(body.payload.url).not.toMatch(/[?#]/);
    expect(body.payload.referrer).not.toMatch(/[?#]/);
  }
});
test('returning acceptance and cross-tab withdrawal/acceptance', async ({ page, context }) => {
  const requests = await intercept(context);
  await context.addInitScript(key => localStorage.setItem(key, 'accepted'), KEY);
  await page.goto('/');
  await expect.poll(() => views(requests).length).toBe(1);
  const other = await context.newPage();
  await other.goto('/contact.html');
  await expect.poll(() => views(requests).length).toBe(2);
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await settle(other);
  await other.evaluate(() => history.pushState({}, '', '/terms.html'));
  await settle(other);
  expect(views(requests)).toHaveLength(2);
  await other.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await other.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(4);
});
test('unavailable storage never enables tracking', async ({ page, context }) => {
  const requests = await intercept(context);
  await context.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('Blocked'); } });
    Object.defineProperty(window, 'sessionStorage', { get() { throw new Error('Blocked'); } });
  });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await settle(page);
  expect(requests).toEqual([]);
  expect(errors).toEqual([]);
  await expect(page.getByRole('status')).toContainText('could not be saved');
});
test('failed withdrawal write blocks current document, navigation and other tabs', async ({ page, context }) => {
  const requests = await intercept(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(1);
  const other = await context.newPage();
  await other.goto('/contact.html');
  await expect.poll(() => views(requests).length).toBe(2);
  await page.evaluate(() => { Storage.prototype.setItem = () => { throw new Error('Full'); }; });
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('could not be saved');
  await settle(other);
  for (const tab of [page, other]) {
    await tab.evaluate(() => history.pushState({}, '', '/terms.html?secret=x#x'));
  }
  await settle(page);
  expect(views(requests)).toHaveLength(2);
});
test('mobile and desktop banner fit, with equal accessible buttons', async ({ page, context }) => {
  await intercept(context);
  for (const width of [320, 390, 1440]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/');
    const allow = await page.getByRole('button', { name: 'Allow analytics', exact: true }).boundingBox();
    const decline = await page.getByRole('button', { name: 'Decline', exact: true }).boundingBox();
    expect(allow.width).toBe(decline.width);
    expect(allow.height).toBe(decline.height);
    expect(allow.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`banner-${width}.png`) });
  }
});
test('acceptance survives reload and only pageviews can pass the send gate', async ({ page, context }) => {
  const requests = await intercept(context);
  await page.goto('/contact.html?private=yes#private');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(1);
  await page.reload();
  await expect.poll(() => views(requests).length).toBe(2);
  await page.evaluate(async () => {
    await umami.track('unwanted-event');
    await umami.identify('unwanted-id');
  });
  await settle(page);
  expect(views(requests)).toHaveLength(2);
  await page.evaluate(() => localStorage.clear());
  await page.evaluate(() => history.pushState({}, '', '/terms.html'));
  await settle(page);
  expect(views(requests)).toHaveLength(2);
});
test('withdrawal before a delayed SDK loads cannot send a pageview', async ({ page, context }) => {
  let release;
  const ready = new Promise(resolve => { release = resolve; });
  const requests = [];
  await context.route('https://analytics.ahmeto.com/**', async route => {
    requests.push(route.request().url());
    if (route.request().url().endsWith('/script.js')) {
      await ready;
      await route.fulfill({ contentType: 'text/javascript', body: tracker });
    } else await route.fulfill({ contentType: 'application/json', body: '{}' });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => requests.length).toBe(1);
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  release();
  await page.waitForFunction(() => !!window.umami);
  await page.evaluate(() => history.pushState({}, '', '/contact.html'));
  await settle(page);
  expect(requests).toHaveLength(1);
});
test('failed local-storage withdrawal uses session block across full navigation', async ({ page, context }) => {
  const requests = await intercept(context);
  await page.goto('/');
  await page.getByRole('button', { name: 'Allow analytics', exact: true }).click();
  await expect.poll(() => views(requests).length).toBe(1);
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...args) {
      if (this === localStorage) throw new Error('Quota');
      return original.apply(this, args);
    };
  });
  await page.getByRole('button', { name: 'Analytics preferences', exact: true }).click();
  await page.getByRole('button', { name: 'Decline', exact: true }).click();
  await page.goto('/contact.html');
  await page.reload();
  await settle(page);
  expect(views(requests)).toHaveLength(1);
});
test('unknown or legacy preferences do not grant consent', async ({ page, context }) => {
  const requests = await intercept(context);
  await context.addInitScript(key => {
    localStorage.setItem(key, 'true');
    localStorage.setItem('google-analytics-consent', 'accepted');
  }, KEY);
  await page.goto('/terms.html');
  await expect(page.getByRole('button', { name: 'Allow analytics', exact: true })).toBeVisible();
  await settle(page);
  expect(requests).toEqual([]);
});
