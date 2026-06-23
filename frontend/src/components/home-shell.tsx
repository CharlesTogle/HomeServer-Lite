import { Bookmark, HardDrive, LoaderCircle, Trash2, Users } from 'lucide-react'
import { startTransition, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useSharedStorageUsageQuery, useStorageUsageQuery } from '../hooks/use-auth.ts'
import {
  useCreateFolderMutation,
  useDeleteItemMutation,
  useFilePreview,
  useFolderContentsQuery,
  useFolderTreeQuery,
  useMoveItemMutation,
  useSharedFoldersQuery,
  useUploadFilesMutation,
} from '../hooks/use-library.ts'
import {
  findFolderNodeById,
  prepareFileDownload,
  prepareFolderDownload,
} from '../services/library-service.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'
import type { FileRecord, FolderRecord, FolderTreeNode, LibraryItemKind } from '../types/library.ts'
import { triggerBlobDownload } from '../utils/download.ts'
import { ConfirmationModal } from './confirmation-modal.tsx'
import { CreateFolderModal } from './create-folder-modal.tsx'
import { FolderTree } from './folder-tree.tsx'
import { LibraryPanel } from './library-panel.tsx'
import { MediaViewer } from './media-viewer.tsx'
import { MoveItemModal, type MoveDestinationOption } from './move-item-modal.tsx'
import { FavoritesPage } from './favorites-page.tsx'
import { TrashPage } from './trash-page.tsx'
import { UploadPanel } from './upload-panel.tsx'

interface DeleteTarget {
  kind: LibraryItemKind
  id: string
  name: string
  parentId: string | null
}

interface MoveTarget {
  kind: LibraryItemKind
  id: string
  name: string
  parentId: string | null
}

interface InspectorTarget {
  kind: LibraryItemKind
  id: string
  mode: 'preview' | 'properties'
}

interface HomeShellProps {
  isMobileSidebarOpen: boolean
  onCloseMobileSidebar: () => void
}

function collectDescendantFolderIds(tree: FolderTreeNode, folderId: string): Set<string> {
  if (tree.folder.id === folderId) {
    const descendantIds = new Set<string>()

    function visit(node: FolderTreeNode): void {
      for (const childNode of node.children) {
        descendantIds.add(childNode.folder.id)
        visit(childNode)
      }
    }

    visit(tree)

    return descendantIds
  }

  for (const childNode of tree.children) {
    const descendantIds = collectDescendantFolderIds(childNode, folderId)

    if (descendantIds.size > 0) {
      return descendantIds
    }
  }

  return new Set<string>()
}

function collectFolderIds(nodes: FolderTreeNode[]): Set<string> {
  const folderIds = new Set<string>()

  function visit(node: FolderTreeNode): void {
    folderIds.add(node.folder.id)

    for (const childNode of node.children) {
      visit(childNode)
    }
  }

  for (const node of nodes) {
    visit(node)
  }

  return folderIds
}

function excludeFoldersFromTree(tree: FolderTreeNode, excludedFolderIds: Set<string>): FolderTreeNode {
  return {
    ...tree,
    children: tree.children
      .filter((childNode) => !excludedFolderIds.has(childNode.folder.id))
      .map((childNode) => excludeFoldersFromTree(childNode, excludedFolderIds)),
  }
}

function buildMoveDestinationOptions(
  tree: FolderTreeNode,
  target: MoveTarget,
): MoveDestinationOption[] {
  const blockedFolderIds =
    target.kind === 'folder' ? collectDescendantFolderIds(tree, target.id) : new Set<string>()

  if (target.kind === 'folder') {
    blockedFolderIds.add(target.id)
  }

  function visit(node: FolderTreeNode, pathSegments: string[]): MoveDestinationOption[] {
    const nextPathSegments = [...pathSegments, node.folder.name]
    const label = nextPathSegments.join(' / ')
    const isCurrentParent = node.folder.id === target.parentId

    return [
      {
        id: node.folder.id,
        label,
        disabled: isCurrentParent || blockedFolderIds.has(node.folder.id),
      },
      ...node.children.flatMap((childNode) => visit(childNode, nextPathSegments)),
    ]
  }

  return visit(tree, [])
}

function findFirstEnabledDestinationId(destinations: MoveDestinationOption[]): string {
  return destinations.find((destination) => !destination.disabled)?.id ?? ''
}

function StorageBar(): React.JSX.Element {
  const storageQuery = useStorageUsageQuery()
  const sharedStorageQuery = useSharedStorageUsageQuery()

  function renderUsageRow(
    label: string,
    usedBytes: number,
    quotaBytes: number,
    icon: React.JSX.Element,
  ): React.JSX.Element {
    const usedGB = usedBytes / 1_073_741_824
    const quotaGB = quotaBytes / 1_073_741_824
    const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0
    const barColor = ratio > 0.9 ? 'bg-[var(--error)]' : ratio > 0.7 ? 'bg-amber-500' : 'bg-[var(--primary)]'

    return (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {icon}
            <span className="text-xs font-medium text-[var(--secondary)]">{label}</span>
          </div>
          <span className="text-xs text-[var(--secondary)]">
            {usedGB.toFixed(1)} GB / {quotaGB.toFixed(0)} GB
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-container)]">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.min(ratio * 100, 100)}%` }}
          />
        </div>
      </div>
    )
  }

  if (storageQuery.isPending) {
    return (
      <div className="flex items-center gap-2 px-1 py-2">
        <LoaderCircle className="size-3.5 animate-spin text-[var(--secondary)]" />
      </div>
    )
  }

  if (storageQuery.error !== null || storageQuery.data === undefined) {
    return <></>
  }

  const sharedStorage =
    sharedStorageQuery.error === null && sharedStorageQuery.data !== undefined && sharedStorageQuery.data.quotaBytes > 0
      ? sharedStorageQuery.data
      : null

  return (
    <div className="space-y-3 px-1">
      {renderUsageRow(
        'My Drive',
        storageQuery.data.usedBytes,
        storageQuery.data.quotaBytes,
        <HardDrive className="size-3.5 text-[var(--secondary)]" />,
      )}

      {sharedStorage === null
        ? null
        : renderUsageRow(
            'Shared',
            sharedStorage.usedBytes,
            sharedStorage.quotaBytes,
            <Users className="size-3.5 text-[var(--secondary)]" />,
          )}
    </div>
  )
}

function getFolderFromContents(
  folderId: string,
  currentFolder: FolderRecord,
  siblingFolders: FolderRecord[],
): FolderRecord | null {
  if (currentFolder.id === folderId) {
    return currentFolder
  }

  return siblingFolders.find((folder) => folder.id === folderId) ?? null
}

export function HomeShell({ isMobileSidebarOpen, onCloseMobileSidebar }: HomeShellProps): React.JSX.Element {
  const {
    currentPage,
    libraryExtensionFilter,
    librarySearchTerm,
    librarySortDirection,
    librarySortField,
    libraryTypeFilter,
    selectedFileId,
    selectedFolderId,
    setCurrentPage,
    setSelectedFileId,
    setSelectedFolderId,
  } =
    useWorkspaceStore(
      useShallow((state) => ({
        currentPage: state.currentPage,
        libraryExtensionFilter: state.libraryExtensionFilter,
        librarySearchTerm: state.librarySearchTerm,
        librarySortDirection: state.librarySortDirection,
        librarySortField: state.librarySortField,
        libraryTypeFilter: state.libraryTypeFilter,
        selectedFileId: state.selectedFileId,
        selectedFolderId: state.selectedFolderId,
        setCurrentPage: state.setCurrentPage,
        setSelectedFileId: state.setSelectedFileId,
        setSelectedFolderId: state.setSelectedFolderId,
      })),
    )
  const deferredSearchTerm = useDeferredValue(librarySearchTerm.trim())
  const folderContentsQueryInput = useMemo(() => ({
    extensionFilter: libraryExtensionFilter,
    limit: 60,
    search: deferredSearchTerm,
    searchIncludesDirectChildren: deferredSearchTerm.length > 0,
    sortDirection: librarySortDirection,
    sortField: librarySortField,
    typeFilter: libraryTypeFilter,
  }), [
    deferredSearchTerm,
    libraryExtensionFilter,
    librarySortDirection,
    librarySortField,
    libraryTypeFilter,
  ])

  const folderTreeQuery = useFolderTreeQuery()
  const sharedFoldersQuery = useSharedFoldersQuery()
  const sharedFolderNodes = useMemo(
    () => sharedFoldersQuery.data ?? [],
    [sharedFoldersQuery.data],
  )
  const sharedFolderIds = useMemo(() => collectFolderIds(sharedFolderNodes), [sharedFolderNodes])
  const myDriveTree = useMemo(
    () =>
      folderTreeQuery.data === undefined
        ? undefined
        : excludeFoldersFromTree(folderTreeQuery.data, sharedFolderIds),
    [folderTreeQuery.data, sharedFolderIds],
  )
  const folderContentsQuery = useFolderContentsQuery(
    selectedFolderId,
    folderTreeQuery.data,
    folderContentsQueryInput,
    sharedFolderNodes,
  )
  const createFolderMutation = useCreateFolderMutation()
  const uploadFilesMutation = useUploadFilesMutation()
  const deleteItemMutation = useDeleteItemMutation()
  const moveItemMutation = useMoveItemMutation()

  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null)
  const [inspectorTarget, setInspectorTarget] = useState<InspectorTarget | null>(null)
  const [moveTarget, setMoveTarget] = useState<MoveTarget | null>(null)
  const [moveDestinationFolderId, setMoveDestinationFolderId] = useState<string>('')
  const [downloadingItemId, setDownloadingItemId] = useState<string | null>(null)
  const [actionErrorMessage, setActionErrorMessage] = useState<string | null>(null)
  const [isUploadModalOpen, setIsUploadModalOpen] = useState<boolean>(false)
  const [isCreateFolderModalOpen, setIsCreateFolderModalOpen] = useState<boolean>(false)
  const [newFolderName, setNewFolderName] = useState<string>('')

  useEffect(() => {
    if (folderTreeQuery.data === undefined) {
      return
    }

    if (
      selectedFolderId === null ||
      (findFolderNodeById(folderTreeQuery.data, selectedFolderId) === null &&
        !sharedFolderIds.has(selectedFolderId))
    ) {
      setSelectedFolderId(folderTreeQuery.data.folder.id)
    }
  }, [folderTreeQuery.data, selectedFolderId, setSelectedFolderId, sharedFolderIds])

  const rootFolderId = folderTreeQuery.data?.folder.id ?? null
  const rawCurrentContents = useMemo(() => {
    const pages = folderContentsQuery.data?.pages
    const firstPage = pages?.[0]

    if (pages === undefined || firstPage === undefined) {
      return null
    }

    return {
      ...firstPage,
      files: pages.flatMap((page) => page.files),
      nextOffset: pages[pages.length - 1]?.nextOffset ?? null,
    }
  }, [folderContentsQuery.data])
  const currentContents = useMemo(() => {
    if (rawCurrentContents === null || rawCurrentContents.currentFolder.id !== rootFolderId) {
      return rawCurrentContents
    }

    return {
      ...rawCurrentContents,
      folders: rawCurrentContents.folders.filter((folder) => !sharedFolderIds.has(folder.id)),
    }
  }, [rawCurrentContents, rootFolderId, sharedFolderIds])

  const previewFile = currentContents?.files.find((file) => file.id === selectedFileId) ?? null
  const inspectedFile =
    inspectorTarget?.kind === 'file'
      ? currentContents?.files.find((file) => file.id === inspectorTarget.id) ?? null
      : null
  const inspectedFolder =
    inspectorTarget?.kind === 'folder' && currentContents !== null
      ? getFolderFromContents(
          inspectorTarget.id,
          currentContents.currentFolder,
          currentContents.folders,
        )
      : null
  const activeInspectorFile = inspectedFile ?? previewFile
  const activeInspectorMode =
    inspectorTarget?.mode ?? (activeInspectorFile !== null ? 'preview' : 'properties')
  const filePreview = useFilePreview(activeInspectorFile)
  const deleteErrorMessage = deleteTarget !== null ? deleteItemMutation.error?.message ?? null : null
  const moveErrorMessage = moveTarget !== null ? moveItemMutation.error?.message ?? null : null
  const busyItemId =
    deleteItemMutation.isPending && deleteTarget !== null
      ? deleteTarget.id
      : moveItemMutation.isPending && moveTarget !== null
        ? moveTarget.id
        : downloadingItemId
  const moveDestinations =
    moveTarget !== null && folderTreeQuery.data !== undefined
      ? buildMoveDestinationOptions(folderTreeQuery.data, moveTarget)
      : []
  const isFolderContentsLoading = selectedFolderId === null || (folderContentsQuery.isPending && currentContents === null)

  function resetActionErrors(): void {
    setActionErrorMessage(null)
    deleteItemMutation.reset()
    moveItemMutation.reset()
  }

  function handleOpenFolder(folderId: string): void {
    resetActionErrors()
    setDeleteTarget(null)
    setMoveTarget(null)
    onCloseMobileSidebar()

    setCurrentPage('files')
    setSelectedFolderId(folderId)
    setSelectedFileId(null)
    setInspectorTarget(null)
  }

  function handleSelectFile(fileId: string): void {
    resetActionErrors()
    setMoveTarget(null)
    setSelectedFileId(fileId)
    setInspectorTarget(null)
  }

  function handleRequestDeleteFolder(folder: FolderRecord): void {
    resetActionErrors()
    setDeleteTarget({
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    })
  }

  function handleRequestDeleteFile(file: FileRecord): void {
    resetActionErrors()
    setDeleteTarget({
      kind: 'file',
      id: file.id,
      name: file.name,
      parentId: file.folderId,
    })
  }

  function handleRequestMoveFolder(folder: FolderRecord): void {
    resetActionErrors()

    if (folderTreeQuery.data === undefined) {
      setActionErrorMessage('Folder destinations are still loading.')
      return
    }

    const nextTarget: MoveTarget = {
      kind: 'folder',
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
    }
    const destinations = buildMoveDestinationOptions(folderTreeQuery.data, nextTarget)

    setMoveTarget(nextTarget)
    setMoveDestinationFolderId(findFirstEnabledDestinationId(destinations))
  }

  function handleOpenCreateFolderModal(): void {
    resetActionErrors()
    createFolderMutation.reset()
    setNewFolderName('')
    setIsCreateFolderModalOpen(true)
  }

  function handleRequestMoveFile(file: FileRecord): void {
    resetActionErrors()

    if (folderTreeQuery.data === undefined) {
      setActionErrorMessage('Folder destinations are still loading.')
      return
    }

    const nextTarget: MoveTarget = {
      kind: 'file',
      id: file.id,
      name: file.name,
      parentId: file.folderId,
    }
    const destinations = buildMoveDestinationOptions(folderTreeQuery.data, nextTarget)

    setMoveTarget(nextTarget)
    setMoveDestinationFolderId(findFirstEnabledDestinationId(destinations))
  }

  function handleRequestShowFolderProperties(folder: FolderRecord): void {
    resetActionErrors()
    setMoveTarget(null)
    setDeleteTarget(null)

    startTransition(() => {
      setSelectedFileId(null)
      setInspectorTarget({
        kind: 'folder',
        id: folder.id,
        mode: 'properties',
      })
    })
  }

  function handleRequestShowFileProperties(file: FileRecord): void {
    resetActionErrors()
    setMoveTarget(null)
    setDeleteTarget(null)

    startTransition(() => {
      setSelectedFileId(file.id)
      setInspectorTarget({
        kind: 'file',
        id: file.id,
        mode: 'properties',
      })
    })
  }

  async function handleRequestDownloadFile(file: FileRecord): Promise<void> {
    resetActionErrors()
    setDownloadingItemId(file.id)

    try {
      const preparedDownload = await prepareFileDownload(file)

      triggerBlobDownload(preparedDownload.blob, preparedDownload.fileName)
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error ? error.message : 'The download could not be prepared.',
      )
    } finally {
      setDownloadingItemId(null)
    }
  }

  async function handleRequestDownloadFolder(folder: FolderRecord): Promise<void> {
    resetActionErrors()
    setDownloadingItemId(folder.id)

    try {
      if (folderTreeQuery.data === undefined) {
        throw new Error('Folder tree is still loading.')
      }

      const preparedDownload = await prepareFolderDownload(folder, folderTreeQuery.data)

      triggerBlobDownload(preparedDownload.blob, preparedDownload.fileName)
    } catch (error) {
      setActionErrorMessage(
        error instanceof Error ? error.message : 'The folder snapshot could not be prepared.',
      )
    } finally {
      setDownloadingItemId(null)
    }
  }

  async function handleConfirmDelete(): Promise<void> {
    if (deleteTarget === null) {
      return
    }

    await deleteItemMutation.mutateAsync({
      kind: deleteTarget.kind,
      id: deleteTarget.id,
    })

    if (selectedFileId === deleteTarget.id) {
      setSelectedFileId(null)
    }

    if (inspectorTarget?.id === deleteTarget.id) {
      setInspectorTarget(null)
    }

    if (deleteTarget.kind === 'folder') {
      startTransition(() => {
        setSelectedFolderId(deleteTarget.parentId ?? rootFolderId)
        setSelectedFileId(null)
      })
    }

    setDeleteTarget(null)
  }

  async function handleConfirmMove(): Promise<void> {
    if (moveTarget === null || moveDestinationFolderId.length === 0) {
      return
    }

    await moveItemMutation.mutateAsync({
      kind: moveTarget.kind,
      id: moveTarget.id,
      destinationFolderId: moveDestinationFolderId,
    })

    if (selectedFileId === moveTarget.id) {
      setSelectedFileId(null)
    }

    if (inspectorTarget?.id === moveTarget.id) {
      setInspectorTarget(null)
    }

    setMoveTarget(null)
    setMoveDestinationFolderId('')
  }

  async function handleConfirmCreateFolder(): Promise<void> {
    resetActionErrors()

    if (selectedFolderId === null) {
      setActionErrorMessage('Select a folder before creating a nested folder.')
      return
    }

    const createdFolder = await createFolderMutation.mutateAsync({
      parentId: selectedFolderId,
      name: newFolderName,
    })

    setNewFolderName('')
    setIsCreateFolderModalOpen(false)

    startTransition(() => {
      setSelectedFolderId(createdFolder.id)
      setSelectedFileId(null)
      setInspectorTarget(null)
    })
  }

  async function handleUpload(files: File[]): Promise<void> {
    resetActionErrors()

    if (selectedFolderId === null) {
      setActionErrorMessage('Select a folder before uploading files.')
      return
    }

    await uploadFilesMutation.mutateAsync({
      folderId: selectedFolderId,
      files,
    })

    setSelectedFileId(null)
    setInspectorTarget(null)
    setIsUploadModalOpen(false)
  }

  const sidebarContent = (
    <>
      <div className="flex-1 overflow-y-auto px-3 py-3">
        <section className="rounded-2xl border border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--card-bg)_80%,transparent)] px-2 py-2">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--outline)]">
            My Drive
          </div>

          {folderTreeQuery.isPending ? (
            <div className="flex items-center justify-center py-8">
              <LoaderCircle className="size-4 animate-spin text-[var(--primary)]" />
            </div>
          ) : null}

          {folderTreeQuery.error !== null ? (
            <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-3 py-2 text-xs text-[var(--on-error-container)]">
              {folderTreeQuery.error.message}
            </div>
          ) : null}

          {myDriveTree !== undefined && selectedFolderId !== null ? (
            <FolderTree
              tree={myDriveTree}
              rootLabel="My Drive"
              selectedFolderId={selectedFolderId}
              onSelectFolder={handleOpenFolder}
            />
          ) : null}
        </section>

        <section className="mt-5">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--outline)]">
            Shared
          </div>

          <div className="space-y-0.5">
            {sharedFolderNodes.length === 0 ? (
              <div className="px-3 py-2 text-sm text-[var(--secondary)]">No shared folders</div>
            ) : (
              sharedFolderNodes.map((node) => (
                <div
                  key={node.folder.id}
                  className="rounded-2xl border border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--card-bg)_72%,transparent)] px-2 py-2"
                >
                  <FolderTree
                    tree={node}
                    selectedFolderId={selectedFolderId ?? ''}
                    onSelectFolder={handleOpenFolder}
                  />
                </div>
              ))
            )}
          </div>
        </section>

        <section className="mt-5 border-t border-[var(--outline-variant)] pt-4">
          <div className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--outline)]">
            Library
          </div>

          <div className="space-y-0.5">
            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-[var(--surface-container-low)] ${
                currentPage === 'favorites'
                  ? 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]'
                  : 'text-[var(--on-surface)]'
              }`}
              type="button"
              onClick={() => {
                setCurrentPage('favorites')
                onCloseMobileSidebar()
              }}
            >
              <Bookmark className="size-4 shrink-0 text-[var(--secondary)]" />
              <span>Favorites</span>
            </button>

            <button
              className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-[var(--surface-container-low)] ${
                currentPage === 'trash'
                  ? 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]'
                  : 'text-[var(--on-surface)]'
              }`}
              type="button"
              onClick={() => {
                setCurrentPage('trash')
                onCloseMobileSidebar()
              }}
            >
              <Trash2 className="size-4 shrink-0 text-[var(--secondary)]" />
              <span>Trash</span>
            </button>
          </div>
        </section>
      </div>

      <div className="border-t border-[var(--outline-variant)] p-3">
        <StorageBar />
      </div>
    </>
  )

  return (
    <>
      <div className="flex min-h-0 flex-1">
        {isMobileSidebarOpen ? (
          <button
            className="fixed inset-0 z-30 bg-black/28 backdrop-blur-[1px] lg:hidden"
            type="button"
            aria-label="Close sidebar"
            onClick={onCloseMobileSidebar}
          />
        ) : null}

        <aside
          className={`fixed inset-y-14 left-0 z-40 flex w-60 flex-col border-r border-[var(--outline-variant)] bg-[var(--surface)] transition-transform duration-300 ease-out lg:hidden ${
            isMobileSidebarOpen ? 'translate-x-0 shadow-xl' : '-translate-x-full'
          }`}
          aria-hidden={!isMobileSidebarOpen}
        >
          {sidebarContent}
        </aside>

        <aside className="hidden w-60 shrink-0 border-r border-[var(--outline-variant)] bg-[var(--surface)] lg:flex lg:flex-col">
          {sidebarContent}
        </aside>

        <main className="flex min-w-0 flex-1 flex-col">
          {currentPage === 'favorites' ? (
            <FavoritesPage />
          ) : currentPage === 'trash' ? (
            <TrashPage />
          ) : isFolderContentsLoading ? (
            <div className="flex flex-1 items-center justify-center p-8">
              <div className="flex flex-col items-center gap-2">
                <LoaderCircle className="size-5 animate-spin text-[var(--primary)]" />
                <p className="text-sm text-[var(--secondary)]">Loading...</p>
              </div>
            </div>
          ) : null}

          {currentPage === 'files' && folderContentsQuery.error !== null ? (
            <div className="p-6">
              <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
                {folderContentsQuery.error.message}
              </div>
            </div>
          ) : null}

          {currentPage === 'files' && actionErrorMessage !== null ? (
            <div className="p-6">
              <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
                {actionErrorMessage}
              </div>
            </div>
          ) : null}

          {currentPage === 'files' && currentContents !== null ? (
            <LibraryPanel
              busyItemId={busyItemId}
              contents={currentContents}
              inspectedFolderId={inspectedFolder?.id ?? null}
              isLoadingMoreFiles={folderContentsQuery.isFetchingNextPage}
              isSearchingSubfolders={folderContentsQueryInput.searchIncludesDirectChildren}
              onLoadMoreFiles={() => {
                if (folderContentsQuery.hasNextPage) {
                  void folderContentsQuery.fetchNextPage()
                }
              }}
              selectedFileId={activeInspectorFile?.id ?? selectedFileId}
              showFilesLoadingState={folderContentsQuery.isFetching && currentContents.files.length === 0}
              onOpenCreateFolder={handleOpenCreateFolderModal}
              onOpenUpload={() => setIsUploadModalOpen(true)}
              onOpenFolder={handleOpenFolder}
              onRequestDeleteFolder={handleRequestDeleteFolder}
              onRequestDeleteFile={handleRequestDeleteFile}
              onRequestDownloadFolder={(folder) => {
                void handleRequestDownloadFolder(folder)
              }}
              onRequestDownloadFile={(file) => {
                void handleRequestDownloadFile(file)
              }}
              onRequestMoveFolder={handleRequestMoveFolder}
              onRequestMoveFile={handleRequestMoveFile}
              onRequestShowFolderProperties={handleRequestShowFolderProperties}
              onRequestShowFileProperties={handleRequestShowFileProperties}
              onSelectFile={handleSelectFile}
            />
          ) : null}

          {inspectedFolder !== null ? (
            <MediaViewer
              currentFolderName={currentContents?.currentFolder.name ?? null}
              inspectedFolder={inspectedFolder}
              isPreviewLoading={false}
              mode="properties"
              previewErrorMessage={null}
              previewUrl={null}
              selectedFile={null}
              onClose={() => {
                startTransition(() => {
                  setSelectedFileId(null)
                  setInspectorTarget(null)
                })
              }}
            />
          ) : null}
        </main>
      </div>

      {activeInspectorFile !== null ? (
        <MediaViewer
          currentFolderName={currentContents?.currentFolder.name ?? null}
          inspectedFolder={null}
          isPreviewLoading={filePreview.isPending}
          mode={activeInspectorMode}
          previewErrorMessage={filePreview.error?.message ?? null}
          previewUrl={filePreview.previewUrl}
          selectedFile={activeInspectorFile}
          onClose={() => {
            startTransition(() => {
              setSelectedFileId(null)
              setInspectorTarget(null)
            })
          }}
        />
      ) : null}

      {currentContents !== null && isUploadModalOpen ? (
        <UploadPanel
          currentFolderName={currentContents.currentFolder.name}
          existingFileNames={currentContents.existingFileNames}
          errorMessage={uploadFilesMutation.error?.message ?? null}
          isPending={uploadFilesMutation.isPending}
          onClose={() => setIsUploadModalOpen(false)}
          onUpload={handleUpload}
        />
      ) : null}

      <CreateFolderModal
        open={isCreateFolderModalOpen}
        folderName={newFolderName}
        errorMessage={createFolderMutation.error?.message ?? null}
        isPending={createFolderMutation.isPending}
        onChangeFolderName={setNewFolderName}
        onCancel={() => {
          setIsCreateFolderModalOpen(false)
          setNewFolderName('')
          createFolderMutation.reset()
        }}
        onConfirm={() => {
          void handleConfirmCreateFolder()
        }}
      />

      <MoveItemModal
        open={moveTarget !== null}
        destinationFolderId={moveDestinationFolderId}
        destinations={moveDestinations}
        errorMessage={moveErrorMessage}
        isPending={moveItemMutation.isPending}
        itemKind={moveTarget?.kind ?? 'file'}
        itemName={moveTarget?.name ?? ''}
        onCancel={() => {
          setMoveTarget(null)
          setMoveDestinationFolderId('')
          moveItemMutation.reset()
        }}
        onChangeDestination={setMoveDestinationFolderId}
        onConfirm={() => {
          void handleConfirmMove()
        }}
      />

      <ConfirmationModal
        open={deleteTarget !== null}
        title={
          deleteTarget?.kind === 'folder'
            ? `Delete folder "${deleteTarget.name}"?`
            : `Delete file "${deleteTarget?.name ?? ''}"?`
        }
        description={
          deleteTarget?.kind === 'folder'
            ? 'This will remove the folder and any nested files or folders from the backend.'
            : 'This removes the file from the backend and the current library view.'
        }
        confirmLabel={deleteTarget?.kind === 'folder' ? 'Delete folder' : 'Delete file'}
        cancelLabel="Keep it"
        tone="danger"
        isPending={deleteItemMutation.isPending}
        errorMessage={deleteErrorMessage}
        onCancel={() => setDeleteTarget(null)}
        onConfirm={() => {
          void handleConfirmDelete()
        }}
      />
    </>
  )
}
