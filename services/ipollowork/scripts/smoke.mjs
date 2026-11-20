/** Non-mutating checks against a running service; no login credentials required. */
import assert from 'node:assert/strict';

const origin = new URL(process.argv[2] ?? 'http://localhost:4785');
assert(!origin.username && !origin.password && origin.pathname === '/' && !origin.search && !origin.hash, 'Pass a service origin');
async function request(path) {
  return fetch(new URL(path, origin), { redirect: 'error', signal: AbortSignal.timeout(10000) });
}
for (const path of ['/api/health', '/api/ready']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  assert.equal((await response.json()).ok, true, path);
}
const discovery = await request('/.well-known/ipollowork');
assert.equal(discovery.status, 200);
assert.equal((await discovery.json()).service, 'ipollowork-services');
for (const path of ['/', '/reset-password', '/invite/smoke-not-a-real-token']) {
  const response = await request(path);
  assert.equal(response.status, 200, path);
  const html = await response.text();
  assert(html.includes('id="root"'), path + ' must return the built application');
  if (path === '/') {
    const script = html.match(/src="(\/assets\/[^" ]+\.js)"/);
    assert(script, 'Built JS asset missing');
    const asset = await request(script[1]);
    assert.equal(asset.status, 200);
    assert.match(asset.headers.get('content-type') ?? '', /javascript/);
  }
}
assert.equal((await request('/api/v1/admin/settings')).status, 401, 'Admin settings must require authentication');
assert.equal((await request('/api/nonexistent-handoff-route')).status, 404);
console.log('Health, readiness, discovery, built pages/assets and unauthenticated access checks passed.');
