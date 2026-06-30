import { useEffect } from 'react'
import { useWorkspaceStore, type AppPage } from '../stores/workspace-store.ts'

function updateUrl(folderId: string | null, fileId: string | null, page: AppPage): void {
  const params = new URLSearchParams()

  if (folderId !== null) params.set('folder', folderId)
  if (fileId !== null) params.set('file', fileId)
  if (page !== 'files') params.set('page', page)

  const search = params.toString()
  const newUrl = search ? `?${search}` : window.location.pathname

  window.history.replaceState(null, '', newUrl)
}

export function useUrlSync(): void {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const folderId = params.get('folder') ?? null
    const fileId = params.get('file') ?? null
    const pageParam = params.get('page')
    const page: AppPage =
      pageParam === 'account'
        ? 'account'
        : pageParam === 'search'
          ? 'search'
        : pageParam === 'favorites'
          ? 'favorites'
          : pageParam === 'trash'
            ? 'trash'
            : 'files'

    const store = useWorkspaceStore.getState()
    store.setSelectedFolderId(folderId)
    store.setSelectedFileId(fileId)
    if (page !== 'files') store.setCurrentPage(page)

    updateUrl(folderId, fileId, page)
  }, [])

  useEffect(() => {
    const unsub = useWorkspaceStore.subscribe((state) => {
      updateUrl(state.selectedFolderId, state.selectedFileId, state.currentPage)
    })
    return unsub
  }, [])
}
