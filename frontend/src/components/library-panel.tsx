import {
  ArrowRightLeft,
  Bookmark,
  ChevronRight,
  Download,
  FileText,
  Folder,
  FolderPlus,
  Image,
  Info,
  LoaderCircle,
  MoreHorizontal,
  Music,
  Trash2,
  Upload,
  Video,
} from 'lucide-react'
import { useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '../lib/cn.ts'
import { primaryButtonClass, secondaryButtonClass } from '../lib/ui.ts'
import {
  useAddFavoriteMutation,
  useFavoritesQuery,
  useRemoveFavoriteMutation,
} from '../hooks/use-library.ts'
import {
  useWorkspaceStore,
  type LibrarySortField,
} from '../stores/workspace-store.ts'
import type { FileRecord, FolderContents, FolderRecord } from '../types/library.ts'
import { formatBytes, formatMediaKind, formatRelativeTime } from '../utils/format.ts'

function compareText(left: string, right: string): number {
  return left.localeCompare(right, undefined, { sensitivity: 'base', numeric: true })
}

function compareNumbers(left: number, right: number): number {
  return left - right
}

function compareDates(left: string, right: string): number {
  return compareNumbers(new Date(left).getTime(), new Date(right).getTime())
}

function sortFolders(
  folders: FolderRecord[],
  sortField: LibrarySortField,
  sortDirection: 'asc' | 'desc',
): FolderRecord[] {
  const direction = sortDirection === 'asc' ? 1 : -1

  return [...folders].sort((left, right) => {
    const comparison =
      sortField === 'date'
        ? compareDates(left.createdAt, right.createdAt)
        : compareText(left.name, right.name)

    return comparison * direction
  })
}

interface LibraryPanelProps {
  contents: FolderContents
  selectedFileId: string | null
  inspectedFolderId: string | null
  busyItemId: string | null
  isLoadingMoreFiles: boolean
  isSearchingSubfolders: boolean
  onOpenUpload: () => void
  onOpenCreateFolder: () => void
  onLoadMoreFiles: () => void
  onOpenFolder: (folderId: string) => void
  onSelectFile: (fileId: string) => void
  onRequestDeleteFolder: (folder: FolderRecord) => void
  onRequestDeleteFile: (file: FileRecord) => void
  onRequestDownloadFolder: (folder: FolderRecord) => void
  onRequestDownloadFile: (file: FileRecord) => void
  onRequestMoveFolder: (folder: FolderRecord) => void
  onRequestMoveFile: (file: FileRecord) => void
  onRequestShowFolderProperties: (folder: FolderRecord) => void
  onRequestShowFileProperties: (file: FileRecord) => void
  showFilesLoadingState: boolean
}

function FileIcon(props: { file: FileRecord }): React.JSX.Element {
  const className = 'size-5'
  switch (props.file.mediaKind) {
    case 'image':
      return <Image className={className} />
    case 'audio':
      return <Music className={className} />
    case 'video':
      return <Video className={className} />
    default:
      return <FileText className={className} />
  }
}

function ActionMenu(props: {
  menuId: string
  openMenuId: string | null
  busy: boolean
  itemLabel: string
  onToggle: (menuId: string) => void
  onClose: () => void
  onDelete: () => void
  onDownload: () => void
  onMove: () => void
  onProperties: () => void
}): React.JSX.Element {
  const isOpen = props.openMenuId === props.menuId

  return (
    <div className={cn('relative shrink-0', isOpen ? 'z-30' : '')}>
      <button
        aria-expanded={isOpen}
        aria-haspopup="menu"
        aria-label={`Actions for ${props.itemLabel}`}
        className="inline-flex size-8 items-center justify-center rounded-lg text-[var(--secondary)] opacity-100 transition-all hover:bg-[var(--surface-container-low)] sm:opacity-0 sm:group-hover/item:opacity-100 data-[open=true]:opacity-100"
        data-open={isOpen}
        type="button"
        onClick={() => props.onToggle(props.menuId)}
        disabled={props.busy}
      >
        {props.busy ? (
          <LoaderCircle className="size-4 animate-spin" />
        ) : (
          <MoreHorizontal className="size-4" />
        )}
      </button>

      {isOpen ? (
        <>
          <div className="fixed inset-0 z-30" onClick={props.onClose} />
          <div className="absolute right-0 top-full z-40 mt-1 min-w-[180px] rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] py-1 shadow-lg">
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]"
              type="button"
              onClick={() => { props.onClose(); props.onProperties() }}
            >
              <Info className="size-4" />
              Properties
            </button>
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]"
              type="button"
              onClick={() => { props.onClose(); props.onDownload() }}
            >
              <Download className="size-4" />
              Download
            </button>
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)]"
              type="button"
              onClick={() => { props.onClose(); props.onMove() }}
            >
              <ArrowRightLeft className="size-4" />
              Move
            </button>
            <hr className="mx-3 border-[var(--outline-variant)]" />
            <button
              className="flex w-full items-center gap-3 px-4 py-2 text-sm text-[var(--error)] transition-colors hover:bg-[var(--surface-container-low)]"
              type="button"
              onClick={() => { props.onClose(); props.onDelete() }}
            >
              <Trash2 className="size-4" />
              Delete
            </button>
          </div>
        </>
      ) : null}
    </div>
  )
}

export function LibraryPanel(props: LibraryPanelProps): React.JSX.Element {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null)
  const loadMoreRef = useRef<HTMLDivElement | null>(null)
  const {
    librarySearchTerm,
    libraryExtensionFilter,
    librarySortDirection,
    librarySortField,
    libraryTypeFilter,
    viewMode,
  } = useWorkspaceStore(
    useShallow((state) => ({
      libraryExtensionFilter: state.libraryExtensionFilter,
      librarySearchTerm: state.librarySearchTerm,
      librarySortDirection: state.librarySortDirection,
      librarySortField: state.librarySortField,
      libraryTypeFilter: state.libraryTypeFilter,
      viewMode: state.viewMode,
    })),
  )
  const favoritesQuery = useFavoritesQuery()
  const favoriteIds = useMemo(
    () => new Set(favoritesQuery.data?.map((f) => f.itemId) ?? []),
    [favoritesQuery.data],
  )
  const addFavoriteMutation = useAddFavoriteMutation()
  const removeFavoriteMutation = useRemoveFavoriteMutation()

  function handleToggleFavorite(itemId: string, itemKind: 'file' | 'folder'): void {
    if (favoriteIds.has(itemId)) {
      removeFavoriteMutation.mutate(itemId)
    } else {
      addFavoriteMutation.mutate({ itemId, itemKind })
    }
  }

  const deferredSearchTerm = useDeferredValue(librarySearchTerm)
  const normalizedQuery = deferredSearchTerm.trim().toLowerCase()
  const filteredFolders = useMemo(() => {
    const folders =
      normalizedQuery.length === 0
        ? props.contents.folders
        : props.contents.folders.filter((folder) => folder.name.toLowerCase().includes(normalizedQuery))

    return sortFolders(folders, librarySortField, librarySortDirection)
  }, [librarySortDirection, librarySortField, normalizedQuery, props.contents.folders])

  const filteredFiles = props.contents.files
  const childFolderNames = useMemo(
    () => new Map(props.contents.folders.map((folder) => [folder.id, folder.name])),
    [props.contents.folders],
  )
  const nextOffset = props.contents.nextOffset
  const isLoadingMoreFiles = props.isLoadingMoreFiles
  const onLoadMoreFiles = props.onLoadMoreFiles

  const hasActiveFileFilters = libraryTypeFilter !== 'all' || libraryExtensionFilter !== 'all'

  useEffect(() => {
    const node = loadMoreRef.current

    if (node === null || nextOffset === null || isLoadingMoreFiles) {
      return
    }

    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        onLoadMoreFiles()
      }
    }, {
      rootMargin: '320px 0px',
    })

    observer.observe(node)

    return () => observer.disconnect()
  }, [isLoadingMoreFiles, nextOffset, onLoadMoreFiles])

  return (
    <div className="flex flex-1 flex-col p-4 pb-32 animate-[fade-in_200ms_ease-out] sm:p-6 sm:pb-6">
      <div className="mb-4 overflow-x-auto pb-1 text-sm text-[var(--secondary)] sm:mb-5">
        <div className="flex min-w-max items-center gap-1.5">
        {props.contents.path.map((folder, index) => (
          <span key={folder.id} className="flex items-center gap-1.5">
            <button
              type="button"
              className="rounded-md px-1 py-0.5 transition-colors hover:text-[var(--on-surface)]"
              onClick={() => props.onOpenFolder(folder.id)}
            >
              {folder.name}
            </button>
            {index < props.contents.path.length - 1 ? (
              <ChevronRight className="size-3.5 text-[var(--outline)]" />
            ) : null}
          </span>
        ))}
        </div>
      </div>

      <div className="mb-5">
        <div className="hidden sm:flex sm:flex-wrap sm:items-center sm:gap-2">
          <button
            className={`${primaryButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onOpenUpload}
          >
            <Upload className="size-4" />
            Upload
          </button>
          <button
            aria-label="Create folder"
            className={`${secondaryButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onOpenCreateFolder}
          >
            <FolderPlus className="size-4" />
            New folder
          </button>
        </div>
      </div>

      <div className="mb-4 flex flex-col gap-1 text-xs text-[var(--secondary)] sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <span>
          {props.contents.totalFileCount === 0
            ? 'No files'
            : props.contents.nextOffset === null
              ? `${props.contents.totalFileCount} file${props.contents.totalFileCount === 1 ? '' : 's'}`
              : `${filteredFiles.length} of ${props.contents.totalFileCount} files loaded`}
        </span>
        {props.isSearchingSubfolders && normalizedQuery.length > 0 ? (
          <span>Searching this folder and direct subfolders</span>
        ) : null}
      </div>

      {filteredFolders.length > 0 ? (
        viewMode === 'grid' ? (
          <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredFolders.map((folder) => {
              const isInspected = props.inspectedFolderId === folder.id
              const isBusy = props.busyItemId === folder.id
              const menuId = `folder:${folder.id}`

              return (
                <div
                  key={folder.id}
                  className={cn(
                    'group/item relative rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-3 transition-all hover:shadow-[0_1px_6px_rgba(0,0,0,0.1)]',
                    isInspected ? 'ring-2 ring-[var(--primary)] ring-offset-1' : '',
                  )}
                >
                  <button
                    className="flex w-full flex-col items-start gap-2 text-left"
                    type="button"
                    onClick={() => props.onOpenFolder(folder.id)}
                  >
                    <div className="flex size-12 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]">
                      <Folder className="size-6" />
                    </div>
                    <span className="mt-1 line-clamp-2 text-sm font-medium text-[var(--on-surface)]">
                      {folder.name}
                    </span>
                    <span className="text-xs text-[var(--secondary)]">
                      {folder.itemCount} item{folder.itemCount !== 1 ? 's' : ''}
                    </span>
                  </button>

                  <button
                    aria-label={favoriteIds.has(folder.id) ? 'Remove from favorites' : 'Add to favorites'}
                    className={`inline-flex size-8 items-center justify-center rounded-lg transition-all hover:bg-[var(--surface-container-low)] ${
                      favoriteIds.has(folder.id)
                        ? 'text-[var(--primary)] opacity-100'
                        : 'text-[var(--secondary)] opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100'
                    }`}
                    type="button"
                    disabled={addFavoriteMutation.isPending || removeFavoriteMutation.isPending}
                    onClick={() => handleToggleFavorite(folder.id, 'folder')}
                  >
                    <Bookmark className={`size-4 ${favoriteIds.has(folder.id) ? 'fill-[var(--primary)]' : ''}`} />
                  </button>
                  <div className="absolute right-2 top-2">
                    <ActionMenu
                      menuId={menuId}
                      openMenuId={openMenuId}
                      busy={isBusy}
                      itemLabel={folder.name}
                      onToggle={(menuId) => {
                        setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                      }}
                      onClose={() => setOpenMenuId(null)}
                      onDelete={() => props.onRequestDeleteFolder(folder)}
                      onDownload={() => props.onRequestDownloadFolder(folder)}
                      onMove={() => props.onRequestMoveFolder(folder)}
                      onProperties={() => props.onRequestShowFolderProperties(folder)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="mb-6 overflow-hidden rounded-lg border border-[var(--outline-variant)]">
            {filteredFolders.map((folder) => {
              const isInspected = props.inspectedFolderId === folder.id
              const isBusy = props.busyItemId === folder.id
              const menuId = `folder:${folder.id}`

              return (
                <div
                  key={folder.id}
                  className={cn(
                    'group/item flex items-center gap-3 border-b border-[var(--outline-variant)] last:border-b-0',
                    isInspected ? 'bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]' : '',
                  )}
                >
                  <button
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left sm:gap-3 sm:px-4 sm:py-2.5"
                    type="button"
                    onClick={() => props.onOpenFolder(folder.id)}
                  >
                    <Folder className="size-5 shrink-0 text-[var(--primary)]" />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--on-surface)]">
                      {folder.name}
                    </span>
                     <span className="hidden shrink-0 text-xs text-[var(--secondary)] md:inline">
                       Folder &middot; {folder.itemCount} items
                     </span>
                     <span className="shrink-0 text-[11px] text-[var(--secondary)] md:hidden">
                       {folder.itemCount} items
                     </span>
                   </button>

                  <button
                    aria-label={favoriteIds.has(folder.id) ? 'Remove from favorites' : 'Add to favorites'}
                    className={`inline-flex size-8 items-center justify-center rounded-lg transition-all hover:bg-[var(--surface-container-low)] ${
                      favoriteIds.has(folder.id)
                        ? 'text-[var(--primary)] opacity-100'
                        : 'text-[var(--secondary)] opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100'
                    }`}
                    type="button"
                    disabled={addFavoriteMutation.isPending || removeFavoriteMutation.isPending}
                    onClick={() => handleToggleFavorite(folder.id, 'folder')}
                  >
                    <Bookmark className={`size-4 ${favoriteIds.has(folder.id) ? 'fill-[var(--primary)]' : ''}`} />
                  </button>

                  <div className="pr-2">
                    <ActionMenu
                      menuId={menuId}
                      openMenuId={openMenuId}
                      busy={isBusy}
                      itemLabel={folder.name}
                      onToggle={(menuId) => {
                        setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                      }}
                      onClose={() => setOpenMenuId(null)}
                      onDelete={() => props.onRequestDeleteFolder(folder)}
                      onDownload={() => props.onRequestDownloadFolder(folder)}
                      onMove={() => props.onRequestMoveFolder(folder)}
                      onProperties={() => props.onRequestShowFolderProperties(folder)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : null}

      {filteredFiles.length > 0 ? (
        viewMode === 'grid' ? (
           <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filteredFiles.map((file) => {
              const isSelected = props.selectedFileId === file.id
              const isBusy = props.busyItemId === file.id
              const menuId = `file:${file.id}`

              return (
                <div
                  key={file.id}
                  className={cn(
                    'group/item relative rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-3 transition-all hover:shadow-[0_1px_6px_rgba(0,0,0,0.1)]',
                    isSelected ? 'ring-2 ring-[var(--primary)] ring-offset-1' : '',
                  )}
                >
                  <button
                    className="flex w-full flex-col items-start gap-2 text-left"
                    type="button"
                    onClick={() => props.onSelectFile(file.id)}
                  >
                    <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--surface-container)] text-[var(--secondary)]">
                      <FileIcon file={file} />
                    </div>
                    <span className="mt-1 line-clamp-2 text-sm font-medium text-[var(--on-surface)]">
                      {file.name}
                    </span>
                     <span className="text-xs text-[var(--secondary)]">
                       {formatBytes(file.sizeBytes)}
                     </span>
                     {normalizedQuery.length > 0 && file.folderId !== props.contents.currentFolder.id ? (
                       <span className="text-xs text-[var(--secondary)]">
                         In {childFolderNames.get(file.folderId) ?? 'subfolder'}
                       </span>
                     ) : null}
                   </button>

                  <div className="absolute right-10 top-2">
                    <button
                      aria-label={favoriteIds.has(file.id) ? 'Remove from favorites' : 'Add to favorites'}
                      className={`inline-flex size-8 items-center justify-center rounded-lg transition-all hover:bg-[var(--surface-container-low)] ${
                      favoriteIds.has(file.id)
                          ? 'text-[var(--primary)] opacity-100'
                          : 'text-[var(--secondary)] opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100'
                      }`}
                      type="button"
                      disabled={addFavoriteMutation.isPending || removeFavoriteMutation.isPending}
                      onClick={() => handleToggleFavorite(file.id, 'file')}
                    >
                      <Bookmark className={`size-4 ${favoriteIds.has(file.id) ? 'fill-[var(--primary)]' : ''}`} />
                    </button>
                  </div>
                  <div className="absolute right-2 top-2">
                    <ActionMenu
                      menuId={menuId}
                      openMenuId={openMenuId}
                      busy={isBusy}
                      itemLabel={file.name}
                      onToggle={(menuId) => {
                        setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                      }}
                      onClose={() => setOpenMenuId(null)}
                      onDelete={() => props.onRequestDeleteFile(file)}
                      onDownload={() => props.onRequestDownloadFile(file)}
                      onMove={() => props.onRequestMoveFile(file)}
                      onProperties={() => props.onRequestShowFileProperties(file)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        ) : (
           <div className="overflow-hidden rounded-lg border border-[var(--outline-variant)]">
             <div className="hidden items-center gap-3 border-b border-[var(--outline-variant)] px-4 py-2 text-xs font-medium text-[var(--secondary)] md:flex">
              <span className="w-8 shrink-0" />
              <span className="min-w-0 flex-1">Name</span>
              <span className="hidden w-20 shrink-0 md:inline">Type</span>
              <span className="hidden w-20 shrink-0 text-right md:inline">Size</span>
              <span className="hidden w-24 shrink-0 text-right md:inline">Added</span>
              <span className="w-8 shrink-0" />
            </div>
            {filteredFiles.map((file) => {
              const isSelected = props.selectedFileId === file.id
              const isBusy = props.busyItemId === file.id
              const menuId = `file:${file.id}`

              return (
                <div
                  key={file.id}
                  className={cn(
                    'group/item flex items-center gap-3 border-b border-[var(--outline-variant)] last:border-b-0',
                    isSelected ? 'bg-[color-mix(in_srgb,var(--primary)_4%,transparent)]' : '',
                  )}
                >
                  <button
                     className="flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2.5 text-left sm:gap-3 sm:px-4 sm:py-2.5"
                    type="button"
                    onClick={() => props.onSelectFile(file.id)}
                  >
                     <div className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-container)] text-[var(--secondary)] sm:size-8">
                       <FileIcon file={file} />
                     </div>
                     <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium text-[var(--on-surface)]">
                          {file.name}
                        </div>
                       <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--secondary)] md:hidden">
                         <span>{formatMediaKind(file.mediaKind)}</span>
                         <span>{formatBytes(file.sizeBytes)}</span>
                         <span>{formatRelativeTime(file.createdAt)}</span>
                       </div>
                       {normalizedQuery.length > 0 && file.folderId !== props.contents.currentFolder.id ? (
                         <div className="truncate text-xs text-[var(--secondary)]">
                           In {childFolderNames.get(file.folderId) ?? 'subfolder'}
                        </div>
                      ) : null}
                    </div>
                    <span className="hidden w-20 shrink-0 text-xs text-[var(--secondary)] md:inline">
                      {formatMediaKind(file.mediaKind)}
                    </span>
                    <span className="hidden w-20 shrink-0 text-right text-xs text-[var(--secondary)] md:inline">
                      {formatBytes(file.sizeBytes)}
                    </span>
                     <span className="hidden w-24 shrink-0 text-right text-xs text-[var(--secondary)] md:inline">
                       {formatRelativeTime(file.createdAt)}
                     </span>
                  </button>

                  <button
                    aria-label={favoriteIds.has(file.id) ? 'Remove from favorites' : 'Add to favorites'}
                     className={`inline-flex size-8 items-center justify-center rounded-lg transition-all hover:bg-[var(--surface-container-low)] ${
                       favoriteIds.has(file.id)
                         ? 'text-[var(--primary)] opacity-100'
                         : 'text-[var(--secondary)] opacity-100 sm:opacity-0 sm:group-hover/item:opacity-100'
                     }`}
                    type="button"
                    disabled={addFavoriteMutation.isPending || removeFavoriteMutation.isPending}
                    onClick={() => handleToggleFavorite(file.id, 'file')}
                  >
                    <Bookmark className={`size-4 ${favoriteIds.has(file.id) ? 'fill-[var(--primary)]' : ''}`} />
                  </button>

                  <div className="pr-2">
                    <ActionMenu
                      menuId={menuId}
                      openMenuId={openMenuId}
                      busy={isBusy}
                      itemLabel={file.name}
                      onToggle={(menuId) => {
                        setOpenMenuId((currentId) => (currentId === menuId ? null : menuId))
                      }}
                      onClose={() => setOpenMenuId(null)}
                      onDelete={() => props.onRequestDeleteFile(file)}
                      onDownload={() => props.onRequestDownloadFile(file)}
                      onMove={() => props.onRequestMoveFile(file)}
                      onProperties={() => props.onRequestShowFileProperties(file)}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )
      ) : (
         <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] p-8 sm:p-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <Upload className="size-8 text-[var(--outline)]" />
            <p className="text-sm text-[var(--secondary)]">
              {filteredFolders.length === 0 && normalizedQuery.length === 0 && !hasActiveFileFilters
                ? 'This folder is empty'
                : 'No matching files'}
            </p>
          </div>
        </div>
      )}

      {props.showFilesLoadingState || filteredFiles.length > 0 ? (
        <div ref={loadMoreRef} className="flex justify-center py-5">
          {props.isLoadingMoreFiles || props.showFilesLoadingState ? (
            <div className="flex items-center gap-2 text-sm text-[var(--secondary)]">
              <LoaderCircle className="size-4 animate-spin" />
              <span>Loading more files</span>
            </div>
          ) : props.contents.nextOffset !== null ? (
            <span className="text-xs text-[var(--secondary)]">Scroll for more</span>
          ) : null}
        </div>
      ) : null}

      <div className="fixed inset-x-0 bottom-[4.5rem] z-20 px-4 sm:hidden">
        <div className="mx-auto grid max-w-md grid-cols-2 gap-2 rounded-2xl border border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--card-bg)_94%,white)] p-2 shadow-lg backdrop-blur">
          <button
            className={`${primaryButtonClass} h-11 w-full`}
            type="button"
            onClick={props.onOpenUpload}
          >
            <Upload className="size-4" />
            Upload
          </button>
          <button
            className={`${secondaryButtonClass} h-11 w-full`}
            type="button"
            onClick={props.onOpenCreateFolder}
          >
            <FolderPlus className="size-4" />
            Folder
          </button>
        </div>
      </div>
    </div>
  )
}
