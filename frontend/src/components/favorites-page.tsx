import { Bookmark, FileText, Folder, Image, Music, Video, X } from 'lucide-react'
import { useFavoritesQuery, useRemoveFavoriteMutation } from '../hooks/use-library.ts'
import { formatBytes } from '../utils/format.ts'

function FavoritesFileIcon(props: { mediaKind: string }): React.JSX.Element {
  const className = 'size-5'
  switch (props.mediaKind) {
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

export function FavoritesPage(): React.JSX.Element {
  const favoritesQuery = useFavoritesQuery()
  const removeFavoriteMutation = useRemoveFavoriteMutation()

  if (favoritesQuery.isPending) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <p className="text-sm text-[var(--secondary)]">Loading favorites...</p>
      </div>
    )
  }

  if (favoritesQuery.error !== null) {
    return (
      <div className="p-6">
        <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
          {favoritesQuery.error.message}
        </div>
      </div>
    )
  }

  const items = favoritesQuery.data ?? []

  return (
    <div className="flex flex-1 flex-col p-6 animate-[fade-in_200ms_ease-out]">
      <div className="mb-5 flex items-center gap-2">
        <Bookmark className="size-5 text-[var(--primary)]" />
        <h1 className="text-lg font-semibold text-[var(--on-surface)]">Favorites</h1>
        <span className="ml-1 text-sm text-[var(--secondary)]">
          ({items.length} item{items.length !== 1 ? 's' : ''})
        </span>
      </div>

      {items.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-[var(--outline-variant)]">
          {items.map((item) => (
            <div
              key={`${item.itemKind}:${item.itemId}`}
              className="group/item flex items-center gap-3 border-b border-[var(--outline-variant)] last:border-b-0"
            >
              <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5">
                {item.itemKind === 'folder' ? (
                  <Folder className="size-5 shrink-0 text-[var(--primary)]" />
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-container)] text-[var(--secondary)]">
                    <FavoritesFileIcon mediaKind={item.mediaKind} />
                  </div>
                )}
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--on-surface)]">
                  {item.displayName}
                </span>
                {item.itemKind === 'file' && item.sizeBytes !== null ? (
                  <span className="hidden shrink-0 text-xs text-[var(--secondary)] sm:inline">
                    {formatBytes(item.sizeBytes)}
                  </span>
                ) : null}
                {item.itemKind === 'folder' ? (
                  <span className="hidden shrink-0 text-xs text-[var(--secondary)] sm:inline">
                    Folder
                  </span>
                ) : null}
              </div>
              <button
                aria-label={`Remove ${item.displayName} from favorites`}
                className="mr-2 inline-flex size-8 items-center justify-center rounded-lg text-[var(--secondary)] opacity-0 transition-all hover:bg-[var(--surface-container-low)] group-hover/item:opacity-100"
                type="button"
                disabled={removeFavoriteMutation.isPending}
                onClick={() => removeFavoriteMutation.mutate(item.itemId)}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] p-12">
          <div className="flex flex-col items-center gap-2 text-center">
            <Bookmark className="size-8 text-[var(--outline)]" />
            <p className="text-sm text-[var(--secondary)]">
              No favorites yet. Bookmark files and folders to see them here.
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
