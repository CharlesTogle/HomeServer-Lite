import { type FastifyInstance, type FastifyRequest } from 'fastify';

import {
  toUploadBatchResponse,
  toUploadItemResponse,
  type UploadBatchResponse,
  type UploadItemResponse,
} from '../types/api.js';
import { BadRequestError, UnauthorizedError } from '../utils/http-errors.js';
import {
  uploadBatchParamsSchema,
  uploadBatchResponseSchema,
  uploadItemParamsSchema,
  uploadItemResponseSchema,
} from './route-schemas.js';

interface CreateUploadBatchBody {
  expectedCount?: number;
  folderId: string;
  totalBytes?: number;
}

interface CreateUploadItemBody {
  clientIdempotencyKey: string;
  mimeType?: string;
  originalName: string;
  totalBytes: number;
}

interface UploadBatchParams {
  batchId: string;
}

interface UploadItemParams {
  itemId: string;
}

export async function uploadRoutes(app: FastifyInstance): Promise<void> {
  app.post<{ Body: CreateUploadBatchBody; Reply: UploadBatchResponse }>(
    '/api/upload-batches',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            expectedCount: { minimum: 1, type: 'integer' },
            folderId: { type: 'string' },
            totalBytes: { minimum: 0, type: 'integer' },
          },
          required: ['folderId'],
          type: 'object',
        },
        response: {
          201: uploadBatchResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const batch = await app.libraryService.createUploadBatch(getUserId(request), {
        expectedCount: request.body.expectedCount,
        folderId: request.body.folderId,
        totalBytes: request.body.totalBytes,
      });

      reply.code(201);

      return toUploadBatchResponse(batch, []);
    },
  );

  app.get<{ Params: UploadBatchParams; Reply: UploadBatchResponse }>(
    '/api/upload-batches/:batchId',
    {
      preHandler: app.authenticate,
      schema: {
        params: uploadBatchParamsSchema,
        response: {
          200: uploadBatchResponseSchema,
        },
      },
    },
    async (request) => {
      const snapshot = await app.libraryService.getUploadBatch(
        getUserId(request),
        request.params.batchId,
      );

      return toUploadBatchResponse(snapshot.batch, snapshot.items);
    },
  );

  app.post<{ Body: CreateUploadItemBody; Params: UploadBatchParams; Reply: UploadItemResponse }>(
    '/api/upload-batches/:batchId/items',
    {
      preHandler: app.authenticate,
      schema: {
        body: {
          additionalProperties: false,
          properties: {
            clientIdempotencyKey: { minLength: 1, type: 'string' },
            mimeType: { minLength: 1, type: 'string' },
            originalName: { minLength: 1, type: 'string' },
            totalBytes: { minimum: 0, type: 'integer' },
          },
          required: ['clientIdempotencyKey', 'originalName', 'totalBytes'],
          type: 'object',
        },
        params: uploadBatchParamsSchema,
        response: {
          201: uploadItemResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const uploadItem = await app.libraryService.createUploadItem(
        getUserId(request),
        request.params.batchId,
        request.body,
      );

      reply.code(201);

      return toUploadItemResponse(uploadItem);
    },
  );

  app.put<{ Body: NodeJS.ReadableStream; Params: UploadItemParams; Reply: UploadItemResponse }>(
    '/api/upload-items/:itemId/content',
    {
      preHandler: app.authenticate,
      schema: {
        params: uploadItemParamsSchema,
        response: {
          202: uploadItemResponseSchema,
        },
      },
    },
    async (request, reply) => {
      const offsetHeader = request.headers['x-upload-offset'];
      const byteOffset = Number.parseInt(
        Array.isArray(offsetHeader) ? offsetHeader[0] ?? '' : offsetHeader ?? '0',
        10,
      );

      if (!Number.isInteger(byteOffset) || byteOffset < 0) {
        throw new BadRequestError('x-upload-offset must be a non-negative integer.');
      }

      const uploadItem = await app.libraryService.uploadItemContent(
        getUserId(request),
        request.params.itemId,
        {
          byteOffset,
          contentStream: request.body,
        },
      );

      reply.code(202);

      return toUploadItemResponse(uploadItem);
    },
  );
}

function getUserId(request: FastifyRequest): string {
  if (request.auth === null) {
    throw new UnauthorizedError('Missing authenticated session.');
  }

  return request.auth.userId;
}
