import type { FavoriteEntry, FolderTreeFolder, TrashEntry } from '../services/contracts.js';
import type {
  FileRecord,
  FolderRecord,
  UploadBatchRecord,
  UploadItemRecord,
  UserRecord,
} from './domain.js';

export interface UserResponse {
  email: string;
  id: string;
}

export interface AuthResponse {
  accessToken: string;
  user: UserResponse;
}

export interface FolderResponse {
  createdAt: string;
  id: string;
  isRoot: boolean;
  name: string;
  parentFolderId: string | null;
  updatedAt: string;
}

export interface FileResponse {
  contentUrl: string;
  createdAt: string;
  folderId: string;
  id: string;
  mimeType: string;
  name: string;
  originalName: string;
  sizeBytes: number;
  status: string;
  updatedAt: string;
}

export interface FolderEntriesResponse {
  availableExtensions: string[];
  existingFileNames: string[];
  files: FileResponse[];
  folder: FolderResponse;
  folders: FolderResponse[];
  nextOffset: number | null;
  totalFileCount: number;
}

export interface FolderTreeFolderResponse extends FolderResponse {
  itemCount: number;
}

export interface FolderTreeResponse {
  folders: FolderTreeFolderResponse[];
}

export interface StorageUsageResponse {
  quotaBytes: number;
  usedBytes: number;
}

export interface UploadItemResponse {
  batchId: string;
  createdAt: string;
  errorCode: string | null;
  fileId: string | null;
  id: string;
  originalName: string;
  status: string;
  updatedAt: string;
}

export interface UploadBatchResponse {
  completedAt: string | null;
  completedCount: number;
  createdAt: string;
  expectedCount: number | null;
  failedCount: number;
  folderId: string;
  id: string;
  items: UploadItemResponse[];
  status: string;
  updatedAt: string;
}

export function toAuthResponse(
  accessToken: string,
  user: UserRecord,
): AuthResponse {
  return {
    accessToken,
    user: toUserResponse(user),
  };
}

export function toFileResponse(file: FileRecord): FileResponse {
  return {
    contentUrl: `/api/files/${file.id}/content`,
    createdAt: file.createdAt.toISOString(),
    folderId: file.folderId,
    id: file.id,
    mimeType: file.mimeType,
    name: file.displayName,
    originalName: file.originalName,
    sizeBytes: file.sizeBytes,
    status: file.status,
    updatedAt: file.updatedAt.toISOString(),
  };
}

export function toFolderEntriesResponse(
  folder: FolderRecord,
  folders: FolderRecord[],
  files: FileRecord[],
  nextOffset: number | null,
  totalFileCount: number,
  availableExtensions: string[],
  existingFileNames: string[],
): FolderEntriesResponse {
  return {
    availableExtensions,
    existingFileNames,
    files: files.map(toFileResponse),
    folder: toFolderResponse(folder),
    folders: folders.map(toFolderResponse),
    nextOffset,
    totalFileCount,
  };
}

export function toFolderTreeFolderResponse(
  entry: FolderTreeFolder,
): FolderTreeFolderResponse {
  return {
    ...toFolderResponse(entry.folder),
    itemCount: entry.itemCount,
  };
}

export function toFolderTreeResponse(
  folders: FolderTreeFolder[],
): FolderTreeResponse {
  return {
    folders: folders.map((entry) => toFolderTreeFolderResponse(entry)),
  };
}

export function toFolderResponse(folder: FolderRecord): FolderResponse {
  return {
    createdAt: folder.createdAt.toISOString(),
    id: folder.id,
    isRoot: folder.isRoot,
    name: folder.displayName,
    parentFolderId: folder.parentFolderId,
    updatedAt: folder.updatedAt.toISOString(),
  };
}

export function toUploadBatchResponse(
  batch: UploadBatchRecord,
  items: UploadItemRecord[],
): UploadBatchResponse {
  return {
    completedAt: batch.completedAt?.toISOString() ?? null,
    completedCount: batch.completedCount,
    createdAt: batch.createdAt.toISOString(),
    expectedCount: batch.expectedCount,
    failedCount: batch.failedCount,
    folderId: batch.folderId,
    id: batch.id,
    items: items.map(toUploadItemResponse),
    status: batch.status,
    updatedAt: batch.updatedAt.toISOString(),
  };
}

export function toUploadItemResponse(item: UploadItemRecord): UploadItemResponse {
  return {
    batchId: item.batchId,
    createdAt: item.createdAt.toISOString(),
    errorCode: item.errorCode,
    fileId: item.fileId,
    id: item.id,
    originalName: item.originalName,
    status: item.status,
    updatedAt: item.updatedAt.toISOString(),
  };
}

export interface TrashEntryResponse {
  deletedAt: string;
  displayName: string;
  folderId: string | null;
  id: string;
  isFolder: boolean;
  mediaKind: string;
  mimeType: string | null;
  originalName: string | null;
  parentFolderId: string | null;
  sizeBytes: number | null;
}

export function toTrashEntryResponse(entry: TrashEntry): TrashEntryResponse {
  return {
    deletedAt: entry.deletedAt.toISOString(),
    displayName: entry.displayName,
    folderId: entry.folderId,
    id: entry.id,
    isFolder: entry.isFolder,
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType,
    originalName: entry.originalName,
    parentFolderId: entry.parentFolderId,
    sizeBytes: entry.sizeBytes,
  };
}

export function toTrashListResponse(entries: TrashEntry[]): { items: TrashEntryResponse[] } {
  return {
    items: entries.map(toTrashEntryResponse),
  };
}

export interface FavoriteEntryResponse {
  createdAt: string;
  displayName: string;
  folderId: string | null;
  itemId: string;
  itemKind: string;
  mediaKind: string;
  mimeType: string | null;
  parentFolderId: string | null;
  sizeBytes: number | null;
}

export function toFavoriteEntryResponse(entry: FavoriteEntry): FavoriteEntryResponse {
  return {
    createdAt: entry.createdAt,
    displayName: entry.displayName,
    folderId: entry.folderId,
    itemId: entry.itemId,
    itemKind: entry.itemKind,
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType,
    parentFolderId: entry.parentFolderId,
    sizeBytes: entry.sizeBytes,
  };
}

export function toFavoriteListResponse(entries: FavoriteEntry[]): { items: FavoriteEntryResponse[] } {
  return {
    items: entries.map(toFavoriteEntryResponse),
  };
}

export function toUserResponse(user: UserRecord): UserResponse {
  return {
    email: user.email,
    id: user.id,
  };
}
