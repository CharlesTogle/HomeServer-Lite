import { type FastifyInstance, type FastifyRequest } from 'fastify';

import { toFavoriteListResponse, type FavoriteEntryResponse } from '../types/api.js';
import { UnauthorizedError } from '../utils/http-errors.js';

interface AddFavoriteBody {
  itemId: string;
  itemKind: 'file' | 'folder';
}

interface FavoriteParams {
  itemId: string;
}

const favoriteEntryResponseSchema = {
  additionalProperties: false,
  properties: {
    createdAt: { type: 'string' },
    displayName: { type: 'string' },
    folderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    itemId: { type: 'string' },
    itemKind: { type: 'string' },
    mediaKind: { type: 'string' },
    mimeType: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    parentFolderId: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    sizeBytes: { anyOf: [{ type: 'number' }, { type: 'null' }] },
  },
  required: ['createdAt', 'displayName', 'itemId', 'itemKind', 'mediaKind'],
  type: 'object',
} as const;

const favoritesListResponseSchema = {
  additionalProperties: false,
  properties: {
    items: {
      items: favoriteEntryResponseSchema,
      type: 'array',
    },
  },
  required: ['items'],
  type: 'object',
} as const;

const addFavoriteBodySchema = {
  additionalProperties: false,
  properties: {
    itemId: { minLength: 1, type: 'string' },
    itemKind: { enum: ['file', 'folder'], type: 'string' },
  },
  required: ['itemId', 'itemKind'],
  type: 'object',
} as const;

const favoriteParamsSchema = {
  additionalProperties: false,
  properties: {
    itemId: { minLength: 1, type: 'string' },
  },
  required: ['itemId'],
  type: 'object',
} as const;

export async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: { items: FavoriteEntryResponse[] } }>(
    '/api/favorites',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: favoritesListResponseSchema,
        },
      },
    },
    async (request) =>
      toFavoriteListResponse(
        await app.libraryService.getFavorites(getUserId(request)),
      ),
  );

  app.post<{ Body: AddFavoriteBody }>(
    '/api/favorites',
    {
      preHandler: app.authenticate,
      schema: {
        body: addFavoriteBodySchema,
        response: {
          201: { type: 'null' },
        },
      },
    },
    async (request, reply) => {
      const { itemId, itemKind } = request.body;
      await app.libraryService.addFavorite(getUserId(request), itemId, itemKind);
      reply.code(201);
      return reply.send();
    },
  );

  app.delete<{ Params: FavoriteParams }>(
    '/api/favorites/:itemId',
    {
      preHandler: app.authenticate,
      schema: {
        params: favoriteParamsSchema,
        response: {
          204: { type: 'null' },
        },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params;
      await app.libraryService.removeFavorite(getUserId(request), itemId);
      reply.code(204);
      return reply.send();
    },
  );
}

function getUserId(request: FastifyRequest): string {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth.userId;
}
