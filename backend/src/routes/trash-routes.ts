import { type FastifyInstance, type FastifyRequest } from 'fastify';

import { toTrashListResponse, toTrashEntryResponse, type TrashEntryResponse } from '../types/api.js';
import { NotFoundError, UnauthorizedError } from '../utils/http-errors.js';
import {
  deleteTrashEntryParamsSchema,
  deleteTrashEntryQuerystringSchema,
  restoreTrashEntryBodySchema,
  trashListResponseSchema,
  trashEntryResponseSchema,
} from './route-schemas.js';

interface TrashParams {
  itemId: string;
}

interface DeleteTrashQuerystring {
  isFolder: 'true' | 'false';
}

interface RestoreTrashBody {
  isFolder: boolean;
}

export async function trashRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: { items: TrashEntryResponse[] } }>(
    '/api/trash',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: trashListResponseSchema,
        },
      },
    },
    async (request) =>
      toTrashListResponse(
        await app.libraryService.getTrashedEntries(getUserId(request)),
      ),
  );

  app.post<{ Body: RestoreTrashBody; Params: TrashParams; Reply: TrashEntryResponse }>(
    '/api/trash/:itemId/restore',
    {
      preHandler: app.authenticate,
      schema: {
        body: restoreTrashEntryBodySchema,
        params: deleteTrashEntryParamsSchema,
        response: {
          200: trashEntryResponseSchema,
        },
      },
    },
    async (request) => {
      const { itemId } = request.params;
      const { isFolder } = request.body;

      const entries = await app.libraryService.getTrashedEntries(getUserId(request));
      const entry = entries.find((e) => e.id === itemId);

      if (entry === undefined) {
        throw new NotFoundError('Trashed item not found.');
      }

      await app.libraryService.restoreTrashEntry(getUserId(request), itemId, isFolder);

      return toTrashEntryResponse({ ...entry, deletedAt: entry.deletedAt });
    },
  );

  app.delete<{ Params: TrashParams; Querystring: DeleteTrashQuerystring }>(
    '/api/trash/:itemId',
    {
      preHandler: app.authenticate,
      schema: {
        params: deleteTrashEntryParamsSchema,
        querystring: deleteTrashEntryQuerystringSchema,
        response: {
          204: { type: 'null' },
        },
      },
    },
    async (request, reply) => {
      const { itemId } = request.params;
      const isFolder = request.query.isFolder === 'true';

      await app.libraryService.permanentlyDeleteEntry(getUserId(request), itemId, isFolder);
      reply.code(204);

      return reply.send();
    },
  );

  app.delete<{ Reply: { deletedCount: number } }>(
    '/api/trash',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: {
            additionalProperties: false,
            properties: {
              deletedCount: { type: 'number' },
            },
            required: ['deletedCount'],
            type: 'object',
          },
        },
      },
    },
    async (request) => {
      const deletedCount = await app.libraryService.emptyTrash(getUserId(request));

      return { deletedCount };
    },
  );

  app.post<{ Reply: { deletedCount: number } }>(
    '/api/trash/cleanup',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: {
            additionalProperties: false,
            properties: {
              deletedCount: { type: 'number' },
            },
            required: ['deletedCount'],
            type: 'object',
          },
        },
      },
    },
    async () => {
      const deletedCount = await app.libraryService.cleanupExpiredTrash();

      return { deletedCount };
    },
  );
}

function getUserId(request: FastifyRequest): string {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth.userId;
}
