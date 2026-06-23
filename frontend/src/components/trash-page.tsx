import {
  AlertTriangle,
  FileText,
  Folder,
  Image,
  LoaderCircle,
  Music,
  RefreshCw,
  Trash2,
  Video,
} from 'lucide-react'
import {
  useEmptyTrashMutation,
  usePermanentlyDeleteTrashItemMutation,
  useRestoreTrashItemMutation,
  useTrashQuery,
} from '../hooks/use-library.ts'
import { dangerButtonClass } from '../lib/ui.ts'
import type { TrashEntry } from '../types/library.ts'
import { formatBytes, formatRelativeTime } from '../utils/format.ts'

function TrashItemIcon(props: { entry: TrashEntry }): React.JSX.Element {
  if (props.entry.isFolder) {
    return <Folder className="size-5 text-[var(--primary)]" />
  }

  const className = 'size-5'
  switch (props.entry.mediaKind) {
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

export function TrashPage(): React.JSX.Element {
  const trashQuery = useTrashQuery()
  const restoreMutation = useRestoreTrashItemMutation()
  const permanentlyDeleteMutation = usePermanentlyDeleteTrashItemMutation()
  const emptyTrashMutation = useEmptyTrashMutation()

  const entries = trashQuery.data ?? []

  async function handleRestore(entry: TrashEntry): Promise<void> {
    await restoreMutation.mutateAsync({
      itemId: entry.id,
      isFolder: entry.isFolder,
    })
  }

  async function handlePermanentlyDelete(entry: TrashEntry): Promise<void> {
    await permanentlyDeleteMutation.mutateAsync({
      itemId: entry.id,
      isFolder: entry.isFolder,
    })
  }

  async function handleEmptyTrash(): Promise<void> {
    await emptyTrashMutation.mutateAsync()
  }

  if (trashQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="flex flex-col items-center gap-2">
          <LoaderCircle className="size-5 animate-spin text-[var(--primary)]" />
          <p className="text-sm text-[var(--secondary)]">Loading trash...</p>
        </div>
      </div>
    )
  }

  if (trashQuery.error !== null) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
          {trashQuery.error.message}
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col p-6 animate-[fade-in_200ms_ease-out]">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]">
            <Trash2 className="size-5" />
          </div>
          <div>
            <h1 className="text-lg font-semibold text-[var(--on-surface)]">Trash</h1>
            <p className="text-xs text-[var(--secondary)]">
              Items are permanently deleted after 30 days
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {entries.length > 0 ? (
            <button
              className={dangerButtonClass}
              type="button"
              onClick={() => { void handleEmptyTrash() }}
              disabled={emptyTrashMutation.isPending}
            >
              {emptyTrashMutation.isPending ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Trash2 className="size-4" />
              )}
              Empty trash
            </button>
          ) : null}
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] p-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <Trash2 className="size-8 text-[var(--outline)]" />
            <p className="text-sm text-[var(--secondary)]">Trash is empty</p>
          </div>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-[var(--outline-variant)]">
          <div className="flex items-center gap-3 border-b border-[var(--outline-variant)] px-4 py-2 text-xs font-medium text-[var(--secondary)]">
            <span className="w-5 shrink-0" />
            <span className="min-w-0 flex-1">Name</span>
            <span className="hidden w-20 shrink-0 md:inline">Type</span>
            <span className="hidden w-20 shrink-0 text-right md:inline">Size</span>
            <span className="hidden w-24 shrink-0 text-right md:inline">Deleted</span>
            <span className="w-40 shrink-0" />
          </div>
          {entries.map((entry) => {
            const isPending =
              restoreMutation.isPending || permanentlyDeleteMutation.isPending

            return (
              <div
                key={`${entry.isFolder ? 'folder' : 'file'}:${entry.id}`}
                className="flex items-center gap-3 border-b border-[var(--outline-variant)] last:border-b-0 hover:bg-[color-mix(in_srgb,var(--primary)_2%,transparent)]"
              >
                <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-container)] text-[var(--secondary)]">
                    <TrashItemIcon entry={entry} />
                  </div>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--on-surface)]">
                    {entry.displayName}
                  </span>
                  <span className="hidden w-20 shrink-0 text-xs text-[var(--secondary)] md:inline">
                    {entry.isFolder
                      ? 'Folder'
                      : entry.mimeType?.split('/')[0] ?? 'Unknown'}
                  </span>
                  <span className="hidden w-20 shrink-0 text-right text-xs text-[var(--secondary)] md:inline">
                    {entry.isFolder ? '—' : formatBytes(entry.sizeBytes ?? 0)}
                  </span>
                  <span className="hidden w-24 shrink-0 text-right text-xs text-[var(--secondary)] md:inline">
                    {formatRelativeTime(entry.deletedAt)}
                  </span>
                </div>

                <div className="flex shrink-0 items-center gap-1 pr-2">
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--primary)] transition-colors hover:bg-[var(--surface-container-low)]"
                    type="button"
                    disabled={isPending}
                    onClick={() => { void handleRestore(entry) }}
                  >
                    <RefreshCw className="size-3.5" />
                    Restore
                  </button>
                  <button
                    className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium text-[var(--error)] transition-colors hover:bg-[var(--error-container)]"
                    type="button"
                    disabled={isPending}
                    onClick={() => { void handlePermanentlyDelete(entry) }}
                  >
                    <Trash2 className="size-3.5" />
                    Delete forever
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {restoreMutation.error !== null ? (
        <div className="mt-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            {restoreMutation.error.message}
          </div>
        </div>
      ) : null}

      {permanentlyDeleteMutation.error !== null ? (
        <div className="mt-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
          <div className="flex items-center gap-2">
            <AlertTriangle className="size-4 shrink-0" />
            {permanentlyDeleteMutation.error.message}
          </div>
        </div>
      ) : null}

      {emptyTrashMutation.data !== undefined ? (
        <div className="mt-4 rounded-lg border border-[var(--primary-container)] bg-[var(--primary-container)] px-4 py-3 text-sm text-[var(--on-primary-container)]">
          Permanently deleted {emptyTrashMutation.data.deletedCount} items.
        </div>
      ) : null}
    </div>
  )
}
