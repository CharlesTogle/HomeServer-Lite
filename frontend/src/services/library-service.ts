import { apiBlob, apiJson, apiResponse } from './api-client.ts'
import type {
  CreateFolderInput,
  DeleteItemInput,
  FavoriteItem,
  FileRecord,
  FolderContents,
  FolderContentsQuery,
  FolderRecord,
  FolderTreeNode,
  MediaKind,
  MoveItemInput,
  PermanentlyDeleteTrashInput,
  RestoreTrashInput,
  TrashEntry,
  UploadInput,
} from '../types/library.ts'

interface BackendFolderResponse {
  createdAt: string
  id: string
  isRoot: boolean
  name: string
  parentFolderId: string | null
  updatedAt: string
}

interface BackendFolderTreeFolderResponse extends BackendFolderResponse {
  itemCount: number
}

interface BackendFolderTreeResponse {
  folders: BackendFolderTreeFolderResponse[]
}

interface BackendFileResponse {
  contentUrl: string
  createdAt: string
  folderId: string
  id: string
  mimeType: string
  name: string
  originalName: string
  sizeBytes: number
  status: string
  updatedAt: string
}

interface BackendFolderEntriesResponse {
  availableExtensions: string[]
  existingFileNames: string[]
  files: BackendFileResponse[]
  folder: BackendFolderResponse
  folders: BackendFolderResponse[]
  nextOffset: number | null
  totalFileCount: number
}

interface BackendUploadBatchResponse {
  id: string
}

interface BackendUploadItemResponse {
  id: string
}

export interface PreparedDownload {
  fileName: string
  blob: Blob
}

function compareByName<T extends { name: string }>(left: T, right: T): number {
  return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
}

function buildFolderEntriesUrl(folderId: string, query: FolderContentsQuery, offset: number): string {
  const params = new URLSearchParams({
    extensionFilter: query.extensionFilter,
    limit: String(query.limit),
    offset: String(offset),
    search: query.search,
    searchIncludesDirectChildren: String(query.searchIncludesDirectChildren),
    sortDirection: query.sortDirection,
    sortField: query.sortField,
    typeFilter: query.typeFilter,
  })

  return `/api/folders/${folderId}/entries?${params.toString()}`
}

function inferMediaKind(mimeType: string): MediaKind {
  if (mimeType.startsWith('image/')) {
    return 'image'
  }

  if (mimeType.startsWith('audio/')) {
    return 'audio'
  }

  if (mimeType.startsWith('video/')) {
    return 'video'
  }

  if (
    mimeType === 'application/pdf' ||
    mimeType.startsWith('text/') ||
    mimeType.includes('word')
  ) {
    return 'document'
  }

  if (
    mimeType.includes('zip') ||
    mimeType.includes('tar') ||
    mimeType.includes('compressed')
  ) {
    return 'archive'
  }

  return 'other'
}

function createDescription(mediaKind: MediaKind): string {
  switch (mediaKind) {
    case 'image':
      return 'Protected image preview is available from the backend.'
    case 'audio':
      return 'Protected audio playback streams from the backend.'
    case 'video':
      return 'Protected video playback uses the backend media route.'
    case 'document':
      return 'Document metadata is live and the file is ready to download.'
    case 'archive':
      return 'Archive metadata is live and the file is ready to download.'
    default:
      return 'File metadata is live and the file is ready to download.'
  }
}

function sanitizeFileName(value: string): string {
  return value.trim().replace(/[^\w.-]+/g, '-').replace(/-+/g, '-')
}

function toFolderRecord(
  folder: BackendFolderResponse | BackendFolderTreeFolderResponse,
  itemCount: number,
): FolderRecord {
  return {
    createdAt: folder.createdAt,
    id: folder.id,
    itemCount,
    name: folder.name,
    parentId: folder.parentFolderId,
  }
}

function toFileRecord(file: BackendFileResponse): FileRecord {
  const mediaKind = inferMediaKind(file.mimeType)

  return {
    contentUrl: file.contentUrl,
    createdAt: file.createdAt,
    description: createDescription(mediaKind),
    folderId: file.folderId,
    id: file.id,
    mediaKind,
    mimeType: file.mimeType,
    name: file.name,
    sizeBytes: file.sizeBytes,
    status: file.status,
    updatedAt: file.updatedAt,
  }
}

function buildFolderTree(folders: BackendFolderTreeFolderResponse[]): FolderTreeNode {
  const nodesById = new Map<string, FolderTreeNode>(
    folders.map((folder) => [
      folder.id,
      {
        children: [],
        folder: toFolderRecord(folder, folder.itemCount),
      },
    ]),
  )
  let rootNode: FolderTreeNode | null = null
  const orphanTopLevelNodes: FolderTreeNode[] = []

  for (const folder of folders) {
    const node = nodesById.get(folder.id)

    if (node === undefined) {
      continue
    }

    if (folder.isRoot) {
      rootNode = node
      continue
    }

    if (folder.parentFolderId === null) {
      orphanTopLevelNodes.push(node)
      continue
    }

    const parentNode = nodesById.get(folder.parentFolderId)

    if (parentNode !== undefined) {
      parentNode.children.push(node)
    }
  }

  if (rootNode === null) {
    throw new Error('The backend did not return a root folder.')
  }

  rootNode.children.push(...orphanTopLevelNodes)

  function sortNode(node: FolderTreeNode): void {
    node.children.sort((left, right) => compareByName(left.folder, right.folder))

    for (const child of node.children) {
      sortNode(child)
    }
  }

  sortNode(rootNode)

  return rootNode
}

function buildFolderForest(folders: BackendFolderTreeFolderResponse[]): FolderTreeNode[] {
  const nodesById = new Map<string, FolderTreeNode>(
    folders.map((folder) => [
      folder.id,
      {
        children: [],
        folder: toFolderRecord(folder, folder.itemCount),
      },
    ]),
  )
  const rootNodes: FolderTreeNode[] = []

  for (const folder of folders) {
    const node = nodesById.get(folder.id)

    if (node === undefined) {
      continue
    }

    if (folder.parentFolderId === null) {
      rootNodes.push(node)
      continue
    }

    const parentNode = nodesById.get(folder.parentFolderId)

    if (parentNode === undefined) {
      rootNodes.push(node)
      continue
    }

    parentNode.children.push(node)
  }

  function sortNode(node: FolderTreeNode): void {
    node.children.sort((left, right) => compareByName(left.folder, right.folder))

    for (const child of node.children) {
      sortNode(child)
    }
  }

  rootNodes.sort((left, right) => compareByName(left.folder, right.folder))

  for (const rootNode of rootNodes) {
    sortNode(rootNode)
  }

  return rootNodes
}

export function findFolderNodeById(
  tree: FolderTreeNode,
  folderId: string,
): FolderTreeNode | null {
  if (tree.folder.id === folderId) {
    return tree
  }

  for (const childNode of tree.children) {
    const match = findFolderNodeById(childNode, folderId)

    if (match !== null) {
      return match
    }
  }

  return null
}

export function findFolderPath(
  tree: FolderTreeNode,
  folderId: string,
): FolderRecord[] {
  if (tree.folder.id === folderId) {
    return [tree.folder]
  }

  for (const childNode of tree.children) {
    const path = findFolderPath(childNode, folderId)

    if (path.length > 0) {
      return [tree.folder, ...path]
    }
  }

  return []
}

function collectDescendantFolderIds(tree: FolderTreeNode, folderId: string): string[] {
  const startNode = findFolderNodeById(tree, folderId)

  if (startNode === null) {
    return []
  }

  const descendantIds: string[] = [startNode.folder.id]
  const queue = [...startNode.children]

  while (queue.length > 0) {
    const currentNode = queue.shift()

    if (currentNode === undefined) {
      continue
    }

    descendantIds.push(currentNode.folder.id)
    queue.push(...currentNode.children)
  }

  return descendantIds
}

export function isPreviewableFile(file: FileRecord): boolean {
  return file.mediaKind === 'audio' || file.mediaKind === 'image' || file.mediaKind === 'video' || file.mediaKind === 'document'
}

export async function getFolderTree(): Promise<FolderTreeNode> {
  const response = await apiJson<BackendFolderTreeResponse>('/api/folders/tree')

  return buildFolderTree(response.folders)
}

export async function getSharedFolders(): Promise<FolderTreeNode[]> {
  const response = await apiJson<BackendFolderTreeResponse>('/api/folders/shared')

  return buildFolderForest(response.folders)
}

async function buildSharedFolderPath(
  folder: BackendFolderResponse,
  sharedFolderNodes: FolderTreeNode[],
): Promise<FolderRecord[]> {
  const path: FolderRecord[] = [toFolderRecord(folder, 0)]
  let parentFolderId = folder.parentFolderId

  while (parentFolderId !== null) {
    const parent = await apiJson<BackendFolderResponse>(`/api/folders/${parentFolderId}`)
    path.unshift(toFolderRecord(parent, 0))

    if (sharedFolderNodes.some((node) => node.folder.id === parent.id)) {
      return path
    }

    parentFolderId = parent.parentFolderId
  }

  return path
}

export async function getFolderContents(
  folderId: string,
  tree: FolderTreeNode,
  query: FolderContentsQuery,
  offset: number,
  sharedFolderNodes?: FolderTreeNode[],
): Promise<FolderContents> {
  const response = await apiJson<BackendFolderEntriesResponse>(buildFolderEntriesUrl(folderId, query, offset))
  const currentFolderNode = findFolderNodeById(tree, response.folder.id)
  const sharedRoots = sharedFolderNodes ?? []
  const isSharedRoot = currentFolderNode === null &&
    sharedRoots.some((node) => node.folder.id === response.folder.id)

  let path: FolderRecord[]
  if (isSharedRoot) {
    path = [toFolderRecord(response.folder, 0)]
  } else if (currentFolderNode === null && sharedRoots.length > 0) {
    path = await buildSharedFolderPath(response.folder, sharedRoots)
  } else {
    path = findFolderPath(tree, response.folder.id)
    if (currentFolderNode === null || path.length === 0) {
      throw new Error('The selected folder is missing from the current tree snapshot.')
    }
  }

  return {
    availableExtensions: response.availableExtensions,
    currentFolder: currentFolderNode?.folder ?? toFolderRecord(response.folder, 0),
    existingFileNames: response.existingFileNames,
    files: response.files.map((file) => toFileRecord(file)),
    folders: response.folders
      .map((folder) => findFolderNodeById(tree, folder.id)?.folder ?? toFolderRecord(folder, 0))
      .sort(compareByName),
    nextOffset: response.nextOffset,
    path,
    totalFileCount: response.totalFileCount,
  }
}

export async function createFolder(input: CreateFolderInput): Promise<FolderRecord> {
  const response = await apiJson<BackendFolderResponse>('/api/folders', {
    json: {
      name: input.name,
      parentFolderId: input.parentId,
    },
    method: 'POST',
  })

  return toFolderRecord(response, 0)
}

export interface UploadResult {
  files: FileRecord[]
  duplicateWarnings: string[]
}

export async function uploadFiles(input: UploadInput): Promise<UploadResult> {
  if (input.files.length === 0) {
    throw new Error('Choose at least one file before uploading.')
  }

  const uploadBatch = await apiJson<BackendUploadBatchResponse>('/api/upload-batches', {
    json: {
      expectedCount: input.files.length,
      folderId: input.folderId,
    },
    method: 'POST',
  })
  const uploadedFiles: FileRecord[] = []
  const duplicateWarnings: string[] = []

  for (const [index, file] of input.files.entries()) {
    const uploadItem = await apiJson<BackendUploadItemResponse>(
      `/api/upload-batches/${uploadBatch.id}/items`,
      {
        json: {
          clientIdempotencyKey: `${file.name}-${file.lastModified}-${index}`,
          originalName: file.name,
        },
        method: 'POST',
      },
    )
    const formData = new FormData()

    formData.append('file', file)

    const uploadedFile = await apiJson<BackendFileResponse>(
      `/api/upload-items/${uploadItem.id}/content`,
      {
        body: formData,
        method: 'POST',
      },
    )

    if (uploadedFile.name !== file.name) {
      duplicateWarnings.push(`Duplicate filename detected: "${file.name}" was saved as "${uploadedFile.name}"`)
    }

    uploadedFiles.push(toFileRecord(uploadedFile))
  }

  return { files: uploadedFiles, duplicateWarnings }
}

export async function deleteItem(input: DeleteItemInput): Promise<void> {
  if (input.kind === 'folder') {
    await apiResponse(`/api/folders/${input.id}?recursive=true`, {
      method: 'DELETE',
    })
    return
  }

  await apiResponse(`/api/files/${input.id}`, {
    method: 'DELETE',
  })
}

export async function moveItem(input: MoveItemInput): Promise<void> {
  if (input.kind === 'folder') {
    await apiJson<BackendFolderResponse>(`/api/folders/${input.id}`, {
      json: {
        parentFolderId: input.destinationFolderId,
      },
      method: 'PATCH',
    })
    return
  }

  await apiJson<BackendFileResponse>(`/api/files/${input.id}`, {
    json: {
      folderId: input.destinationFolderId,
    },
    method: 'PATCH',
  })
}

export async function updateFileContent(fileId: string, content: string): Promise<FileRecord> {
  const blob = new Blob([content], { type: 'text/markdown' })
  const formData = new FormData()
  const file = new File([blob], 'content.md', { type: 'text/markdown' })

  formData.append('file', file)

  return await apiJson<BackendFileResponse>(`/api/files/${fileId}/content`, {
    body: formData,
    method: 'PUT',
  }).then(toFileRecord)
}

export async function getFilePreviewBlob(file: FileRecord): Promise<Blob> {
  return await apiBlob(file.contentUrl)
}

export interface StorageUsage {
  usedBytes: number
  quotaBytes: number
}

export async function getMe(): Promise<{ user: { id: string; email: string }; storage: StorageUsage }> {
  return await apiJson<{ user: { id: string; email: string }; storage: StorageUsage }>('/api/me')
}

export async function getSharedStorageUsage(): Promise<StorageUsage> {
  return await apiJson<StorageUsage>('/api/folders/shared/storage')
}

interface BackendTrashListResponse {
  items: BackendTrashEntryResponse[]
}

interface BackendTrashEntryResponse {
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

function toTrashEntry(entry: BackendTrashEntryResponse): TrashEntry {
  return {
    deletedAt: entry.deletedAt,
    displayName: entry.displayName,
    folderId: entry.folderId,
    id: entry.id,
    isFolder: entry.isFolder,
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType,
    originalName: entry.originalName,
    parentFolderId: entry.parentFolderId,
    sizeBytes: entry.sizeBytes,
  }
}

export async function getTrash(): Promise<TrashEntry[]> {
  const response = await apiJson<BackendTrashListResponse>('/api/trash')

  return response.items.map(toTrashEntry)
}

export async function restoreTrashItem(input: RestoreTrashInput): Promise<void> {
  await apiResponse(`/api/trash/${input.itemId}/restore`, {
    json: { isFolder: input.isFolder },
    method: 'POST',
  })
}

export async function permanentlyDeleteTrashItem(input: PermanentlyDeleteTrashInput): Promise<void> {
  await apiResponse(`/api/trash/${input.itemId}?isFolder=${input.isFolder}`, {
    method: 'DELETE',
  })
}

export async function emptyTrash(): Promise<{ deletedCount: number }> {
  return await apiJson<{ deletedCount: number }>('/api/trash', {
    method: 'DELETE',
  })
}

interface BackendFavoriteListResponse {
  items: BackendFavoriteEntryResponse[]
}

interface BackendFavoriteEntryResponse {
  createdAt: string
  displayName: string
  folderId: string | null
  itemId: string
  itemKind: string
  mediaKind: string
  mimeType: string | null
  parentFolderId: string | null
  sizeBytes: number | null
}

function toFavoriteItem(entry: BackendFavoriteEntryResponse): FavoriteItem {
  return {
    createdAt: entry.createdAt,
    displayName: entry.displayName,
    folderId: entry.folderId,
    itemId: entry.itemId,
    itemKind: entry.itemKind as FavoriteItem['itemKind'],
    mediaKind: entry.mediaKind,
    mimeType: entry.mimeType,
    parentFolderId: entry.parentFolderId,
    sizeBytes: entry.sizeBytes,
  }
}

export async function getFavorites(): Promise<FavoriteItem[]> {
  const response = await apiJson<BackendFavoriteListResponse>('/api/favorites')

  return response.items.map(toFavoriteItem)
}

export async function addFavorite(itemId: string, itemKind: 'file' | 'folder'): Promise<void> {
  await apiResponse('/api/favorites', {
    json: { itemId, itemKind },
    method: 'POST',
  })
}

export async function removeFavorite(itemId: string): Promise<void> {
  await apiResponse(`/api/favorites/${itemId}`, {
    method: 'DELETE',
  })
}

export async function prepareFileDownload(file: FileRecord): Promise<PreparedDownload> {
  return {
    blob: await apiBlob(`/api/files/${file.id}/download`),
    fileName: file.name,
  }
}

export async function prepareFolderDownload(
  folder: FolderRecord,
  tree: FolderTreeNode,
): Promise<PreparedDownload> {
  const folderIds = collectDescendantFolderIds(tree, folder.id)
  const defaultQuery: FolderContentsQuery = {
    extensionFilter: 'all',
    limit: 200,
    search: '',
    searchIncludesDirectChildren: false,
    sortDirection: 'asc',
    sortField: 'name',
    typeFilter: 'all',
  }
  const responses = await Promise.all(
    folderIds.map(async (folderId) => {
      const files: BackendFileResponse[] = []
      let offset = 0

      while (true) {
        const response = await apiJson<BackendFolderEntriesResponse>(
          buildFolderEntriesUrl(folderId, defaultQuery, offset),
        )

        files.push(...response.files)

        if (response.nextOffset === null) {
          return files
        }

        offset = response.nextOffset
      }
    }),
  )
  const exportedFolders = folderIds
    .map((folderId) => findFolderNodeById(tree, folderId)?.folder)
    .filter((entry): entry is FolderRecord => entry !== undefined)
    .sort(compareByName)
  const exportedFiles = responses
    .flatMap((response) => response.map((file) => toFileRecord(file)))
    .sort(compareByName)
  const snapshot = {
    exportedAt: new Date().toISOString(),
    files: exportedFiles.map((file) => ({
      contentUrl: file.contentUrl,
      createdAt: file.createdAt,
      folderId: file.folderId,
      id: file.id,
      mimeType: file.mimeType,
      name: file.name,
      sizeBytes: file.sizeBytes,
      status: file.status,
      updatedAt: file.updatedAt,
    })),
    folder: {
      createdAt: folder.createdAt,
      id: folder.id,
      itemCount: folder.itemCount,
      name: folder.name,
      parentId: folder.parentId,
    },
    folders: exportedFolders.map((entry) => ({
      createdAt: entry.createdAt,
      id: entry.id,
      itemCount: entry.itemCount,
      name: entry.name,
      parentId: entry.parentId,
    })),
  }

  return {
    blob: new Blob([JSON.stringify(snapshot, null, 2)], {
      type: 'application/json',
    }),
    fileName: `${sanitizeFileName(folder.name) || 'folder'}-snapshot.json`,
  }
}
