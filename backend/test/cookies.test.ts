import assert from 'node:assert/strict';
import test from 'node:test';

import {
  REFRESH_COOKIE_NAME,
  serializeClearedRefreshCookie,
  serializeRefreshCookie,
} from '../src/utils/cookies.js';

test('serializeRefreshCookie creates a persistent http-only cookie', () => {
  const serialized = serializeRefreshCookie('refresh-token-value', 60, false);

  assert.match(serialized, new RegExp(`^${REFRESH_COOKIE_NAME}=refresh-token-value`));
  assert.match(serialized, /Max-Age=60/);
  assert.match(serialized, /Expires=/);
  assert.match(serialized, /Path=\/api\/auth/);
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /SameSite=Strict/);
});

test('serializeClearedRefreshCookie clears the refresh cookie', () => {
  const serialized = serializeClearedRefreshCookie(true);

  assert.match(serialized, new RegExp(`^${REFRESH_COOKIE_NAME}=`));
  assert.match(serialized, /Max-Age=0/);
  assert.match(serialized, /Expires=Thu, 01 Jan 1970 00:00:00 GMT/);
  assert.match(serialized, /Path=\/api\/auth/);
  assert.match(serialized, /HttpOnly/);
  assert.match(serialized, /SameSite=Strict/);
  assert.match(serialized, /Secure/);
});
