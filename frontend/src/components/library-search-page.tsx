import { ArrowDownAZ, ArrowLeft, ArrowUpAZ, LayoutGrid, List, Search, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspaceStore, type LibrarySortField, type MediaKindFilter } from '../stores/workspace-store.ts'
import { cn } from '../lib/cn.ts'
import { cardClass, fieldInputClass, ghostButtonClass, iconButtonClass, primaryButtonClass, secondaryButtonClass } from '../lib/ui.ts'

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
    librarySearchDraft,
    librarySortDirection,
    librarySortField,
    libraryTypeFilter,
    setCurrentPage,
    setLibraryExtensionFilter,
    setLibrarySearchDraft,
    setLibrarySearchTerm,
    setLibrarySortDirection,
    setLibrarySortField,
    setLibraryTypeFilter,
    setViewMode,
    viewMode,
  } = useWorkspaceStore(
    useShallow((state) => ({
      libraryExtensionFilter: state.libraryExtensionFilter,
      librarySearchDraft: state.librarySearchDraft,
      librarySortDirection: state.librarySortDirection,
      librarySortField: state.librarySortField,
      libraryTypeFilter: state.libraryTypeFilter,
      setCurrentPage: state.setCurrentPage,
      setLibraryExtensionFilter: state.setLibraryExtensionFilter,
      setLibrarySearchDraft: state.setLibrarySearchDraft,
      setLibrarySearchTerm: state.setLibrarySearchTerm,
      setLibrarySortDirection: state.setLibrarySortDirection,
      setLibrarySortField: state.setLibrarySortField,
      setLibraryTypeFilter: state.setLibraryTypeFilter,
      setViewMode: state.setViewMode,
      viewMode: state.viewMode,
    })),
  )

  const extensionOptions = ['all', ...props.availableExtensions]
  const activeFilterCount =
    (libraryTypeFilter !== 'all' ? 1 : 0)
    + (libraryExtensionFilter !== 'all' ? 1 : 0)
    + (librarySortField !== 'name' || librarySortDirection !== 'asc' ? 1 : 0)
    + (viewMode !== 'grid' ? 1 : 0)
  const [isControlsOpen, setIsControlsOpen] = useState(false)

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault()
    setLibrarySearchTerm(librarySearchDraft.trim())
  }

  return (
    <div className="flex flex-col p-4 animate-[fade-in_200ms_ease-out] sm:p-6">
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
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
            <h1 className="text-2xl font-semibold tracking-tight text-[var(--on-surface)]">
              Find things in {props.currentFolderName}
            </h1>
          </div>
        </div>

        <form className={cn(cardClass, 'overflow-hidden')} onSubmit={handleSubmit}>
          <div className="border-b border-[var(--outline-variant)] px-5 py-4">
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="relative block flex-1">
                <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-[var(--outline)]" />
                <input
                  autoFocus
                  aria-label="Search files and folders"
                  className="h-12 w-full rounded-xl border border-[var(--outline-variant)] bg-[var(--surface-container-low)] pl-11 pr-4 text-base text-[var(--on-surface)] placeholder:text-[var(--outline)] transition-colors focus:border-[var(--primary)] focus:bg-[var(--card-bg)] focus:outline-none"
                  placeholder="Search files and folders"
                  type="search"
                  value={librarySearchDraft}
                  onChange={(event) => setLibrarySearchDraft(event.currentTarget.value)}
                />
              </label>

              <button className={`${primaryButtonClass} h-12 shrink-0 px-5`} type="submit">
                <Search className="size-4" />
                Search
              </button>

              <button
                aria-expanded={isControlsOpen}
                className={`${secondaryButtonClass} h-12 shrink-0 px-4`}
                type="button"
                onClick={() => setIsControlsOpen((open) => !open)}
              >
                <SlidersHorizontal className="size-4" />
                {activeFilterCount > 0 ? `Filters (${activeFilterCount})` : 'Filters'}
              </button>
            </div>
          </div>

          {isControlsOpen ? (
            <div className="border-t border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-5 py-5">
              <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:gap-3">
                <div className="min-w-0 flex-1 xl:max-w-[18rem]">
                  <label className="mb-2 block text-sm font-medium text-[var(--on-surface)]" htmlFor="library-sort-field">
                    Sort by
                  </label>
                  <div className="flex gap-2">
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

                <div className="min-w-0 flex-1 xl:max-w-[16rem]">
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

                <div className="min-w-0 flex-1 xl:max-w-[16rem]">
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

                <div className="xl:ml-auto">
                  <label className="mb-2 block text-sm font-medium text-[var(--on-surface)]">
                    View mode
                  </label>
                  <div className="inline-flex items-center rounded-xl border border-[var(--outline-variant)] bg-[var(--card-bg)] p-1">
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
            </div>
          ) : null}
        </form>
      </div>
    </div>
  )
}
