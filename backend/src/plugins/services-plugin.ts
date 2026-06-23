import { type FastifyPluginAsync } from 'fastify';
import fp from 'fastify-plugin';

import { SqliteAuthService } from '../services/sqlite-auth-service.js';
import { SqliteLibraryService } from '../services/sqlite-library-service.js';

const servicesPluginImpl: FastifyPluginAsync = async function servicesPlugin(
  app,
): Promise<void> {
  const config = app.serverConfig;
  const authConfig = {
    accessTokenTtlSeconds: config.accessTokenTtlSeconds,
    authTokenSecret: config.authTokenSecret,
    refreshTokenTtlSeconds: config.refreshTokenTtlSeconds,
  };

  const libraryService = new SqliteLibraryService(app.sqliteDb, app.storageRoot);
  const authService = new SqliteAuthService(app.sqliteDb, authConfig);

  app.decorate('libraryService', libraryService);
  app.decorate('authService', authService);
};

export const servicesPlugin = fp(servicesPluginImpl, {
  dependencies: ['database-plugin', 'storage-plugin'],
  name: 'services-plugin',
});
