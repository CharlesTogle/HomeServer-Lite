export const REFRESH_COOKIE_NAME = 'homeserver_refresh_token';

interface CookieOptions {
  expiresAt?: Date;
  httpOnly?: boolean;
  maxAgeSeconds?: number;
  path?: string;
  sameSite?: 'Lax' | 'None' | 'Strict';
  secure?: boolean;
}

export function parseCookieHeader(
  rawCookieHeader: string | undefined,
): Record<string, string> {
  if (rawCookieHeader === undefined || rawCookieHeader.trim() === '') {
    return {};
  }

  const cookiePairs = rawCookieHeader.split(';');
  const parsedCookies: Record<string, string> = {};

  for (const pair of cookiePairs) {
    const separatorIndex = pair.indexOf('=');

    if (separatorIndex === -1) {
      continue;
    }

    const name = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();

    if (name === '') {
      continue;
    }

    parsedCookies[name] = decodeURIComponent(value);
  }

  return parsedCookies;
}

export function serializeClearedRefreshCookie(secure: boolean): string {
  return serializeCookie(REFRESH_COOKIE_NAME, '', {
    expiresAt: new Date(0),
    httpOnly: true,
    maxAgeSeconds: 0,
    path: '/api/auth',
    sameSite: 'Strict',
    secure,
  });
}

export function serializeRefreshCookie(
  token: string,
  maxAgeSeconds: number,
  secure: boolean,
): string {
  return serializeCookie(REFRESH_COOKIE_NAME, token, {
    expiresAt: new Date(Date.now() + maxAgeSeconds * 1000),
    httpOnly: true,
    maxAgeSeconds,
    path: '/api/auth',
    sameSite: 'Strict',
    secure,
  });
}

function serializeCookie(
  name: string,
  value: string,
  options: CookieOptions,
): string {
  const segments = [`${name}=${encodeURIComponent(value)}`];

  if (options.maxAgeSeconds !== undefined) {
    segments.push(`Max-Age=${options.maxAgeSeconds}`);
  }

  if (options.expiresAt !== undefined) {
    segments.push(`Expires=${options.expiresAt.toUTCString()}`);
  }

  segments.push(`Path=${options.path ?? '/'}`);

  if (options.httpOnly === true) {
    segments.push('HttpOnly');
  }

  if (options.secure === true) {
    segments.push('Secure');
  }

  if (options.sameSite !== undefined) {
    segments.push(`SameSite=${options.sameSite}`);
  }

  return segments.join('; ');
}
