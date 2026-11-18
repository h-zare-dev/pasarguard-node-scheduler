import test from 'node:test';
import assert from 'node:assert/strict';
import { PasarGuardClient } from '../src/pasarguard.js';

const node = { id: 66, name: 'IDDidicate-DE', core_config_id: 1,
  usage_coefficient: 1, status: 'connected', host: 'never-logged' };
const config = { target: { id: 66, name: 'IDDidicate-DE', coreConfigId: 1 },
  panelBaseUrl: 'https://mock.example', panelApiKey: 'mock-key' };
const response = (body) => ({ ok: true, json: async () => body });

test('GET validates identity and returns only allowlisted fields', async () => {
  const client = new PasarGuardClient(config, async (url, request) => {
    assert.equal(url, 'https://mock.example/api/node/66');
    assert.equal(request.headers['X-Api-Key'], 'mock-key');
    assert.equal(request.method, 'GET');
    return response(node);
  });
  assert.deepEqual(await client.getNode(), {
    id: 66, name: 'IDDidicate-DE', core_config_id: 1, usage_coefficient: 1, status: 'connected',
  });
  const mismatch = new PasarGuardClient(config, async () => response({ ...node, id: 67 }));
  await assert.rejects(mismatch.getNode(), /identity mismatch/);
});

test('PUT uses strictly partial payload; gets identity again before writing', async () => {
  const methods = [];
  const client = new PasarGuardClient(config, async (_url, request) => {
    methods.push(request.method);
    if (request.method === 'PUT') {
      assert.deepEqual(JSON.parse(request.body), { usage_coefficient: 0 });
      return response({ ...node, usage_coefficient: 0 });
    }
    return response(node);
  });
  assert.equal((await client.updateCoefficient(0)).usage_coefficient, 0);
  assert.deepEqual(methods, ['GET', 'PUT']);
  await assert.rejects(client.updateCoefficient(2), /Unsupported/);
});
