/** Real built DSH web client smoke; run only against the disposable Stage QA fixture. */
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright-core';
const log = await readFile(process.argv[2] ?? '.runtime/server.log', 'utf8');
const launch = log.match(/dsh web: (http:\/\/\S+)/)?.[1];
assert(launch, 'Start the disposable QA profile with tests/native-fixture.mjs');
const origin = new URL(launch).origin;
const output = resolve('.runtime/screenshots');
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_EXECUTABLE ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' });
try {
  const authentication = await fetch(launch, { redirect: 'manual' });
  const cookie = authentication.headers.getSetCookie().map(value => value.split(';')[0]).join('; ');
  const previous = await (await fetch(origin + '/stage-fixture', { headers: { cookie } })).json();
  assert(Array.isArray(previous.calls) && !previous.linked, 'Use the disconnected Stage QA fixture');
  const page = await browser.newPage({ viewport: { width: 1100, height: 780 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(launch);
  await page.waitForTimeout(700);
  for (const name of ['继续', '稍后配置']) {
    const button = page.getByRole('button', { name, exact: true });
    if (await button.count()) await button.click();
  }
  const initial = await (await page.request.get(origin + '/stage-fixture')).json();
  assert(!initial.calls.slice(previous.calls.length).some(action => ['launch', 'connect', 'generate', 'export'].includes(action)), 'Loading cannot launch or generate');
  await page.getByText('Stage', { exact: true }).first().click();
  await page.getByRole('button', { name: '关联 Stage / Link Stage', exact: true }).click();
  const approval = page.getByRole('link', { name: '继续授权 / Continue authorization', exact: true });
  await approval.waitFor();
  assert.equal(await approval.getAttribute('href'), 'https://stage.example.test/approve');
  await page.request.post(origin + '/stage-fixture/approve', { data: {} });
  await page.getByRole('button', { name: '刷新 / Refresh', exact: true }).click();
  await page.getByText('已关联 / Connected · Existing QA account', { exact: true }).waitFor();
  await page.getByRole('button', { name: '允许此工作区调用 / Enable tools', exact: true }).click();
  await page.getByRole('button', { name: '停止对话调用 / Disable tools', exact: true }).waitFor();
  const invoked=await (await page.request.post(origin+'/stage-fixture/run',{data:{}})).json();
  assert.equal(invoked.results[0].result.isError,false,JSON.stringify(invoked));
  assert.equal(invoked.results[0].result.value.taskId,'qa-task');
  await page.getByRole('button', { name: '打开 Stage / Open Stage', exact: true }).click();
  const ticket = page.getByRole('link', { name: '进入 Stage / Continue to Stage', exact: true });
  await ticket.waitFor();
  assert.equal(await ticket.getAttribute('href'), 'https://stage.example.test/one-use');
  for (const theme of ['light', 'dark']) for (const width of [1100, 390]) {
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width, height: 844 });
    await page.waitForTimeout(250);
    const panel = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Stage', exact: true }) });
    assert(await panel.isVisible());
    const fits = await panel.evaluate(element => element.scrollWidth <= element.clientWidth + 1);
    assert(fits, `Stage panel overflows at ${theme}/${width}`);
    assert.equal(await page.locator('body').evaluate(element => element.hasAttribute('data-ds-dark-theme')), theme === 'dark');
    await page.screenshot({ path: resolve(output, `${theme}-${width}.png`), fullPage: true });
  }
  await page.getByRole('button', { name: '解除关联 / Disconnect', exact: true }).click();
  await page.getByRole('button', { name: '关联 Stage / Link Stage', exact: true }).waitFor();
  const workspaces = await (await page.request.get(origin + '/ipollo-stage/workspaces')).json();
  assert(workspaces.workspaces.every(row => !row.enabled));
  assert.deepEqual(errors, []);
  assert.equal((await fetch(origin + '/ipollo-stage/status')).status, 401);
  console.log('Native Stage smoke passed: owner authentication, manual linking/opening, workspace consent, disconnect and light/dark at 1100/390 px.');
} finally { await browser.close(); }
