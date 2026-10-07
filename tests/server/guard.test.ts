import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedRequest } from '../../server/guard.ts';

const json = 'application/json';

test('requête locale normale acceptée', () => {
  assert.equal(isAllowedRequest('GET', { host: 'localhost:5173' }), true);
  assert.equal(isAllowedRequest('POST', { host: '127.0.0.1:5173', origin: 'http://127.0.0.1:5173', 'content-type': json }), true);
});

test('origine différente refusée (CSRF depuis un autre site)', () => {
  assert.equal(isAllowedRequest('POST', { host: 'localhost:5173', origin: 'https://evil.example', 'content-type': json }), false);
  assert.equal(isAllowedRequest('GET', { host: 'localhost:5173', origin: 'https://evil.example' }), false);
});

test('hôte non local refusé (DNS rebinding)', () => {
  assert.equal(isAllowedRequest('GET', { host: 'evil.example:5173' }), false);
  assert.equal(isAllowedRequest('GET', {}), false);
});

test('écriture sans JSON refusée', () => {
  assert.equal(isAllowedRequest('POST', { host: 'localhost:5173', 'content-type': 'text/plain' }), false);
  assert.equal(isAllowedRequest('PUT', { host: 'localhost:5173' }), false);
  assert.equal(isAllowedRequest('DELETE', { host: 'localhost:5173' }), true);
});

test('origine illisible refusée', () => {
  assert.equal(isAllowedRequest('GET', { host: 'localhost:5173', origin: 'pas une url' }), false);
});
