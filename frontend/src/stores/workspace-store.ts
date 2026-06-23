import { create } from 'zustand'
import type {
  FolderEntriesSortDirection,
  FolderEntriesSortField,
  FolderEntriesTypeFilter,
} from '../types/library.ts'

export type WorkspaceViewMode = 'grid' | 'list'
export type AppPage = 'files' | 'account' | 'favorites' | 'trash'
export type LibrarySortField = FolderEntriesSortField
export type SortDirection = FolderEntriesSortDirection
export type MediaKindFilter = FolderEntriesTypeFilter

interface WorkspaceStore {
  selectedFolderId: string | null
  selectedFileId: string | null
  viewMode: WorkspaceViewMode
  currentPage: AppPage
  darkMode: boolean
  librarySortField: LibrarySortField
  librarySortDirection: SortDirection
  libraryTypeFilter: MediaKindFilter
  libraryExtensionFilter: string
  librarySearchTerm: string
  setSelectedFolderId: (folderId: string | null) => void
  setSelectedFileId: (fileId: string | null) => void
  setViewMode: (viewMode: WorkspaceViewMode) => void
  setCurrentPage: (page: AppPage) => void
  setLibrarySortField: (field: LibrarySortField) => void
  setLibrarySortDirection: (direction: SortDirection) => void
  setLibraryTypeFilter: (filter: MediaKindFilter) => void
  setLibraryExtensionFilter: (filter: string) => void
  setLibrarySearchTerm: (value: string) => void
  toggleDarkMode: () => void
  reset: () => void
}

function getInitialDarkMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const stored = localStorage.getItem('homeserver-dark-mode')
    if (stored !== null) return stored === 'true'
  } catch { /* localStorage unavailable */ }
  return window.matchMedia('(prefers-color-scheme: dark)').matches
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  selectedFolderId: null,
  selectedFileId: null,
  viewMode: 'grid',
  currentPage: 'files',
  darkMode: getInitialDarkMode(),
  librarySortField: 'name',
  librarySortDirection: 'asc',
  libraryTypeFilter: 'all',
  libraryExtensionFilter: 'all',
  librarySearchTerm: '',
  setSelectedFolderId: (folderId) => {
    set({ selectedFolderId: folderId })
  },
  setSelectedFileId: (fileId) => {
    set({ selectedFileId: fileId })
  },
  setViewMode: (viewMode) => {
    set({ viewMode })
  },
  setCurrentPage: (page) => {
    set({ currentPage: page })
  },
  setLibrarySortField: (field) => {
    set({ librarySortField: field })
  },
  setLibrarySortDirection: (direction) => {
    set({ librarySortDirection: direction })
  },
  setLibraryTypeFilter: (filter) => {
    set({ libraryTypeFilter: filter })
  },
  setLibraryExtensionFilter: (filter) => {
    set({ libraryExtensionFilter: filter })
  },
  setLibrarySearchTerm: (value) => {
    set({ librarySearchTerm: value })
  },
  toggleDarkMode: () => {
    set((state) => {
      const next = !state.darkMode
      try {
        localStorage.setItem('homeserver-dark-mode', String(next))
      } catch {
        /* localStorage unavailable */
      }
      return { darkMode: next }
    })
  },
  reset: () => {
    set({
      selectedFolderId: null,
      selectedFileId: null,
      viewMode: 'grid',
      currentPage: 'files',
      librarySortField: 'name',
      librarySortDirection: 'asc',
      libraryTypeFilter: 'all',
      libraryExtensionFilter: 'all',
      librarySearchTerm: '',
    })
  },
}))
