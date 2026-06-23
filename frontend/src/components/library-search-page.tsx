import { ArrowDownAZ, ArrowLeft, ArrowUpAZ, LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react'
import { useWorkspaceStore, type LibrarySortField, type MediaKindFilter } from '../stores/workspace-store.ts'
import { cn } from '../lib/cn.ts'
import { cardClass, fieldInputClass, ghostButtonClass, iconButtonClass } from '../lib/ui.ts'

const fileTypeOptions: Array<{ label: string; value: MediaKindFilter }> = [
  { label: 'All types', value: 'all' },
  { label: 'Images', value: 'image' },
  { label: 'Videos', value: 'video' },
  { label: 'Audio', value: 'audio' },
  { label: 'Documents', value: 'document' },
  { label: 'Archives', value: 'archive' },
  { label: 'Other', value: 'other' },
]

interface LibrarySearchPageProps {
  availableExtensions: string[]
  currentFolderName: string
  isSearchingSubfolders: boolean
}

export function LibrarySearchPage(props: LibrarySearchPageProps): React.JSX.Element {
  const {
    libraryExtensionFilter,
    librarySearchTerm,
    librarySortDirection,
    librarySortField,
    libraryTypeFilter,
    setCurrentPage,
    setLibraryExtensionFilter,
    setLibrarySearchTerm,
    setLibrarySortDirection,
    setLibrarySortField,
    setLibraryTypeFilter,
    setViewMode,
    viewMode,
  } = useWorkspaceStore((state) => ({
    libraryExtensionFilter: state.libraryExtensionFilter,
    librarySearchTerm: state.librarySearchTerm,
    librarySortDirection: state.librarySortDirection,
    librarySortField: state.librarySortField,
    libraryTypeFilter: state.libraryTypeFilter,
    setCurrentPage: state.setCurrentPage,
    setLibraryExtensionFilter: state.setLibraryExtensionFilter,
    setLibrarySearchTerm: state.setLibrarySearchTerm,
    setLibrarySortDirection: state.setLibrarySortDirection,
    setLibrarySortField: state.setLibrarySortField,
    setLibraryTypeFilter: state.setLibraryTypeFilter,
    setViewMode: state.setViewMode,
    viewMode: state.viewMode,
  }))

  const extensionOptions = ['all', ...props.availableExtensions]
  const activeFilterCount =
    (libraryTypeFilter !== 'all' ? 1 : 0)
    + (libraryExtensionFilter !== 'all' ? 1 : 0)
    + (librarySortField !== 'name' || librarySortDirection !== 'asc' ? 1 : 0)

  return (
    <div className="flex flex-1 flex-col p-4 animate-[fade-in_200ms_ease-out] sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-2">
            <button
              className={`${ghostButtonClass} -ml-3 w-fit px-3`}
              type="button"
              onClick={() => setCurrentPage('files')}
            >
              <ArrowLeft className="size-4" />
              Back to files
            </button>

            <div>
              <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--primary)_5%,var(--card-bg))] px-3 py-1 text-xs font-medium text-[var(--primary)]">
                <SlidersHorizontal className="size-3.5" />
                Search and organize
              </div>
              <h1 className="text-2xl font-semibold tracking-tight text-[var(--on-surface)]">
                Find things in {props.currentFolderName}
              </h1>
              <p className="mt-1 text-sm text-[var(--secondary)]">
                Search, sort, and tune what shows up in your current library view.
              </p>
            </div>
          </div>

          <div className="rounded-2xl border border-[var(--outline-variant)] bg-[var(--card-bg)] px-4 py-3 text-sm text-[var(--secondary)] shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
            <div className="font-medium text-[var(--on-surface)]">Current view</div>
            <div className="mt-1">{activeFilterCount} active filter{activeFilterCount === 1 ? '' : 's'}</div>
            <div>{props.isSearchingSubfolders && librarySearchTerm.trim().length > 0 ? 'Also checks direct subfolders' : 'Current folder focused'}</div>
          </div>
        </div>

        <section className={cn(cardClass, 'overflow-hidden')}>
          <div className="border-b border-[var(--outline-variant)] px-5 py-4">
            <label className="relative block">
              <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--outline)]" />
              <input
                autoFocus
                aria-label="Search files and folders"
                className="h-12 w-full rounded-xl border border-[var(--outline-variant)] bg-[var(--surface-container-low)] pl-11 pr-4 text-base text-[var(--on-surface)] placeholder:text-[var(--outline)] transition-colors focus:border-[var(--primary)] focus:bg-[var(--card-bg)] focus:outline-none"
                placeholder="Search files and folders"
                type="search"
                value={librarySearchTerm}
                onChange={(event) => setLibrarySearchTerm(event.currentTarget.value)}
              />
            </label>
          </div>

          <div className="grid gap-4 px-5 py-5 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div className="space-y-4">
              <div>
                <label className="mb-2 block text-sm font-medium text-[var(--on-surface)]" htmlFor="library-sort-field">
                  Sort by
                </label>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    id="library-sort-field"
                    className={fieldInputClass}
                    value={librarySortField}
                    onChange={(event) => setLibrarySortField(event.currentTarget.value as LibrarySortField)}
                  >
                    <option value="name">Name</option>
                    <option value="date">Date</option>
                    <option value="size">Size</option>
                    <option value="type">Type</option>
                  </select>

                  <button
                    aria-label={librarySortDirection === 'asc' ? 'Ascending sort' : 'Descending sort'}
                    className={`${iconButtonClass} shrink-0`}
                    type="button"
                    onClick={() => setLibrarySortDirection(librarySortDirection === 'asc' ? 'desc' : 'asc')}
                  >
                    {librarySortDirection === 'asc' ? <ArrowUpAZ className="size-4" /> : <ArrowDownAZ className="size-4" />}
                  </button>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--on-surface)]" htmlFor="library-type-filter">
                    File type
                  </label>
                  <select
                    id="library-type-filter"
                    className={fieldInputClass}
                    value={libraryTypeFilter}
                    onChange={(event) => setLibraryTypeFilter(event.currentTarget.value as MediaKindFilter)}
                  >
                    {fileTypeOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--on-surface)]" htmlFor="library-extension-filter">
                    Extension
                  </label>
                  <select
                    id="library-extension-filter"
                    className={fieldInputClass}
                    value={extensionOptions.includes(libraryExtensionFilter) ? libraryExtensionFilter : 'all'}
                    onChange={(event) => setLibraryExtensionFilter(event.currentTarget.value)}
                  >
                    <option value="all">All extensions</option>
                    {extensionOptions
                      .filter((extension) => extension !== 'all')
                      .map((extension) => (
                        <option key={extension} value={extension}>.{extension}</option>
                      ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-4">
              <div className="text-sm font-medium text-[var(--on-surface)]">View mode</div>
              <div className="mt-3 inline-flex items-center rounded-xl border border-[var(--outline-variant)] bg-[var(--card-bg)] p-1">
                <button
                  aria-label="Grid view"
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                    viewMode === 'grid'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--secondary)] hover:bg-[var(--surface-container-low)]',
                  )}
                  type="button"
                  onClick={() => setViewMode('grid')}
                >
                  <LayoutGrid className="size-4" />
                  Grid
                </button>
                <button
                  aria-label="List view"
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium transition-colors',
                    viewMode === 'list'
                      ? 'bg-[var(--primary)] text-white'
                      : 'text-[var(--secondary)] hover:bg-[var(--surface-container-low)]',
                  )}
                  type="button"
                  onClick={() => setViewMode('list')}
                >
                  <List className="size-4" />
                  List
                </button>
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  )
}
