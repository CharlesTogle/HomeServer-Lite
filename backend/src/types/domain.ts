export type DatabaseMode = 'sqlite' | 'test-memory';

export type FileStatus = 'ready' | 'uploading';
export type UploadBatchStatus = 'completed' | 'open' | 'partial';
export type UploadItemStatus =
  | 'complete'
  | 'failed'
  | 'pending'
  | 'processing'
  | 'uploaded'
  | 'uploading';

export interface UserRecord {
  createdAt: Date;
  email: string;
  id: string;
  passwordHash: string;
  updatedAt: Date;
}

export interface SessionRecord {
  createdAt: Date;
  expiresAt: Date;
  id: string;
  refreshTokenHash: string;
  revokedAt: Date | null;
  updatedAt: Date;
  userId: string;
}

export interface AuthenticatedSession {
  email: string;
  sessionId: string;
  userId: string;
}

export interface FolderRecord {
  createdAt: Date;
  deletedAt: Date | null;
  displayName: string;
  id: string;
  isRoot: boolean;
  parentFolderId: string | null;
  storageRelPath: string;
  updatedAt: Date;
  userId: string;
}

export interface FileRecord {
  createdAt: Date;
  deletedAt: Date | null;
  displayName: string;
  folderId: string;
  id: string;
  mimeType: string;
  originalName: string;
  sha256: string;
  sizeBytes: number;
  status: FileStatus;
  storageRelPath: string;
  storedExtension: string;
  updatedAt: Date;
  userId: string;
}

export interface UploadBatchRecord {
  completedAt: Date | null;
  completedCount: number;
  createdAt: Date;
  expectedCount: number | null;
  failedCount: number;
  folderId: string;
  id: string;
  receivedBytes: number;
  status: UploadBatchStatus;
  totalBytes: number;
  updatedAt: Date;
  userId: string;
}

export interface UploadItemRecord {
  batchId: string;
  clientIdempotencyKey: string;
  createdAt: Date;
  errorCode: string | null;
  fileId: string | null;
  id: string;
  mimeType: string;
  originalName: string;
  receivedBytes: number;
  resolvedName: string | null;
  status: UploadItemStatus;
  totalBytes: number;
  updatedAt: Date;
  userId: string;
}

export interface DatabaseConnectionState {
  mode: DatabaseMode;
}
