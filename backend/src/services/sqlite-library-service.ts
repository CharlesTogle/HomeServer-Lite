import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, rename, rm, unlink } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type Database from 'better-sqlite3';
import type { MultipartFile } from '@fastify/multipart';

import type {
  CreateFolderInput,
  CreateUploadBatchInput,
  CreateUploadItemInput,
  FavoriteEntry,
  FileReadDescriptor,
  FolderEntries,
  FolderEntriesSortDirection,
  FolderEntriesSortField,
  FolderEntriesTypeFilter,
  GetFolderEntriesInput,
  FolderTreeFolder,
  LibraryServiceContract,
  TrashEntry,
  UpdateFileInput,
  UpdateFolderInput,
  UploadBatchSnapshot,
} from './contracts.js';
import type {
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
} from '../types/domain.js';
import {
  queryOptionalRow,
  queryRequiredRow,
  queryRows,
  toDate,
  withTransaction,
} from './sqlite-support.js';
import {
  BadRequestError,
  ConflictError,
  NotFoundError,
} from '../utils/http-errors.js';
import {
  buildFileStorageRelPath,
  buildFolderStorageRelPath,
  buildRootStorageRelPath,
  ensureValidDisplayName,
  ensureWithinStorageRoot,
  getStoredExtension,
  replaceStoragePathPrefix,
} from '../utils/storage-paths.js';

const DEFAULT_QUOTA_BYTES = 107374182400;

function escapeLikePattern(value: string): string {
  return value.replace(/([%_\\])/g, '\\$1');
}

function extractFileExtension(name: string): string {
  const lastDotIndex = name.lastIndexOf('.');

  if (lastDotIndex <= 0 || lastDotIndex === name.length - 1) {
    return '';
  }

  return name.slice(lastDotIndex + 1).toLowerCase();
}

function getMediaKindWhereClause(typeFilter: FolderEntriesTypeFilter): string | null {
  switch (typeFilter) {
    case 'image':
      return "mime_type LIKE 'image/%'";
    case 'audio':
      return "mime_type LIKE 'audio/%'";
    case 'video':
      return "mime_type LIKE 'video/%'";
    case 'document':
      return "mime_type = 'application/pdf' OR mime_type LIKE 'text/%' OR mime_type LIKE '%word%'";
    case 'archive':
      return "mime_type LIKE '%zip%' OR mime_type LIKE '%tar%' OR mime_type LIKE '%compressed%'";
    case 'other':
      return "NOT (mime_type LIKE 'image/%' OR mime_type LIKE 'audio/%' OR mime_type LIKE 'video/%' OR mime_type = 'application/pdf' OR mime_type LIKE 'text/%' OR mime_type LIKE '%word%' OR mime_type LIKE '%zip%' OR mime_type LIKE '%tar%' OR mime_type LIKE '%compressed%')";
    case 'all':
    default:
      return null;
  }
}

function getMediaKindSortExpression(): string {
  return `CASE
    WHEN mime_type LIKE 'audio/%' THEN 'audio'
    WHEN mime_type LIKE '%zip%' OR mime_type LIKE '%tar%' OR mime_type LIKE '%compressed%' THEN 'archive'
    WHEN mime_type = 'application/pdf' OR mime_type LIKE 'text/%' OR mime_type LIKE '%word%' THEN 'document'
    WHEN mime_type LIKE 'image/%' THEN 'image'
    WHEN mime_type LIKE 'video/%' THEN 'video'
    ELSE 'other'
  END`;
}

function getFileOrderByClause(
  sortField: FolderEntriesSortField,
  sortDirection: FolderEntriesSortDirection,
): string {
  const direction = sortDirection === 'desc' ? 'DESC' : 'ASC';

  switch (sortField) {
    case 'date':
      return `created_at ${direction}, display_name COLLATE NOCASE ASC, id ASC`;
    case 'size':
      return `size_bytes ${direction}, display_name COLLATE NOCASE ASC, id ASC`;
    case 'type':
      return `${getMediaKindSortExpression()} ${direction}, display_name COLLATE NOCASE ASC, id ASC`;
    case 'name':
    default:
      return `display_name COLLATE NOCASE ${direction}, id ASC`;
  }
}

class MulterError extends Error {
  public readonly code: string;
  public readonly field?: string;

  public constructor(code: string, field?: string) {
    super();
    this.code = code;
    this.field = field;
    this.name = 'MulterError';
  }
}

interface UserRow {
  [column: string]: unknown;
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
  updated_at: string;
}

interface FolderRow {
  [column: string]: unknown;
  id: string;
  user_id: string;
  parent_folder_id: string | null;
  display_name: string;
  is_root: number;
  storage_rel_path: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface FileRow {
  [column: string]: unknown;
  id: string;
  user_id: string;
  folder_id: string;
  display_name: string;
  original_name: string;
  stored_extension: string;
  mime_type: string;
  size_bytes: number;
  sha256: string;
  status: string;
  storage_rel_path: string;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

interface UploadBatchRow {
  [column: string]: unknown;
  id: string;
  user_id: string;
  folder_id: string;
  expected_count: number | null;
  completed_count: number;
  failed_count: number;
  status: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

interface UploadItemRow {
  [column: string]: unknown;
  id: string;
  user_id: string;
  batch_id: string;
  client_idempotency_key: string;
  original_name: string;
  status: string;
  file_id: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

interface StorageUsageRow {
  [column: string]: unknown;
  user_id: string;
  used_bytes: number;
  quota_bytes: number;
}

interface CountRow {
  [column: string]: unknown;
  count: number;
}

interface FileCountRow {
  [column: string]: unknown;
  folder_id: string;
  count: number;
}

interface IdRow {
  [column: string]: unknown;
  id: string;
}

interface BatchCountsRow {
  [column: string]: unknown;
  completed_count: number;
  failed_count: number;
}

function toUserRecord(row: UserRow) {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

function toFolderRecord(row: FolderRow): FolderRecord {
  return {
    id: row.id,
    userId: row.user_id,
    parentFolderId: row.parent_folder_id ?? null,
    displayName: row.display_name,
    isRoot: Boolean(row.is_root),
    storageRelPath: row.storage_rel_path,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toDate(row.deleted_at),
  };
}

function toFileRecord(row: FileRow): FileRecord {
  return {
    id: row.id,
    userId: row.user_id,
    folderId: row.folder_id,
    displayName: row.display_name,
    originalName: row.original_name,
    storedExtension: row.stored_extension,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    status: row.status as FileRecord['status'],
    storageRelPath: row.storage_rel_path,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    deletedAt: row.deleted_at === null ? null : toDate(row.deleted_at),
  };
}

function toUploadBatchRecord(row: UploadBatchRow): UploadBatchRecord {
  return {
    id: row.id,
    userId: row.user_id,
    folderId: row.folder_id,
    expectedCount: row.expected_count ?? null,
    completedCount: row.completed_count,
    failedCount: row.failed_count,
    status: row.status as UploadBatchRecord['status'],
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
    completedAt: row.completed_at === null ? null : toDate(row.completed_at),
  };
}

function toUploadItemRecord(row: UploadItemRow): UploadItemRecord {
  return {
    id: row.id,
    userId: row.user_id,
    batchId: row.batch_id,
    clientIdempotencyKey: row.client_idempotency_key,
    originalName: row.original_name,
    status: row.status as UploadItemRecord['status'],
    fileId: row.file_id ?? null,
    errorCode: row.error_code ?? null,
    createdAt: toDate(row.created_at),
    updatedAt: toDate(row.updated_at),
  };
}

export class SqliteLibraryService implements LibraryServiceContract {
  private readonly db: Database.Database;
  private readonly storageRoot: string;

  public constructor(db: Database.Database, storageRoot: string) {
    this.db = db;
    this.storageRoot = storageRoot;
  }

  public async ensureUserRootFolder(userId: string): Promise<FolderRecord> {
    const existing = queryOptionalRow<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at
       FROM folders
       WHERE user_id = ? AND is_root = 1`,
      [userId],
    );
    if (existing !== null) {
      return toFolderRecord(existing);
    }

    const rootRelPath = buildRootStorageRelPath(userId);
    const absolutePath = ensureWithinStorageRoot(this.storageRoot, rootRelPath);
    fs.mkdirSync(absolutePath, { recursive: true });

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO folders (id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at)
         VALUES (?, ?, NULL, 'Root', 1, ?, ?, ?)`,
      )
      .run(id, userId, rootRelPath, now, now);

    const row = queryRequiredRow<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at
       FROM folders WHERE id = ?`,
      [id],
    );

    return toFolderRecord(row);
  }

  public async getRootFolder(userId: string): Promise<FolderRecord> {
    const row = queryOptionalRow<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at
       FROM folders WHERE user_id = ? AND is_root = 1`,
      [userId],
    );
    if (row === null) {
      throw new NotFoundError('Root folder not found.');
    }

    return toFolderRecord(row);
  }

  public async listFolders(userId: string): Promise<FolderTreeFolder[]> {
    const folders = queryRows<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folders WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY display_name`,
      [userId],
    );

    const fileCounts = queryRows<FileCountRow>(
      this.db,
      `SELECT folder_id, COUNT(*) AS count
       FROM files WHERE user_id = ? AND deleted_at IS NULL
       GROUP BY folder_id`,
      [userId],
    );
    const fileCountByFolderId = new Map<string, number>();
    for (const entry of fileCounts) {
      fileCountByFolderId.set(entry.folder_id, entry.count);
    }

    const childCountByParentId = new Map<string, number>();
    for (const folder of folders) {
      if (folder.parent_folder_id === null) {
        continue;
      }
      childCountByParentId.set(
        folder.parent_folder_id,
        (childCountByParentId.get(folder.parent_folder_id) ?? 0) + 1,
      );
    }

    return folders.map((row) => {
      const folder = toFolderRecord(row);
      return {
        folder,
        itemCount:
          (childCountByParentId.get(folder.id) ?? 0) +
          (fileCountByFolderId.get(folder.id) ?? 0),
      };
    });
  }

  public async getSharedFolders(userId: string): Promise<FolderTreeFolder[]> {
    const folders = queryRows<FolderRow>(
      this.db,
      `SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at, f.deleted_at
       FROM folders f
       INNER JOIN shared_folder_members sfm ON sfm.folder_id = f.id
       WHERE sfm.user_id = ? AND f.deleted_at IS NULL
       ORDER BY f.display_name`,
      [userId],
    );

    const fileCounts = queryRows<FileCountRow>(
      this.db,
      `SELECT f.folder_id, COUNT(*) AS count
       FROM files f
       INNER JOIN shared_folder_members sfm ON sfm.folder_id = f.folder_id
       WHERE sfm.user_id = ? AND f.deleted_at IS NULL
       GROUP BY f.folder_id`,
      [userId],
    );
    const fileCountByFolderId = new Map<string, number>();
    for (const entry of fileCounts) {
      fileCountByFolderId.set(entry.folder_id, entry.count);
    }

    const childCountByParentId = new Map<string, number>();
    for (const folder of folders) {
      if (folder.parent_folder_id === null) {
        continue;
      }
      childCountByParentId.set(
        folder.parent_folder_id,
        (childCountByParentId.get(folder.parent_folder_id) ?? 0) + 1,
      );
    }

    return folders.map((row) => {
      const folder = toFolderRecord(row);
      return {
        folder,
        itemCount:
          (childCountByParentId.get(folder.id) ?? 0) +
          (fileCountByFolderId.get(folder.id) ?? 0),
      };
    });
  }

  public async createFolder(userId: string, input: CreateFolderInput): Promise<FolderRecord> {
    const normalizedName = ensureValidDisplayName(input.name);
    const parentFolder = await this.getFolder(userId, input.parentFolderId);

    this.assertSiblingFolderNameAvailable(userId, parentFolder.id, normalizedName, null);

    const id = randomUUID();
    const storageRelPath = buildFolderStorageRelPath(parentFolder.storageRelPath, id);
    const now = new Date().toISOString();

    fs.mkdirSync(this.resolveAbsolutePath(storageRelPath), { recursive: true });

    this.db
      .prepare(
        `INSERT INTO folders (id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, ?, ?, ?)`,
      )
      .run(id, userId, parentFolder.id, normalizedName, storageRelPath, now, now);

    const row = queryRequiredRow<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at
       FROM folders WHERE id = ?`,
      [id],
    );

    return toFolderRecord(row);
  }

  public async getFolder(userId: string, folderId: string): Promise<FolderRecord> {
    const row = queryOptionalRow<FolderRow>(
      this.db,
      `SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at
       FROM folders f
       LEFT JOIN shared_folder_members sfm ON sfm.folder_id = f.id AND sfm.user_id = ?
       WHERE f.id = ? AND (f.user_id = ? OR sfm.user_id IS NOT NULL)`,
      [userId, folderId, userId],
    );
    if (row === null) {
      throw new NotFoundError('Folder not found.');
    }

    return toFolderRecord(row);
  }

  public async updateFolder(userId: string, folderId: string, input: UpdateFolderInput): Promise<FolderRecord> {
    if (input.name === undefined && input.parentFolderId === undefined) {
      throw new BadRequestError('At least one folder field must be provided.');
    }

    const folder = await this.getFolder(userId, folderId);

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be modified.');
    }

    const isShared = this.folderIsSharedWithUser(folderId, userId);
    const ownerId = folder.userId;

    const nextName = input.name === undefined ? folder.displayName : ensureValidDisplayName(input.name);
    const nextParentFolderId = input.parentFolderId ?? folder.parentFolderId;

    if (nextParentFolderId === null) {
      throw new BadRequestError('parentFolderId must be provided.');
    }

    const nextParentFolder = await this.getFolder(userId, nextParentFolderId);
    const didMove = folder.parentFolderId !== nextParentFolder.id;

    if (didMove) {
      this.assertFolderMoveIsValid(folder, nextParentFolder.id);
    }

    this.assertSiblingFolderNameAvailable(ownerId, nextParentFolder.id, nextName, folder.id);

    if (!didMove) {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE folders SET display_name = ?, updated_at = ? WHERE id = ?')
        .run(nextName, now, folderId);

      return this.getFolder(userId, folderId);
    }

    const currentStorageRelPath = folder.storageRelPath;
    const nextStorageRelPath = buildFolderStorageRelPath(
      nextParentFolder.storageRelPath,
      folder.id,
    );
    const now = new Date().toISOString();

    withTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE folders
           SET storage_rel_path = ? || SUBSTR(storage_rel_path, ?), updated_at = ?
           WHERE ${isShared ? '' : 'user_id = ? AND '}storage_rel_path LIKE ?`,
        )
        .run(
          nextStorageRelPath,
          currentStorageRelPath.length + 1,
          now,
          ...(isShared ? [] : [userId]),
          `${currentStorageRelPath}/%`,
        );

      this.db
        .prepare(
          `UPDATE files
           SET storage_rel_path = ? || SUBSTR(storage_rel_path, ?), updated_at = ?
           WHERE ${isShared ? '' : 'user_id = ? AND '}storage_rel_path LIKE ?`,
        )
        .run(
          nextStorageRelPath,
          currentStorageRelPath.length + 1,
          now,
          ...(isShared ? [] : [userId]),
          `${currentStorageRelPath}/%`,
        );

      this.db
        .prepare(
          `UPDATE folders
           SET display_name = ?, parent_folder_id = ?, storage_rel_path = ?, updated_at = ?
           WHERE id = ?`,
        )
        .run(nextName, nextParentFolder.id, nextStorageRelPath, now, folderId);
    });

    try {
      await mkdir(this.resolveAbsolutePath(nextParentFolder.storageRelPath), {
        recursive: true,
      });
      await rename(
        this.resolveAbsolutePath(currentStorageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );
    } catch (error) {
      const rollbackNow = new Date().toISOString();

      withTransaction(this.db, () => {
        this.db
          .prepare(
            `UPDATE folders
             SET storage_rel_path = ? || SUBSTR(storage_rel_path, ?), updated_at = ?
             WHERE ${isShared ? '' : 'user_id = ? AND '}storage_rel_path LIKE ?`,
          )
          .run(
            currentStorageRelPath,
            nextStorageRelPath.length + 1,
            rollbackNow,
            ...(isShared ? [] : [userId]),
            `${nextStorageRelPath}/%`,
          );

        this.db
          .prepare(
            `UPDATE files
             SET storage_rel_path = ? || SUBSTR(storage_rel_path, ?), updated_at = ?
             WHERE ${isShared ? '' : 'user_id = ? AND '}storage_rel_path LIKE ?`,
          )
          .run(
            currentStorageRelPath,
            nextStorageRelPath.length + 1,
            rollbackNow,
            ...(isShared ? [] : [userId]),
            `${nextStorageRelPath}/%`,
          );

        this.db
          .prepare(
            `UPDATE folders
             SET display_name = ?, parent_folder_id = ?, storage_rel_path = ?, updated_at = ?
             WHERE id = ?`,
          )
          .run(folder.displayName, folder.parentFolderId, currentStorageRelPath, rollbackNow, folderId);
      });

      throw error;
    }

    return this.getFolder(userId, folderId);
  }

  public async deleteFolder(userId: string, folderId: string, recursive: boolean): Promise<void> {
    const folder = await this.getFolder(userId, folderId);

    if (folder.isRoot) {
      throw new ConflictError('The root folder cannot be deleted.');
    }

    const isShared = this.folderIsSharedWithUser(folderId, userId);
    const ownerId = folder.userId;

    const descendantRows = queryRows<FolderRow>(
      this.db,
      `WITH RECURSIVE folder_tree AS (
         SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
         FROM folders WHERE id = ?${isShared ? '' : ' AND user_id = ?'}
         UNION ALL
         SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at, f.deleted_at
         FROM folders f
         INNER JOIN folder_tree t ON f.parent_folder_id = t.id
       )
       SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folder_tree WHERE id <> ?`,
      isShared ? [folderId, folderId] : [folderId, userId, userId, folderId],
    );

    const allFolders = [folder, ...descendantRows.map(toFolderRecord)];
    const descendantFolderIds = allFolders.map((f) => f.id);

    const filesInFolders = queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`,
      descendantFolderIds,
    );

    // If already in trash, permanently delete
    if (folder.deletedAt !== null) {
      await this.hardDeleteFoldersAndFiles(userId, allFolders, filesInFolders, descendantFolderIds, isShared);
      return;
    }

    if (!recursive && (descendantRows.length > 0 || filesInFolders.length > 0)) {
      throw new ConflictError('Folder is not empty.');
    }

    // Soft-delete: set deleted_at on folder, all descendants, and their files
    const now = new Date().toISOString();
    withTransaction(this.db, () => {
      for (const folderRecord of allFolders) {
        this.db
          .prepare('UPDATE folders SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, folderRecord.id);
      }

      for (const file of filesInFolders) {
        this.db
          .prepare('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?')
          .run(now, now, file.id);
      }
    });

    // Remove files from disk to free space
    for (const file of filesInFolders) {
      await this.safeUnlink(file.storage_rel_path);
    }
  }

  private hardDeleteFoldersAndFiles(
    userId: string,
    allFolders: FolderRecord[],
    filesInFolders: FileRow[],
    descendantFolderIds: string[],
    isShared: boolean,
  ): Promise<void> {
    const fileIds = filesInFolders.map((f) => f.id);

    withTransaction(this.db, () => {
      if (fileIds.length > 0) {
        const effectiveUserId = isShared ? allFolders[0]?.userId ?? userId : userId;
        this.db
          .prepare(
            `UPDATE upload_items
             SET file_id = NULL, status = 'pending', updated_at = datetime('now')
             WHERE file_id IN (${fileIds.map(() => '?').join(',')})
             AND user_id = ?`,
          )
          .run(...fileIds, effectiveUserId);
      }

      this.db
        .prepare(
          `DELETE FROM upload_batches WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`,
        )
        .run(...descendantFolderIds);

      for (const file of filesInFolders) {
        this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
        this.db
          .prepare(
            `UPDATE user_storage_usage
             SET used_bytes = MAX(0, used_bytes - ?)
             WHERE user_id = ?`,
          )
          .run(file.size_bytes, file.user_id);

        this.db
          .prepare(
            `UPDATE shared_folder_storage
             SET used_bytes = MAX(0, used_bytes - ?)
             WHERE folder_id = ?`,
          )
          .run(file.size_bytes, file.folder_id);

        this.safeUnlink(file.storage_rel_path).catch(() => undefined);
      }

      for (const folderRecord of allFolders) {
        this.db.prepare('DELETE FROM folders WHERE id = ?').run(folderRecord.id);
      }
    });

    const sortedFolders = [...allFolders].sort(
      (a, b) =>
        b.storageRelPath.split('/').length - a.storageRelPath.split('/').length,
    );

    const promises = sortedFolders.map(async (folderRecord) => {
      try {
        await rm(this.resolveAbsolutePath(folderRecord.storageRelPath), {
          force: true,
          recursive: false,
        });
      } catch {
        // Directory may not exist
      }
    });

    return Promise.all(promises).then(() => undefined);
  }

  public async getFolderEntries(
    userId: string,
    folderId: string,
    input: GetFolderEntriesInput,
  ): Promise<FolderEntries> {
    const folder = await this.getFolder(userId, folderId);
    const isShared = this.folderIsSharedWithUser(folderId, userId);

    const folders = queryRows<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folders WHERE parent_folder_id = ?${isShared ? '' : ' AND user_id = ?'} AND deleted_at IS NULL
       ORDER BY display_name`,
      isShared ? [folderId] : [folderId, userId],
    ).map(toFolderRecord);

    const scopeFolderIds =
      input.searchIncludesDirectChildren && input.search.length > 0
        ? [folderId, ...folders.map((entry) => entry.id)]
        : [folderId];
    const whereClauses = [
      `folder_id IN (${scopeFolderIds.map(() => '?').join(', ')})`,
      'deleted_at IS NULL',
    ];
    const whereParams: unknown[] = [...scopeFolderIds];

    if (!isShared) {
      whereClauses.push('user_id = ?');
      whereParams.push(userId);
    }

    if (input.search.length > 0) {
      whereClauses.push(`LOWER(display_name) LIKE ? ESCAPE '\\'`);
      whereParams.push(`%${escapeLikePattern(input.search.toLowerCase())}%`);
    }

    const mediaKindClause = getMediaKindWhereClause(input.typeFilter);
    if (mediaKindClause !== null) {
      whereClauses.push(`(${mediaKindClause})`);
    }

    if (input.extensionFilter !== 'all') {
      whereClauses.push(`display_name COLLATE NOCASE LIKE ? ESCAPE '\\'`);
      whereParams.push(`%.${escapeLikePattern(input.extensionFilter)}`);
    }

    const whereSql = whereClauses.join(' AND ');
    const totalFileCount = queryRequiredRow<CountRow>(
      this.db,
      `SELECT COUNT(*) AS count FROM files WHERE ${whereSql}`,
      whereParams,
    ).count;
    const files = queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE ${whereSql}
       ORDER BY ${getFileOrderByClause(input.sortField, input.sortDirection)}
       LIMIT ? OFFSET ?`,
      [...whereParams, input.limit, input.offset],
    ).map(toFileRecord);
    const currentFolderFileNames = queryRows<{ display_name: string }>(
      this.db,
      `SELECT display_name FROM files
       WHERE folder_id = ?${isShared ? '' : ' AND user_id = ?'} AND deleted_at IS NULL
       ORDER BY display_name COLLATE NOCASE`,
      isShared ? [folderId] : [folderId, userId],
    ).map((row) => row.display_name);
    const availableExtensions = [...new Set(
      currentFolderFileNames
        .map((name) => extractFileExtension(name))
        .filter((extension) => extension.length > 0),
    )].sort((left, right) => left.localeCompare(right));
    const nextOffset = input.offset + files.length < totalFileCount
      ? input.offset + files.length
      : null;

    return {
      availableExtensions,
      existingFileNames: currentFolderFileNames,
      files,
      folder,
      folders,
      nextOffset,
      totalFileCount,
    };
  }

  public async getFilesInFolder(userId: string, folderId: string): Promise<FileRecord[]> {
    const folder = await this.getFolder(userId, folderId);
    const isShared = this.folderIsSharedWithUser(folderId, userId);

    return queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE folder_id = ?${isShared ? '' : ' AND user_id = ?'} AND deleted_at IS NULL
       ORDER BY display_name`,
      isShared ? [folder.id] : [folder.id, userId],
    ).map(toFileRecord);
  }

  public async getFile(userId: string, fileId: string): Promise<FileRecord> {
    const row = queryOptionalRow<FileRow>(
      this.db,
      `SELECT f.* FROM files f
       LEFT JOIN shared_folder_members sfm ON sfm.folder_id = f.folder_id AND sfm.user_id = ?
       WHERE f.id = ? AND f.deleted_at IS NULL AND (f.user_id = ? OR sfm.user_id IS NOT NULL)`,
      [userId, fileId, userId],
    );
    if (row === null) {
      throw new NotFoundError('File not found.');
    }

    return toFileRecord(row);
  }

  public async getFileReadDescriptor(userId: string, fileId: string): Promise<FileReadDescriptor> {
    const file = await this.getFile(userId, fileId);
    const absolutePath = this.resolveAbsolutePath(file.storageRelPath);

    return { absolutePath, file, sizeBytes: file.sizeBytes };
  }

  public async createUploadBatch(userId: string, input: CreateUploadBatchInput): Promise<UploadBatchRecord> {
    if (
      input.expectedCount !== undefined &&
      (!Number.isInteger(input.expectedCount) || input.expectedCount <= 0)
    ) {
      throw new BadRequestError('expectedCount must be a positive integer.');
    }

    await this.getFolder(userId, input.folderId);

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO upload_batches (id, user_id, folder_id, expected_count, completed_count, failed_count, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, 0, 0, 'open', ?, ?)`,
      )
      .run(id, userId, input.folderId, input.expectedCount ?? null, now, now);

    const row = queryRequiredRow<UploadBatchRow>(
      this.db,
      'SELECT * FROM upload_batches WHERE id = ?',
      [id],
    );

    return toUploadBatchRecord(row);
  }

  public async createUploadItem(
    userId: string,
    batchId: string,
    input: CreateUploadItemInput,
  ): Promise<UploadItemRecord> {
    const batchRow = queryOptionalRow<UploadBatchRow>(
      this.db,
      'SELECT * FROM upload_batches WHERE id = ? AND user_id = ?',
      [batchId, userId],
    );
    if (batchRow === null) {
      throw new NotFoundError('Upload batch not found.');
    }

    const clientIdempotencyKey = input.clientIdempotencyKey.trim();
    if (clientIdempotencyKey === '') {
      throw new BadRequestError('clientIdempotencyKey must not be empty.');
    }

    const originalName = ensureValidDisplayName(input.originalName);

    const existingItem = queryOptionalRow<UploadItemRow>(
      this.db,
      `SELECT * FROM upload_items
       WHERE user_id = ? AND batch_id = ? AND client_idempotency_key = ?`,
      [userId, batchId, clientIdempotencyKey],
    );

    if (existingItem !== null) {
      return toUploadItemRecord(existingItem);
    }

    const id = randomUUID();
    const now = new Date().toISOString();

    this.db
      .prepare(
        `INSERT INTO upload_items (id, user_id, batch_id, client_idempotency_key, original_name, status, file_id, error_code, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'pending', NULL, NULL, ?, ?)`,
      )
      .run(id, userId, batchId, clientIdempotencyKey, originalName, now, now);

    const row = queryRequiredRow<UploadItemRow>(
      this.db,
      'SELECT * FROM upload_items WHERE id = ?',
      [id],
    );

    return toUploadItemRecord(row);
  }

  public async getUploadBatch(userId: string, batchId: string): Promise<UploadBatchSnapshot> {
    const batchRow = queryOptionalRow<UploadBatchRow>(
      this.db,
      'SELECT * FROM upload_batches WHERE id = ? AND user_id = ?',
      [batchId, userId],
    );
    if (batchRow === null) {
      throw new NotFoundError('Upload batch not found.');
    }

    const items = queryRows<UploadItemRow>(
      this.db,
      'SELECT * FROM upload_items WHERE batch_id = ? ORDER BY created_at',
      [batchId],
    );

    return {
      batch: toUploadBatchRecord(batchRow),
      items: items.map(toUploadItemRecord),
    };
  }

  public async uploadItemContent(
    userId: string,
    itemId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord> {
    if (multipartFile === undefined) {
      throw new BadRequestError('Multipart file is required.');
    }

    const itemRow = queryOptionalRow<UploadItemRow>(
      this.db,
      'SELECT * FROM upload_items WHERE id = ? AND user_id = ?',
      [itemId, userId],
    );
    if (itemRow === null) {
      throw new NotFoundError('Upload item not found.');
    }

    const item = toUploadItemRecord(itemRow);

    if (item.status === 'complete' && item.fileId !== null) {
      return this.getFile(userId, item.fileId);
    }

    if (item.status === 'uploading') {
      throw new ConflictError('Upload item is already processing.');
    }

    const batchRow = queryRequiredRow<UploadBatchRow>(
      this.db,
      'SELECT * FROM upload_batches WHERE id = ? AND user_id = ?',
      [item.batchId, userId],
    );
    const batch = toUploadBatchRecord(batchRow);

    if (batch.status !== 'open') {
      throw new BadRequestError('Upload batch is not open.');
    }

    const folder = await this.getFolder(userId, batch.folderId);
    const effectiveOriginalName = ensureValidDisplayName(
      multipartFile.filename.trim() === '' ? item.originalName : multipartFile.filename,
    );
    const displayName = this.resolveAvailableFileName(userId, folder.id, effectiveOriginalName, null);

    const tempStorageRelPath = path.posix.join(
      buildRootStorageRelPath(userId),
      '_tmp',
      `${item.id}.part`,
    );
    const tempAbsolutePath = this.resolveAbsolutePath(tempStorageRelPath);
    const fileId = randomUUID();
    const storedExtension = getStoredExtension(effectiveOriginalName);
    const finalStorageRelPath = buildFileStorageRelPath(
      folder.storageRelPath,
      fileId,
      storedExtension,
    );
    const now = new Date().toISOString();

    // Claim the item for processing
    const claimResult = this.db
      .prepare(
        `UPDATE upload_items
         SET status = 'uploading', error_code = NULL, updated_at = ?
         WHERE id = ? AND user_id = ? AND status IN ('pending', 'failed')
         RETURNING id`,
      )
      .get(now, itemId, userId);

    if (claimResult === undefined) {
      const currentItem = queryOptionalRow<UploadItemRow>(
        this.db,
        'SELECT * FROM upload_items WHERE id = ? AND user_id = ?',
        [itemId, userId],
      );

      if (currentItem !== null) {
        const current = toUploadItemRecord(currentItem);
        if (current.status === 'complete' && current.fileId !== null) {
          return this.getFile(userId, current.fileId);
        }
        if (current.status === 'uploading') {
          throw new ConflictError('Upload item is already processing.');
        }
      }

      throw new ConflictError('Upload item could not be claimed for processing.');
    }

    this.ensureStorageUsageRow(userId);

    const isSharedFolder = this.folderIsSharedWithUser(folder.id, userId);
    if (isSharedFolder) {
      this.ensureSharedFolderStorageRow(folder.id);
    }

    await mkdir(path.dirname(tempAbsolutePath), { recursive: true });
    await mkdir(this.resolveAbsolutePath(folder.storageRelPath), {
      recursive: true,
    });

    try {
      const uploadStats = await this.streamMultipartFile(multipartFile, tempAbsolutePath);

      const usageRow = queryRequiredRow<StorageUsageRow>(
        this.db,
        'SELECT user_id, used_bytes, quota_bytes FROM user_storage_usage WHERE user_id = ?',
        [userId],
      );

      if (usageRow.used_bytes + uploadStats.sizeBytes > usageRow.quota_bytes) {
        throw new BadRequestError('Storage quota exceeded.');
      }

      if (isSharedFolder) {
        const sharedUsageRow = queryRequiredRow<{ used_bytes: number; quota_bytes: number }>(
          this.db,
          'SELECT used_bytes, quota_bytes FROM shared_folder_storage WHERE folder_id = ?',
          [folder.id],
        );
        if (sharedUsageRow.used_bytes + uploadStats.sizeBytes > sharedUsageRow.quota_bytes) {
          throw new BadRequestError('Shared folder storage quota exceeded.');
        }
      }

      await rename(tempAbsolutePath, this.resolveAbsolutePath(finalStorageRelPath));

      const fileRecord = withTransaction(this.db, () => {
        const createdFile = this.db
          .prepare(
            `INSERT INTO files (
               id, user_id, folder_id, display_name, original_name, stored_extension,
               mime_type, size_bytes, sha256, status, storage_rel_path, created_at, updated_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?, ?)`,
          )
          .run(
            fileId,
            userId,
            folder.id,
            displayName,
            displayName,
            storedExtension,
            multipartFile.mimetype || 'application/octet-stream',
            uploadStats.sizeBytes,
            uploadStats.sha256,
            finalStorageRelPath,
            now,
            now,
          );

        if (createdFile.changes !== 1) {
          throw new Error('Failed to insert file record.');
        }

        const updateResult = this.db
          .prepare(
            `UPDATE upload_items
             SET error_code = NULL, file_id = ?, original_name = ?, status = 'complete', updated_at = ?
             WHERE id = ? AND status = 'uploading' AND user_id = ?`,
          )
          .run(fileId, displayName, new Date().toISOString(), itemId, userId);

        if (updateResult.changes !== 1) {
          throw new ConflictError('Upload item could not be completed.');
        }

        this.db
          .prepare(
            'UPDATE user_storage_usage SET used_bytes = used_bytes + ? WHERE user_id = ?',
          )
          .run(uploadStats.sizeBytes, userId);

        if (isSharedFolder) {
          this.db
            .prepare(
              'UPDATE shared_folder_storage SET used_bytes = used_bytes + ? WHERE folder_id = ?',
            )
            .run(uploadStats.sizeBytes, folder.id);
        }

        this.refreshBatchStatus(batch.id);

        const fileRow = queryRequiredRow<FileRow>(
          this.db,
          'SELECT * FROM files WHERE id = ?',
          [fileId],
        );

        return toFileRecord(fileRow);
      });

      return fileRecord;
    } catch (error) {
      const errorNow = new Date().toISOString();
      const errorCode = this.getUploadErrorCode(error);

      this.db
        .prepare(
          `UPDATE upload_items
           SET error_code = ?, status = 'failed', updated_at = ?
           WHERE id = ? AND status = 'uploading' AND user_id = ?`,
        )
        .run(errorCode, errorNow, itemId, userId);

      this.refreshBatchStatus(batch.id);
      await this.safeUnlink(tempStorageRelPath);
      await this.safeUnlink(finalStorageRelPath);

      throw error;
    }
  }

  public async updateFileContent(
    userId: string,
    fileId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord> {
    if (multipartFile === undefined) {
      throw new BadRequestError('Multipart file is required.');
    }

    const file = await this.getFile(userId, fileId);

    this.ensureStorageUsageRow(userId);

    const isSharedFolder = this.folderIsSharedWithUser(file.folderId, userId);
    if (isSharedFolder) {
      this.ensureSharedFolderStorageRow(file.folderId);
    }

    const tempStorageRelPath = path.posix.join(
      buildRootStorageRelPath(userId),
      '_tmp',
      `${fileId}.${randomUUID()}.part`,
    );
    const tempAbsolutePath = this.resolveAbsolutePath(tempStorageRelPath);
    const now = new Date().toISOString();

    await mkdir(path.dirname(tempAbsolutePath), { recursive: true });
    await mkdir(path.dirname(this.resolveAbsolutePath(file.storageRelPath)), {
      recursive: true,
    });

    try {
      const uploadStats = await this.streamMultipartFile(multipartFile, tempAbsolutePath);

      const usageRow = queryRequiredRow<StorageUsageRow>(
        this.db,
        'SELECT user_id, used_bytes, quota_bytes FROM user_storage_usage WHERE user_id = ?',
        [userId],
      );

      const sizeDelta = uploadStats.sizeBytes - file.sizeBytes;
      if (usageRow.used_bytes + sizeDelta > usageRow.quota_bytes) {
        throw new BadRequestError('Storage quota exceeded.');
      }

      if (isSharedFolder && sizeDelta > 0) {
        const sharedUsageRow = queryRequiredRow<{ used_bytes: number; quota_bytes: number }>(
          this.db,
          'SELECT used_bytes, quota_bytes FROM shared_folder_storage WHERE folder_id = ?',
          [file.folderId],
        );
        if (sharedUsageRow.used_bytes + sizeDelta > sharedUsageRow.quota_bytes) {
          throw new BadRequestError('Shared folder storage quota exceeded.');
        }
      }

      const newExtension = getStoredExtension(multipartFile.filename || file.displayName);
      const finalStorageRelPath = buildFileStorageRelPath(
        path.posix.dirname(file.storageRelPath),
        fileId,
        newExtension,
      );

      await rename(tempAbsolutePath, this.resolveAbsolutePath(finalStorageRelPath));

      const fileRecord = withTransaction(this.db, () => {
        const updateResult = this.db
          .prepare(
            `UPDATE files
             SET mime_type = ?, size_bytes = ?, sha256 = ?, stored_extension = ?, storage_rel_path = ?, deleted_at = NULL, updated_at = ?
             WHERE id = ?`,
          )
          .run(
            multipartFile.mimetype || file.mimeType,
            uploadStats.sizeBytes,
            uploadStats.sha256,
            newExtension,
            finalStorageRelPath,
            now,
            fileId,
          );

        if (updateResult.changes !== 1) {
          throw new NotFoundError('File not found.');
        }

        this.db
          .prepare(
            'UPDATE user_storage_usage SET used_bytes = used_bytes + ? WHERE user_id = ?',
          )
          .run(sizeDelta, file.userId);

        if (isSharedFolder) {
          this.db
            .prepare(
              'UPDATE shared_folder_storage SET used_bytes = MAX(0, used_bytes + ?) WHERE folder_id = ?',
            )
            .run(sizeDelta, file.folderId);
        }

        const fileRow = queryRequiredRow<FileRow>(
          this.db,
          'SELECT * FROM files WHERE id = ?',
          [fileId],
        );

        return toFileRecord(fileRow);
      });

      if (finalStorageRelPath !== file.storageRelPath) {
        await this.safeUnlink(file.storageRelPath);
      }

      return fileRecord;
    } catch (error) {
      await this.safeUnlink(tempStorageRelPath);
      throw error;
    }
  }

  public async updateFile(userId: string, fileId: string, input: UpdateFileInput): Promise<FileRecord> {
    if (input.name === undefined && input.folderId === undefined) {
      throw new BadRequestError('At least one file field must be provided.');
    }

    const file = await this.getFile(userId, fileId);
    const nextName = input.name === undefined ? file.displayName : ensureValidDisplayName(input.name);
    const nextFolderId = input.folderId ?? file.folderId;
    const didMove = nextFolderId !== file.folderId;

    const uniqueName = this.resolveAvailableFileName(userId, nextFolderId, nextName, fileId);

    if (!didMove) {
      const now = new Date().toISOString();
      this.db
        .prepare('UPDATE files SET display_name = ?, updated_at = ? WHERE id = ?')
        .run(uniqueName, now, fileId);

      return this.getFile(userId, fileId);
    }

    const nextFolder = await this.getFolder(userId, nextFolderId);
    const nextStorageRelPath = buildFileStorageRelPath(
      nextFolder.storageRelPath,
      file.id,
      file.storedExtension,
    );
    const now = new Date().toISOString();

    await mkdir(this.resolveAbsolutePath(nextFolder.storageRelPath), {
      recursive: true,
    });

    try {
      await rename(
        this.resolveAbsolutePath(file.storageRelPath),
        this.resolveAbsolutePath(nextStorageRelPath),
      );
    } catch {
      throw new ConflictError('File content is missing on disk.');
    }

    const updateResult = this.db
      .prepare(
        `UPDATE files
         SET display_name = ?, folder_id = ?, storage_rel_path = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(uniqueName, nextFolder.id, nextStorageRelPath, now, fileId);

    if (updateResult.changes !== 1) {
      // Roll back the disk move
      await rename(
        this.resolveAbsolutePath(nextStorageRelPath),
        this.resolveAbsolutePath(file.storageRelPath),
      ).catch(() => undefined);

      throw new NotFoundError('File not found.');
    }

    const row = queryRequiredRow<FileRow>(
      this.db,
      'SELECT * FROM files WHERE id = ?',
      [fileId],
    );

    return toFileRecord(row);
  }

  public async deleteFile(userId: string, fileId: string): Promise<void> {
    const file = await this.getFile(userId, fileId);

    if (file.deletedAt !== null) {
      // Already in trash — permanently delete
      this.hardDeleteFile(file);
      return;
    }

    // Soft-delete: move to trash
    const now = new Date().toISOString();
    this.db
      .prepare('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?')
      .run(now, now, file.id);

    await this.safeUnlink(file.storageRelPath);
  }

  private hardDeleteFile(file: FileRecord): void {
    const now = new Date().toISOString();

    withTransaction(this.db, () => {
      this.db
        .prepare(
          `UPDATE upload_items
           SET file_id = NULL, status = 'pending', updated_at = ?
           WHERE file_id = ?`,
        )
        .run(now, file.id);

      this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id);

      this.db
        .prepare(
          `UPDATE user_storage_usage
           SET used_bytes = MAX(0, used_bytes - ?)
           WHERE user_id = ?`,
        )
        .run(file.sizeBytes, file.userId);

      // Also decrement shared folder storage if applicable
      this.db
        .prepare(
          `UPDATE shared_folder_storage
           SET used_bytes = MAX(0, used_bytes - ?)
           WHERE folder_id = ?`,
        )
        .run(file.sizeBytes, file.folderId);
    });
  }

  private folderIsSharedWithUser(folderId: string, userId: string): boolean {
    const row = queryOptionalRow<IdRow>(
      this.db,
      'SELECT folder_id AS id FROM shared_folder_members WHERE folder_id = ? AND user_id = ?',
      [folderId, userId],
    );
    return row !== null;
  }

  private assertFolderMoveIsValid(folder: FolderRecord, nextParentFolderId: string): void {
    if (folder.id === nextParentFolderId) {
      throw new BadRequestError('A folder cannot become its own parent.');
    }

    const descendantIds = queryRows<IdRow>(
      this.db,
      `WITH RECURSIVE folder_tree AS (
         SELECT id FROM folders WHERE parent_folder_id = ?
         UNION ALL
         SELECT f.id FROM folders f INNER JOIN folder_tree t ON f.parent_folder_id = t.id
       )
       SELECT id FROM folder_tree`,
      [folder.id],
    );

    if (descendantIds.some((row) => row.id === nextParentFolderId)) {
      throw new BadRequestError('A folder cannot move inside one of its descendants.');
    }
  }

  private assertSiblingFolderNameAvailable(
    userId: string,
    parentFolderId: string,
    displayName: string,
    currentFolderId: string | null,
  ): void {
    const isShared = this.folderIsSharedWithUser(parentFolderId, userId);
    let conflict: { id: string } | null;
    const deletedClause = ' AND deleted_at IS NULL';
    if (currentFolderId === null) {
      conflict = queryOptionalRow<IdRow>(
        this.db,
        `SELECT id FROM folders
         WHERE ${isShared ? '' : 'user_id = ? AND '}parent_folder_id = ? AND display_name = ?${deletedClause}
         LIMIT 1`,
        isShared ? [parentFolderId, displayName] : [userId, parentFolderId, displayName],
      );
    } else {
      conflict = queryOptionalRow<IdRow>(
        this.db,
        `SELECT id FROM folders
         WHERE ${isShared ? '' : 'user_id = ? AND '}parent_folder_id = ? AND display_name = ? AND id <> ?${deletedClause}
         LIMIT 1`,
        isShared ? [parentFolderId, displayName, currentFolderId] : [userId, parentFolderId, displayName, currentFolderId],
      );
    }

    if (conflict !== null) {
      throw new ConflictError('A sibling folder already uses that name.');
    }
  }

  private resolveAvailableFileName(
    userId: string,
    folderId: string,
    desiredName: string,
    excludeFileId: string | null,
  ): string {
    const isShared = this.folderIsSharedWithUser(folderId, userId);
    const params: unknown[] = isShared
      ? (excludeFileId !== null ? [folderId, excludeFileId] : [folderId])
      : (excludeFileId !== null ? [userId, folderId, excludeFileId] : [userId, folderId]);
    const existingNames = queryRows<{ display_name: string }>(
      this.db,
      `SELECT display_name FROM files
       WHERE ${isShared ? '' : 'user_id = ? AND '}folder_id = ? AND deleted_at IS NULL
       ${excludeFileId !== null ? 'AND id <> ?' : ''}`,
      params,
    );

    const taken = new Set(existingNames.map((r) => r.display_name));

    if (!taken.has(desiredName)) {
      return desiredName;
    }

    const dotIndex = desiredName.lastIndexOf('.');
    const base = dotIndex <= 0 ? desiredName : desiredName.slice(0, dotIndex);
    const ext = dotIndex <= 0 ? '' : desiredName.slice(dotIndex);

    let counter = 1;
    while (taken.has(`${base} (${counter})${ext}`)) {
      counter++;
    }

    return `${base} (${counter})${ext}`;
  }

  private ensureStorageUsageRow(userId: string): void {
    const existing = queryOptionalRow<StorageUsageRow>(
      this.db,
      'SELECT user_id, used_bytes, quota_bytes FROM user_storage_usage WHERE user_id = ?',
      [userId],
    );
    if (existing === null) {
      this.db
        .prepare(
          'INSERT INTO user_storage_usage (user_id, used_bytes, quota_bytes) VALUES (?, 0, ?)',
        )
        .run(userId, DEFAULT_QUOTA_BYTES);
    }
  }

  private ensureSharedFolderStorageRow(folderId: string): void {
    const existing = queryOptionalRow<{ folder_id: string }>(
      this.db,
      'SELECT folder_id FROM shared_folder_storage WHERE folder_id = ?',
      [folderId],
    );
    if (existing === null) {
      this.db
        .prepare(
          'INSERT INTO shared_folder_storage (folder_id, used_bytes, quota_bytes) VALUES (?, 0, 53687091200)',
        )
        .run(folderId);
    }
  }

  private getUploadErrorCode(error: unknown): string {
    if (error instanceof MulterError) {
      return error.code;
    }

    return 'UPLOAD_FAILED';
  }

  private refreshBatchStatus(batchId: string): void {
    const batch = queryOptionalRow<UploadBatchRow>(
      this.db,
      'SELECT * FROM upload_batches WHERE id = ?',
      [batchId],
    );
    if (batch === null) {
      return;
    }

    const counts = queryRequiredRow<BatchCountsRow>(
      this.db,
      `SELECT
         COUNT(*) FILTER (WHERE status = 'complete') AS completed_count,
         COUNT(*) FILTER (WHERE status = 'failed') AS failed_count
       FROM upload_items WHERE batch_id = ?`,
      [batchId],
    );

    const processedCount = counts.completed_count + counts.failed_count;
    let nextStatus: string;

    if (batch.expected_count !== null && processedCount >= batch.expected_count) {
      nextStatus = counts.failed_count > 0 ? 'partial' : 'completed';
    } else {
      nextStatus = 'open';
    }

    const completedAt =
      nextStatus === 'open'
        ? null
        : batch.completed_at ?? new Date().toISOString();

    const now = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE upload_batches
         SET completed_count = ?, failed_count = ?, status = ?, completed_at = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(counts.completed_count, counts.failed_count, nextStatus, completedAt, now, batchId);
  }

  private resolveAbsolutePath(storageRelPath: string): string {
    return ensureWithinStorageRoot(this.storageRoot, storageRelPath);
  }

  private async safeUnlink(storageRelPath: string): Promise<void> {
    try {
      await unlink(this.resolveAbsolutePath(storageRelPath));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error as { code: string }).code === 'ENOENT'
      ) {
        return;
      }

      throw error;
    }
  }

  private async streamMultipartFile(
    multipartFile: MultipartFile,
    destinationPath: string,
  ): Promise<{ sha256: string; sizeBytes: number }> {
    let sizeBytes = 0;
    const hash = createHash('sha256');
    const hashTransform = new Transform({
      transform(chunk: Buffer, _encoding: string, callback: (error?: Error | null, data?: Buffer) => void) {
        const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
        hash.update(buffer);
        sizeBytes += buffer.length;
        callback(null, buffer);
      },
    });

    await pipeline(multipartFile.file, hashTransform, createWriteStream(destinationPath));

    if (multipartFile.file.truncated) {
      throw new MulterError('LIMIT_FILE_SIZE', 'file');
    }

    return {
      sha256: hash.digest('hex'),
      sizeBytes,
    };
  }

  public async getTrashedEntries(userId: string): Promise<TrashEntry[]> {
    const folders = queryRows<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [userId],
    );

    const files = queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE user_id = ? AND deleted_at IS NOT NULL
       ORDER BY deleted_at DESC`,
      [userId],
    );

    const trashedParentIds = new Set(folders.map((f) => f.id));

    const folderEntries: TrashEntry[] = folders.map((row) => ({
      id: row.id,
      userId: row.user_id,
      displayName: row.display_name,
      originalName: null,
      mimeType: null,
      sizeBytes: null,
      mediaKind: 'folder',
      folderId: null,
      parentFolderId: row.parent_folder_id,
      storageRelPath: row.storage_rel_path,
      deletedAt: toDate(row.deleted_at!),
      isFolder: true,
    }));

    const fileEntries: TrashEntry[] = files
      .filter((row) => !trashedParentIds.has(row.folder_id))
      .map((row) => ({
        id: row.id,
        userId: row.user_id,
        displayName: row.display_name,
        originalName: row.original_name,
        mimeType: row.mime_type,
        sizeBytes: row.size_bytes,
        mediaKind: row.mime_type.startsWith('image/') ? 'image' : row.mime_type.startsWith('video/') ? 'video' : row.mime_type.startsWith('audio/') ? 'audio' : row.mime_type === 'application/pdf' || row.mime_type.startsWith('text/') ? 'document' : 'other',
        folderId: row.folder_id,
        parentFolderId: null,
        storageRelPath: row.storage_rel_path,
        deletedAt: toDate(row.deleted_at!),
        isFolder: false,
      }));

    return [...folderEntries, ...fileEntries];
  }

  public async restoreTrashEntry(userId: string, itemId: string, isFolder: boolean): Promise<void> {
    if (isFolder) {
      const folder = await this.getFolder(userId, itemId);
      if (folder.deletedAt === null) {
        throw new BadRequestError('Item is not in trash.');
      }

      const descendantRows = queryRows<FolderRow>(
        this.db,
        `WITH RECURSIVE folder_tree AS (
           SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
           FROM folders WHERE id = ? AND user_id = ?
           UNION ALL
           SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at, f.deleted_at
           FROM folders f
           INNER JOIN folder_tree t ON f.parent_folder_id = t.id
           WHERE f.user_id = ?
         )
         SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
         FROM folder_tree`,
        [itemId, userId, userId],
      );

      const allFolders = [folder, ...descendantRows.map(toFolderRecord)];
      const allFolderIds = allFolders.map((f) => f.id);

      const filesInFolders = queryRows<FileRow>(
        this.db,
        `SELECT * FROM files WHERE user_id = ? AND folder_id IN (${allFolderIds.map(() => '?').join(',')})`,
        [userId, ...allFolderIds],
      );

      withTransaction(this.db, () => {
        for (const folderRecord of allFolders) {
          this.db
            .prepare('UPDATE folders SET deleted_at = NULL, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), folderRecord.id);
        }

        for (const file of filesInFolders) {
          this.db
            .prepare('UPDATE files SET deleted_at = NULL, updated_at = ? WHERE id = ?')
            .run(new Date().toISOString(), file.id);
        }
      });
    } else {
      const file = await this.getFile(userId, itemId);
      if (file.deletedAt === null) {
        throw new BadRequestError('Item is not in trash.');
      }

      // Check parent folder is not trashed
      const parentFolder = await this.getFolder(userId, file.folderId);
      if (parentFolder.deletedAt !== null) {
        throw new ConflictError('Cannot restore file: its parent folder is in trash. Restore the folder first.');
      }

      this.db
        .prepare('UPDATE files SET deleted_at = NULL, updated_at = ? WHERE id = ? AND user_id = ?')
        .run(new Date().toISOString(), itemId, userId);
    }
  }

  public async permanentlyDeleteEntry(userId: string, itemId: string, isFolder: boolean): Promise<void> {
    if (isFolder) {
      const folder = await this.getFolder(userId, itemId);
      if (folder.deletedAt === null) {
        throw new BadRequestError('Item is not in trash.');
      }

      const isShared = this.folderIsSharedWithUser(itemId, userId);
      const descendantRows = queryRows<FolderRow>(
        this.db,
        `WITH RECURSIVE folder_tree AS (
           SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
           FROM folders WHERE id = ?${isShared ? '' : ' AND user_id = ?'}
           UNION ALL
           SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at, f.deleted_at
           FROM folders f
           INNER JOIN folder_tree t ON f.parent_folder_id = t.id
         )
         SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
         FROM folder_tree WHERE id <> ?`,
        isShared ? [itemId, itemId] : [itemId, userId, userId, itemId],
      );

      const allFolders = [folder, ...descendantRows.map(toFolderRecord)];
      const descendantFolderIds = allFolders.map((f) => f.id);

      const filesInFolders = queryRows<FileRow>(
        this.db,
        `SELECT * FROM files WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`,
        descendantFolderIds,
      );

      await this.hardDeleteFoldersAndFiles(userId, allFolders, filesInFolders, descendantFolderIds, isShared);
    } else {
      const file = await this.getFile(userId, itemId);
      if (file.deletedAt === null) {
        throw new BadRequestError('Item is not in trash.');
      }

      this.hardDeleteFile(file);
    }
  }

  public async emptyTrash(userId: string): Promise<number> {
    const folders = queryRows<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folders WHERE user_id = ? AND deleted_at IS NOT NULL`,
      [userId],
    );

    const files = queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE user_id = ? AND deleted_at IS NOT NULL`,
      [userId],
    );

    const trashedFolderIds = folders.map((f) => f.id);

    const filesInTrashedFolders = files.filter((f) => trashedFolderIds.includes(f.folder_id));
    const orphanFiles = files.filter((f) => !trashedFolderIds.includes(f.folder_id));

    let deletedCount = orphanFiles.length;

    // Handle orphan trashed files
    for (const file of orphanFiles) {
      const fileRecord = toFileRecord(file);
      this.hardDeleteFile(fileRecord);
    }

    // Handle folders (which cascade to their files)
    if (folders.length > 0) {
      const folderRecords = folders.map(toFolderRecord);
      const allFileRows = filesInTrashedFolders;

      deletedCount += folders.length + filesInTrashedFolders.length;

      await this.hardDeleteFoldersAndFiles(userId, folderRecords, allFileRows, trashedFolderIds, false);
    }

    return deletedCount;
  }

  public async cleanupExpiredTrash(): Promise<number> {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

    // Find expired trashed folders
    const expiredFolders = queryRows<FolderRow>(
      this.db,
      `SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
       FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      [thirtyDaysAgo],
    );

    // Find expired trashed files
    const expiredFiles = queryRows<FileRow>(
      this.db,
      `SELECT * FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?`,
      [thirtyDaysAgo],
    );

    const trashedFolderIds = new Set(expiredFolders.map((f) => f.id));
    const filesInExpiredFolders = expiredFiles.filter((f) => trashedFolderIds.has(f.folder_id));
    const orphanExpiredFiles = expiredFiles.filter((f) => !trashedFolderIds.has(f.folder_id));

    let deletedCount = 0;

    // Permanently delete orphan expired files
    for (const file of orphanExpiredFiles) {
      const fileRecord = toFileRecord(file);
      this.hardDeleteFile(fileRecord);
      deletedCount++;
    }

    // Permanently delete expired folders (cascades to their files)
    for (const folder of expiredFolders) {
      const folderRecord = toFolderRecord(folder);
      const userId = folderRecord.userId;

      const isShared = this.folderIsSharedWithUser(folder.id, userId);

      const descendantRows = queryRows<FolderRow>(
        this.db,
        `WITH RECURSIVE folder_tree AS (
           SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
           FROM folders WHERE id = ?
           UNION ALL
           SELECT f.id, f.user_id, f.parent_folder_id, f.display_name, f.is_root, f.storage_rel_path, f.created_at, f.updated_at, f.deleted_at
           FROM folders f
           INNER JOIN folder_tree t ON f.parent_folder_id = t.id
         )
         SELECT id, user_id, parent_folder_id, display_name, is_root, storage_rel_path, created_at, updated_at, deleted_at
         FROM folder_tree WHERE id <> ?`,
        [folder.id, folder.id],
      );

      const allFolders = [folderRecord, ...descendantRows.map(toFolderRecord)];
      const descendantFolderIds = allFolders.map((f) => f.id);

      const filesInFolders = queryRows<FileRow>(
        this.db,
        `SELECT * FROM files WHERE folder_id IN (${descendantFolderIds.map(() => '?').join(',')})`,
        descendantFolderIds,
      );

      await this.hardDeleteFoldersAndFiles(userId, allFolders, filesInFolders, descendantFolderIds, isShared);
      deletedCount += 1 + filesInFolders.length;
    }

    return deletedCount;
  }

  public async getFavorites(userId: string): Promise<FavoriteEntry[]> {
    const rows = queryRows<{
      item_id: string;
      item_kind: string;
      created_at: string;
    }>(
      this.db,
      'SELECT item_id, item_kind, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
    );

    const folderIds: string[] = [];
    const fileIds: string[] = [];
    for (const row of rows) {
      if (row.item_kind === 'folder') {
        folderIds.push(row.item_id);
      } else {
        fileIds.push(row.item_id);
      }
    }

    const folderMap = new Map<string, FavoriteEntry>();
    const fileMap = new Map<string, FavoriteEntry>();

    if (folderIds.length > 0) {
      const folderRows = queryRows<{
        id: string;
        display_name: string;
        parent_folder_id: string | null;
        deleted_at: string | null;
      }>(
        this.db,
        `SELECT id, display_name, parent_folder_id, deleted_at
         FROM folders WHERE id IN (${folderIds.map(() => '?').join(',')})`,
        folderIds,
      );
      for (const fr of folderRows) {
        const fav = rows.find((r) => r.item_id === fr.id);
        folderMap.set(fr.id, {
          itemId: fr.id,
          itemKind: 'folder',
          createdAt: fav?.created_at ?? '',
          displayName: fr.display_name,
          mimeType: null,
          sizeBytes: null,
          mediaKind: 'folder',
          folderId: null,
          parentFolderId: fr.parent_folder_id,
        });
      }
    }

    if (fileIds.length > 0) {
      const fileRows = queryRows<{
        id: string;
        display_name: string;
        folder_id: string;
        mime_type: string;
        size_bytes: number;
        deleted_at: string | null;
      }>(
        this.db,
        `SELECT id, display_name, folder_id, mime_type, size_bytes, deleted_at
         FROM files WHERE id IN (${fileIds.map(() => '?').join(',')})`,
        fileIds,
      );
      for (const fr of fileRows) {
        const fav = rows.find((r) => r.item_id === fr.id);
        const mediaKind = fr.mime_type.startsWith('image/') ? 'image'
          : fr.mime_type.startsWith('video/') ? 'video'
          : fr.mime_type.startsWith('audio/') ? 'audio'
          : fr.mime_type === 'application/pdf' || fr.mime_type.startsWith('text/') ? 'document'
          : 'other';
        fileMap.set(fr.id, {
          itemId: fr.id,
          itemKind: 'file',
          createdAt: fav?.created_at ?? '',
          displayName: fr.display_name,
          mimeType: fr.mime_type,
          sizeBytes: fr.size_bytes,
          mediaKind,
          folderId: fr.folder_id,
          parentFolderId: null,
        });
      }
    }

    const result: FavoriteEntry[] = [];
    for (const row of rows) {
      if (row.item_kind === 'folder') {
        const entry = folderMap.get(row.item_id);
        if (entry !== null && entry !== undefined) {
          result.push(entry);
        }
      } else {
        const entry = fileMap.get(row.item_id);
        if (entry !== null && entry !== undefined) {
          result.push(entry);
        }
      }
    }

    return result;
  }

  public async addFavorite(userId: string, itemId: string, itemKind: 'file' | 'folder'): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        'INSERT OR IGNORE INTO user_favorites (user_id, item_id, item_kind, created_at) VALUES (?, ?, ?, ?)',
      )
      .run(userId, itemId, itemKind, now);
  }

  public async removeFavorite(userId: string, itemId: string): Promise<void> {
    this.db
      .prepare('DELETE FROM user_favorites WHERE user_id = ? AND item_id = ?')
      .run(userId, itemId);
  }

  public async getStorageUsage(userId: string): Promise<{ usedBytes: number; quotaBytes: number }> {
    const row = queryOptionalRow<{ usedBytes: number; quotaBytes: number }>(
      this.db,
      'SELECT used_bytes AS "usedBytes", quota_bytes AS "quotaBytes" FROM user_storage_usage WHERE user_id = ?',
      [userId],
    );

    if (row === null) {
      return { usedBytes: 0, quotaBytes: 107374182400 };
    }

    return { usedBytes: row.usedBytes, quotaBytes: row.quotaBytes };
  }

  public async getSharedStorageUsage(userId: string): Promise<{ usedBytes: number; quotaBytes: number }> {
    const row = queryOptionalRow<{ usedBytes: number; quotaBytes: number }>(
      this.db,
      `SELECT COALESCE(SUM(sfs.used_bytes), 0) AS "usedBytes",
              COALESCE(SUM(sfs.quota_bytes), 0) AS "quotaBytes"
       FROM shared_folder_members sfm
       INNER JOIN shared_folder_storage sfs ON sfs.folder_id = sfm.folder_id
       WHERE sfm.user_id = ?`,
      [userId],
    );

    if (row === null) {
      return { usedBytes: 0, quotaBytes: 0 };
    }

    return { usedBytes: row.usedBytes, quotaBytes: row.quotaBytes };
  }
}
