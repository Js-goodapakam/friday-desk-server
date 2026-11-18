const { test } = require('node:test');
const assert = require('node:assert/strict');
const { assertIsolatedTestDatabase } = require('./assert-isolated-test-db');

const isolated = 'postgresql://tester:secret@db.abcdefghijklmnopqrst.supabase.co:5432/postgres';
test('requires an explicitly named dedicated test connection', () => {
  assert.throws(() => assertIsolatedTestDatabase({}), /explicitly named/);
  assert.throws(() => assertIsolatedTestDatabase({ ENGAGE_TEST_DATABASE_URL: isolated, ENGAGE_TEST_DATABASE_ID: 'staging' }), /dedicated Engage Stay test/);
});
test('refuses production and application connection fallbacks', () => {
  assert.throws(() => assertIsolatedTestDatabase({ ENGAGE_TEST_DATABASE_URL: 'postgresql://x:y@db.trypyepdjmfjzofggduk.supabase.co/postgres', ENGAGE_TEST_DATABASE_ID: 'engage-stay-test' }), /Production/);
  assert.throws(() => assertIsolatedTestDatabase({ ENGAGE_TEST_DATABASE_URL: isolated, ENGAGE_TEST_DATABASE_ID: 'engage-stay-test', DATABASE_URL: isolated }), /must not equal/);
});
test('accepts a separately declared non-production target', () => {
  assert.deepEqual(assertIsolatedTestDatabase({ ENGAGE_TEST_DATABASE_URL: isolated, ENGAGE_TEST_DATABASE_ID: 'engage-stay-test-ap-south-1', DATABASE_URL: 'postgresql://x:y@db.zyxwvutsrqponmlkjihg.supabase.co/postgres' }), { host: 'db.abcdefghijklmnopqrst.supabase.co', ref: 'abcdefghijklmnopqrst' });
});
