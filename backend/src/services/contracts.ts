import type { MultipartFile } from '@fastify/multipart';

import type {
  AuthenticatedSession,
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from '../types/domain.js';

export interface AuthServiceConfig {
  accessTokenTtlSeconds: number;
  authTokenSecret: string;
  refreshTokenTtlSeconds: number;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  user: UserRecord;
}

export interface CreateFolderInput {
  name: string;
  parentFolderId: string;
}

export interface UpdateFolderInput {
  name?: string;
  parentFolderId?: string;
}

export interface UpdateFileInput {
  folderId?: string;
  name?: string;
}

export interface CreateUploadBatchInput {
  expectedCount?: number;
  folderId: string;
  totalBytes?: number;
}

export interface CreateUploadItemInput {
  clientIdempotencyKey: string;
  mimeType?: string;
  originalName: string;
  totalBytes: number;
}

export interface UploadItemContentInput {
  byteOffset: number;
  contentStream: NodeJS.ReadableStream;
}

export interface FileReadDescriptor {
  absolutePath: string;
  file: FileRecord;
  sizeBytes: number;
}

export interface FolderEntries {
  availableExtensions: string[];
  existingFileNames: string[];
  files: FileRecord[];
  folder: FolderRecord;
  folders: FolderRecord[];
  nextOffset: number | null;
  totalFileCount: number;
}

export type FolderEntriesSortDirection = 'asc' | 'desc';
export type FolderEntriesSortField = 'name' | 'date' | 'size' | 'type';
export type FolderEntriesTypeFilter =
  | 'all'
  | 'image'
  | 'audio'
  | 'video'
  | 'document'
  | 'archive'
  | 'other';

export interface GetFolderEntriesInput {
  extensionFilter: string;
  limit: number;
  offset: number;
  search: string;
  searchIncludesDirectChildren: boolean;
  sortDirection: FolderEntriesSortDirection;
  sortField: FolderEntriesSortField;
  typeFilter: FolderEntriesTypeFilter;
}

export interface FolderTreeFolder {
  folder: FolderRecord;
  itemCount: number;
}

export interface UploadBatchSnapshot {
  batch: UploadBatchRecord;
  items: UploadItemRecord[];
}

export interface AuthServiceContract {
  authenticate(accessToken: string): Promise<AuthenticatedSession>;
  changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void>;
  getUserById(userId: string): Promise<UserRecord>;
  login(email: string, password: string): Promise<AuthTokens>;
  logout(
    refreshToken: string | undefined,
    accessToken: string | undefined,
  ): Promise<void>;
  provisionUser(email: string, password: string): Promise<AuthTokens>;
  refresh(refreshToken: string): Promise<AuthTokens>;
}

export interface LibraryServiceContract {
  createFolder(userId: string, input: CreateFolderInput): Promise<FolderRecord>;
  createUploadBatch(
    userId: string,
    input: CreateUploadBatchInput,
  ): Promise<UploadBatchRecord>;
  createUploadItem(
    userId: string,
    batchId: string,
    input: CreateUploadItemInput,
  ): Promise<UploadItemRecord>;
  deleteFile(userId: string, fileId: string): Promise<void>;
  deleteFolder(
    userId: string,
    folderId: string,
    recursive: boolean,
  ): Promise<void>;
  ensureUserRootFolder(userId: string): Promise<FolderRecord>;
  getFile(userId: string, fileId: string): Promise<FileRecord>;
  getFileReadDescriptor(
    userId: string,
    fileId: string,
  ): Promise<FileReadDescriptor>;
  getFilesInFolder(userId: string, folderId: string): Promise<FileRecord[]>;
  getFolder(userId: string, folderId: string): Promise<FolderRecord>;
  getFolderEntries(userId: string, folderId: string, input: GetFolderEntriesInput): Promise<FolderEntries>;
  getSharedFolders(userId: string): Promise<FolderTreeFolder[]>;
  getSharedStorageUsage(userId: string): Promise<{ usedBytes: number; quotaBytes: number }>;
  listFolders(userId: string): Promise<FolderTreeFolder[]>;
  getRootFolder(userId: string): Promise<FolderRecord>;
  getUploadBatch(
    userId: string,
    batchId: string,
  ): Promise<UploadBatchSnapshot>;
  updateFile(
    userId: string,
    fileId: string,
    input: UpdateFileInput,
  ): Promise<FileRecord>;
  updateFolder(
    userId: string,
    folderId: string,
    input: UpdateFolderInput,
  ): Promise<FolderRecord>;
  updateFileContent(
    userId: string,
    fileId: string,
    multipartFile: MultipartFile | undefined,
  ): Promise<FileRecord>;
  uploadItemContent(
    userId: string,
    itemId: string,
    input: UploadItemContentInput,
  ): Promise<UploadItemRecord>;
  getStorageUsage(userId: string): Promise<{ usedBytes: number; quotaBytes: number }>;
  // Trash support
  getTrashedEntries(userId: string): Promise<TrashEntry[]>;
  restoreTrashEntry(userId: string, itemId: string, isFolder: boolean): Promise<void>;
  permanentlyDeleteEntry(userId: string, itemId: string, isFolder: boolean): Promise<void>;
  emptyTrash(userId: string): Promise<number>;
  cleanupExpiredTrash(): Promise<number>;
  // Favorites
  getFavorites(userId: string): Promise<FavoriteEntry[]>;
  addFavorite(userId: string, itemId: string, itemKind: 'file' | 'folder'): Promise<void>;
  removeFavorite(userId: string, itemId: string): Promise<void>;
}

export interface FavoriteEntry {
  itemId: string;
  itemKind: 'file' | 'folder';
  createdAt: string;
  displayName: string;
  mimeType: string | null;
  sizeBytes: number | null;
  mediaKind: string;
  folderId: string | null;
  parentFolderId: string | null;
}

export interface TrashEntry {
  id: string;
  userId: string;
  displayName: string;
  originalName: string | null;
  mimeType: string | null;
  sizeBytes: number | null;
  mediaKind: string;
  folderId: string | null;
  parentFolderId: string | null;
  storageRelPath: string | null;
  deletedAt: Date;
  isFolder: boolean;
}
