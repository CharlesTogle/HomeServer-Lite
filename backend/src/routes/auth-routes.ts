import { type FastifyInstance, type FastifyRequest } from 'fastify';

import {
  toAuthResponse,
  toUserResponse,
  type AuthResponse,
  type UserResponse,
} from '../types/api.js';
import {
  parseCookieHeader,
  REFRESH_COOKIE_NAME,
  serializeClearedRefreshCookie,
  serializeRefreshCookie,
} from '../utils/cookies.js';
import { UnauthorizedError } from '../utils/http-errors.js';
import { authResponseSchema, userResponseSchema } from './route-schemas.js';

interface AuthBody {
  email: string;
  password: string;
}

interface SessionResponse {
  rootFolderId: string;
  user: UserResponse;
}

interface MeResponse {
  user: UserResponse;
  storage: {
    usedBytes: number;
    quotaBytes: number;
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: AuthBody; Reply: AuthResponse }>(
    '/api/auth/login',
    {
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            email: { format: 'email', type: 'string' },
            password: { minLength: 8, type: 'string' },
          },
          required: ['email', 'password'],
          type: 'object',
        },
        response: {
          200: authResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const result = await app.authService.login(
        request.body.email,
        request.body.password,
      );

      reply.header(
        'set-cookie',
        serializeRefreshCookie(
          result.refreshToken,
          getRefreshTokenMaxAgeSeconds(),
          isProductionSecureCookie(),
        ),
      );

      return toAuthResponse(result.accessToken, result.user);
    },
  );

  app.post<{ Reply: AuthResponse }>(
    '/api/auth/refresh',
    {
      schema: {
        response: {
          200: authResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const refreshToken = getRefreshToken(request);
      const result = await app.authService.refresh(refreshToken);

      reply.header(
        'set-cookie',
        serializeRefreshCookie(
          result.refreshToken,
          getRefreshTokenMaxAgeSeconds(),
          isProductionSecureCookie(),
        ),
      );

      return toAuthResponse(result.accessToken, result.user);
    },
  );

  app.post(
    '/api/auth/logout',
    {
      schema: {
        response: {
          204: {
            type: 'null',
          },
        },
      },
    },
    async (request, reply) => {
      const cookies = parseCookieHeader(request.headers.cookie);
      const authorizationHeader = request.headers.authorization;
      const refreshToken = cookies[REFRESH_COOKIE_NAME];
      const accessToken = extractBearerToken(authorizationHeader);

      await app.authService.logout(refreshToken, accessToken);
      reply.header(
        'set-cookie',
        serializeClearedRefreshCookie(isProductionSecureCookie()),
      );
      reply.code(204);

      return reply.send();
    },
  );

  app.get<{ Reply: SessionResponse }>(
    '/api/auth/session',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: {
            additionalProperties: false,
            properties: {
              rootFolderId: { type: 'string' },
              user: userResponseSchema,
            },
            required: ['rootFolderId', 'user'],
            type: 'object',
          },
        },
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const user = await app.authService.getUserById(auth.userId);
      const rootFolder = await app.libraryService.getRootFolder(auth.userId);

      return {
        rootFolderId: rootFolder.id,
        user: toUserResponse(user),
      };
    },
  );

  app.patch<{ Body: { currentPassword: string; newPassword: string } }>(
    '/api/auth/password',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            currentPassword: { minLength: 8, type: 'string' },
            newPassword: { minLength: 8, type: 'string' },
          },
          required: ['currentPassword', 'newPassword'],
          type: 'object',
        },
        response: {
          204: { type: 'null' },
        },
      },
    },
    async (request, reply) => {
      const auth = getAuth(request);

      await app.authService.changePassword(
        auth.userId,
        request.body.currentPassword,
        request.body.newPassword,
      );

      reply.code(204);

      return reply.send();
    },
  );

  app.get<{ Reply: MeResponse }>(
    '/api/me',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: {
            additionalProperties: false,
            properties: {
              user: userResponseSchema,
              storage: {
                additionalProperties: false,
                properties: {
                  usedBytes: { type: 'number' },
                  quotaBytes: { type: 'number' },
                },
                required: ['usedBytes', 'quotaBytes'],
                type: 'object',
              },
            },
            required: ['user', 'storage'],
            type: 'object',
          },
        },
      },
    },
    async (request) => {
      const auth = getAuth(request);
      const user = await app.authService.getUserById(auth.userId);
      const usage = await app.libraryService.getStorageUsage(auth.userId);

      return {
        user: toUserResponse(user),
        storage: {
          usedBytes: usage.usedBytes,
          quotaBytes: usage.quotaBytes,
        },
      };
    },
  );
}

function extractBearerToken(
  authorizationHeader: string | undefined,
): string | undefined {
  if (authorizationHeader === undefined) {
    return undefined;
  }

  const [scheme, token] = authorizationHeader.split(' ');

  if (scheme !== 'Bearer' || token === undefined || token.trim() === '') {
    return undefined;
  }

  return token;
}

function getAuth(request: FastifyRequest): NonNullable<FastifyRequest['auth']> {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth;
}

function getRefreshToken(request: FastifyRequest): string {
  const cookies = parseCookieHeader(request.headers.cookie);
  const refreshToken = cookies[REFRESH_COOKIE_NAME];

  if (refreshToken === undefined || refreshToken.trim() === '') {
    throw new UnauthorizedError('Missing refresh token.');
  }

  return refreshToken;
}

function getRefreshTokenMaxAgeSeconds(): number {
  return Number(process.env.REFRESH_TOKEN_TTL_SECONDS ?? 60 * 60 * 24 * 30);
}

function isProductionSecureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
}
