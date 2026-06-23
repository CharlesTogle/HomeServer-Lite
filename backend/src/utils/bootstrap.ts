import { randomUUID } from 'node:crypto';
import fs from 'node:fs';

import { type FastifyInstance } from 'fastify';

import { ConflictError } from './http-errors.js';
import { buildRootStorageRelPath, ensureWithinStorageRoot } from './storage-paths.js';

const DEFAULT_QUOTA_BYTES = 107374182400;

export async function bootstrapSeedUsers(app: FastifyInstance): Promise<void> {
  const user1Email = process.env.HOMESERVER_USER_1_EMAIL;
  const user1Password = process.env.HOMESERVER_USER_1_PASSWORD;
  const user2Email = process.env.HOMESERVER_USER_2_EMAIL;
  const user2Password = process.env.HOMESERVER_USER_2_PASSWORD;

  const seedPairs: Array<{ email: string | undefined; password: string | undefined }> = [
    { email: user1Email, password: user1Password },
    { email: user2Email, password: user2Password },
  ];

  const userIds: string[] = [];

  for (const pair of seedPairs) {
    if (pair.email === undefined || pair.password === undefined) {
      continue;
    }

    const normalizedEmail = pair.email.trim().toLowerCase();
    const db = app.sqliteDb;

    const existingUser = db.prepare(
      'SELECT id FROM users WHERE email = ?',
    ).get(normalizedEmail) as { id: string } | undefined;

    if (existingUser !== undefined) {
      userIds.push(existingUser.id);
      continue;
    }

    try {
      const result = await app.authService.provisionUser(normalizedEmail, pair.password);

      const userId = result.user.id;
      userIds.push(userId);

      db.prepare(
        'INSERT OR IGNORE INTO user_storage_usage (user_id, used_bytes, quota_bytes) VALUES (?, 0, ?)',
      ).run(userId, DEFAULT_QUOTA_BYTES);

      await app.libraryService.ensureUserRootFolder(userId);

      app.log.info({ email: normalizedEmail }, 'Seeded user');
    } catch (error) {
      if (error instanceof ConflictError) {
        app.log.warn({ email: normalizedEmail }, 'User already exists');
        continue;
      }

      throw error;
    }
  }

  // Create a shared "Shared" folder for user 1 and grant access to both users
  if (userIds.length >= 2) {
    const ownerId = userIds[0];
    const memberId = userIds[1];
    const db = app.sqliteDb;
    const storageRoot: string = (app as unknown as { storageRoot: string }).storageRoot;
    const ownerRootFolder = await app.libraryService.ensureUserRootFolder(ownerId);

    // Keep the seeded Shared folder under the user's real root so the tree has one top-level root.
    const existingSharedFolder = db.prepare(
      "SELECT id, parent_folder_id AS parentFolderId FROM folders WHERE user_id = ? AND display_name = 'Shared' AND is_root = 0 LIMIT 1",
    ).get(ownerId) as { id: string; parentFolderId: string | null } | undefined;

    let sharedFolderId: string;

    if (existingSharedFolder !== undefined) {
      sharedFolderId = existingSharedFolder.id;

      if (existingSharedFolder.parentFolderId === null) {
        db.prepare(
          'UPDATE folders SET parent_folder_id = ?, updated_at = ? WHERE id = ?',
        ).run(ownerRootFolder.id, new Date().toISOString(), sharedFolderId);
      }
    } else {
      sharedFolderId = randomUUID();
      const rootRelPath = buildRootStorageRelPath(ownerId);
      const storageRelPath = `${rootRelPath}/${sharedFolderId}`;
      const now = new Date().toISOString();

      const absolutePath = ensureWithinStorageRoot(storageRoot, storageRelPath);
      fs.mkdirSync(absolutePath, { recursive: true });

      db.prepare(
        `INSERT INTO folders (id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at)
         VALUES (?, ?, ?, 'Shared', 0, ?, ?, ?)`,
      ).run(sharedFolderId, ownerId, ownerRootFolder.id, storageRelPath, now, now);
    }

    // Grant access
    const now = new Date().toISOString();
    db.prepare(
      'INSERT OR IGNORE INTO shared_folder_members (folder_id, user_id, created_at) VALUES (?, ?, ?)',
    ).run(sharedFolderId, ownerId, now);
    db.prepare(
      'INSERT OR IGNORE INTO shared_folder_members (folder_id, user_id, created_at) VALUES (?, ?, ?)',
    ).run(sharedFolderId, memberId, now);

    app.log.info({ sharedFolderId }, 'Shared folder ready');
  }
}
