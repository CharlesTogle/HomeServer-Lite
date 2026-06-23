import type Database from 'better-sqlite3';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type {
  AuthServiceContract,
  LibraryServiceContract,
} from '../services/contracts.js';
import type {
  AuthenticatedSession,
  DatabaseConnectionState,
} from './domain.js';
import type { ServerConfig } from '../utils/env.js';

declare module 'fastify' {
  interface FastifyInstance {
    authService: AuthServiceContract;
    authenticate: (
      request: FastifyRequest,
      reply: FastifyReply,
    ) => Promise<void>;
    database: DatabaseConnectionState;
    libraryService: LibraryServiceContract;
    serverConfig: ServerConfig;
    sqliteDb: Database.Database;
    storageRoot: string;
  }

  interface FastifyRequest {
    auth: AuthenticatedSession | null;
  }
}
