export type MediaKind = 'image' | 'audio' | 'video' | 'document' | 'archive' | 'other'
export type LibraryItemKind = 'file' | 'folder'
export type FolderEntriesSortField = 'name' | 'date' | 'size' | 'type'
export type FolderEntriesSortDirection = 'asc' | 'desc'
export type FolderEntriesTypeFilter = 'all' | 'image' | 'audio' | 'video' | 'document' | 'archive' | 'other'

export interface FolderRecord {
  id: string
  name: string
  parentId: string | null
  createdAt: string
  itemCount: number
}

export interface FolderTreeNode {
  folder: FolderRecord
  children: FolderTreeNode[]
}

export interface FileRecord {
  id: string
  name: string
  folderId: string
  mimeType: string
  sizeBytes: number
  mediaKind: MediaKind
  createdAt: string
  updatedAt: string
  contentUrl: string
  status: string
  description: string
}

export interface FolderContents {
  availableExtensions: string[]
  currentFolder: FolderRecord
  existingFileNames: string[]
  path: FolderRecord[]
  folders: FolderRecord[]
  files: FileRecord[]
  nextOffset: number | null
  totalFileCount: number
}

export interface FolderContentsQuery {
  extensionFilter: string
  limit: number
  search: string
  searchIncludesDirectChildren: boolean
  sortDirection: FolderEntriesSortDirection
  sortField: FolderEntriesSortField
  typeFilter: FolderEntriesTypeFilter
}

export interface CreateFolderInput {
  parentId: string
  name: string
}

export interface UploadInput {
  folderId: string
  files: File[]
}

export interface DeleteItemInput {
  kind: LibraryItemKind
  id: string
}

export interface MoveItemInput {
  kind: LibraryItemKind
  id: string
  destinationFolderId: string
}

export interface DownloadItemInput {
  kind: LibraryItemKind
  id: string
}

export interface FavoriteItem {
  itemId: string
  itemKind: LibraryItemKind
  createdAt: string
  displayName: string
  mimeType: string | null
  sizeBytes: number | null
  mediaKind: string
  folderId: string | null
  parentFolderId: string | null
}

export interface TrashEntry {
  deletedAt: string
  displayName: string
  folderId: string | null
  id: string
  isFolder: boolean
  mediaKind: string
  mimeType: string | null
  originalName: string | null
  parentFolderId: string | null
  sizeBytes: number | null
}

export interface RestoreTrashInput {
  itemId: string
  isFolder: boolean
}

export interface PermanentlyDeleteTrashInput {
  itemId: string
  isFolder: boolean
}
