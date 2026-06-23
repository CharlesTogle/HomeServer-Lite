import { type FastifyInstance, type FastifyRequest } from 'fastify';

import {
  toFolderEntriesResponse,
  toFolderResponse,
  type FolderEntriesResponse,
  type FolderResponse,
  toFolderTreeResponse,
  type FolderTreeResponse,
  type StorageUsageResponse,
} from '../types/api.js';
import { UnauthorizedError } from '../utils/http-errors.js';
import type { GetFolderEntriesInput } from '../services/contracts.js';
import {
  folderEntriesResponseSchema,
  folderParamsSchema,
  folderResponseSchema,
  folderTreeResponseSchema,
  sharedFoldersResponseSchema,
  storageUsageResponseSchema,
} from './route-schemas.js';

interface CreateFolderBody {
  name: string;
  parentFolderId: string;
}

interface FolderParams {
  folderId: string;
}

interface UpdateFolderBody {
  name?: string;
  parentFolderId?: string;
}

interface DeleteFolderQuery {
  recursive?: 'false' | 'true';
}

interface FolderEntriesQuerystring {
  extensionFilter?: string;
  limit?: number;
  offset?: number;
  search?: string;
  searchIncludesDirectChildren?: 'false' | 'true';
  sortDirection?: GetFolderEntriesInput['sortDirection'];
  sortField?: GetFolderEntriesInput['sortField'];
  typeFilter?: GetFolderEntriesInput['typeFilter'];
}

const DEFAULT_FOLDER_ENTRIES_LIMIT = 60;
const MAX_FOLDER_ENTRIES_LIMIT = 200;

export async function folderRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Reply: FolderTreeResponse }>(
    '/api/folders/tree',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: folderTreeResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderTreeResponse(await app.libraryService.listFolders(getUserId(request))),
  );

  app.get<{ Reply: FolderTreeResponse }>(
    '/api/folders/shared',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: sharedFoldersResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderTreeResponse(await app.libraryService.getSharedFolders(getUserId(request))),
  );

  app.get<{ Reply: StorageUsageResponse }>(
    '/api/folders/shared/storage',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: storageUsageResponseSchema,
        },
      },
    },
    async (request) => await app.libraryService.getSharedStorageUsage(getUserId(request)),
  );

  app.get<{ Reply: FolderResponse }>(
    '/api/folders/root',
    {
      preHandler: app.authenticate,
      schema: {
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderResponse(
        await app.libraryService.getRootFolder(getUserId(request)),
      ),
  );

  app.post<{ Body: CreateFolderBody; Reply: FolderResponse }>(
    '/api/folders',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            name: { minLength: 1, type: 'string' },
            parentFolderId: { type: 'string' },
          },
          required: ['name', 'parentFolderId'],
          type: 'object',
        },
        response: {
          201: folderResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const folder = await app.libraryService.createFolder(getUserId(request), {
        name: request.body.name,
        parentFolderId: request.body.parentFolderId,
      });

      reply.code(201);
      return toFolderResponse(folder);
    },
  );

  app.get<{ Params: FolderParams; Reply: FolderResponse }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) =>
      toFolderResponse(
        await app.libraryService.getFolder(
          getUserId(request),
          request.params.folderId,
        ),
      ),
  );

  app.get<{ Params: FolderParams; Querystring: FolderEntriesQuerystring; Reply: FolderEntriesResponse }>(
    '/api/folders/:folderId/entries',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        querystring: {
          additionalProperties: false,
          properties: {
            extensionFilter: { type: 'string' },
            limit: { maximum: MAX_FOLDER_ENTRIES_LIMIT, minimum: 1, type: 'integer' },
            offset: { minimum: 0, type: 'integer' },
            search: { type: 'string' },
            searchIncludesDirectChildren: {
              enum: ['false', 'true'],
              type: 'string',
            },
            sortDirection: {
              enum: ['asc', 'desc'],
              type: 'string',
            },
            sortField: {
              enum: ['name', 'date', 'size', 'type'],
              type: 'string',
            },
            typeFilter: {
              enum: ['all', 'image', 'audio', 'video', 'document', 'archive', 'other'],
              type: 'string',
            },
          },
          type: 'object',
        },
        response: {
          200: folderEntriesResponseSchema,
        },
      },
    },
    async (request) => {
      const input: GetFolderEntriesInput = {
        extensionFilter: request.query.extensionFilter?.trim().toLowerCase() ?? 'all',
        limit: request.query.limit ?? DEFAULT_FOLDER_ENTRIES_LIMIT,
        offset: request.query.offset ?? 0,
        search: request.query.search?.trim() ?? '',
        searchIncludesDirectChildren: request.query.searchIncludesDirectChildren === 'true',
        sortDirection: request.query.sortDirection ?? 'asc',
        sortField: request.query.sortField ?? 'name',
        typeFilter: request.query.typeFilter ?? 'all',
      };
      const entries = await app.libraryService.getFolderEntries(
        getUserId(request),
        request.params.folderId,
        input,
      );

      return toFolderEntriesResponse(
        entries.folder,
        entries.folders,
        entries.files,
        entries.nextOffset,
        entries.totalFileCount,
        entries.availableExtensions,
        entries.existingFileNames,
      );
    },
  );

  app.patch<{ Body: UpdateFolderBody; Params: FolderParams; Reply: FolderResponse }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            name: { minLength: 1, type: 'string' },
            parentFolderId: { type: 'string' },
          },
          type: 'object',
        },
        params: folderParamsSchema,
        response: {
          200: folderResponseSchema,
        },
      },
    },
    async (request) => {
      const folder = await app.libraryService.updateFolder(
        getUserId(request),
        request.params.folderId,
        request.body,
      );

      return toFolderResponse(folder);
    },
  );

  app.delete<{ Params: FolderParams; Querystring: DeleteFolderQuery }>(
    '/api/folders/:folderId',
    {
      preHandler: app.authenticate,
      schema: {
        params: folderParamsSchema,
        querystring: {
          additionalProperties: false,
          properties: {
            recursive: {
              enum: ['false', 'true'],
              type: 'string',
            },
          },
          type: 'object',
        },
        response: {
          204: {
            type: 'null',
          },
        },
      },
    },
    async (request, reply) => {
      await app.libraryService.deleteFolder(
        getUserId(request),
        request.params.folderId,
        request.query.recursive === 'true',
      );
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
