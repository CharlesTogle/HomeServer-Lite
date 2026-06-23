import { useEffect, useMemo, useRef } from 'react'
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  addFavorite,
  createFolder,
  deleteItem,
  emptyTrash,
  getFavorites,
  getFilePreviewBlob,
  getFolderContents,
  getFolderTree,
  getSharedFolders,
  getTrash,
  isPreviewableFile,
  moveItem,
  permanentlyDeleteTrashItem,
  removeFavorite,
  restoreTrashItem,
  updateFileContent,
  uploadFiles,
  type UploadResult,
} from '../services/library-service.ts'
import type {
  CreateFolderInput,
  DeleteItemInput,
  FavoriteItem,
  FileRecord,
  FolderContents,
  FolderContentsQuery,
  FolderRecord,
  FolderTreeNode,
  MoveItemInput,
  PermanentlyDeleteTrashInput,
  RestoreTrashInput,
  TrashEntry,
  UploadInput,
} from '../types/library.ts'

export const libraryQueryKeys = {
  all: ['library'] as const,
  tree: () => [...libraryQueryKeys.all, 'tree'] as const,
  contents: (folderId: string, query: FolderContentsQuery) =>
    [...libraryQueryKeys.all, 'contents', folderId, query] as const,
  trash: () => [...libraryQueryKeys.all, 'trash'] as const,
  favorites: () => [...libraryQueryKeys.all, 'favorites'] as const,
}

export function useFolderTreeQuery(): UseQueryResult<FolderTreeNode, Error> {
  return useQuery({
    queryKey: libraryQueryKeys.tree(),
    queryFn: getFolderTree,
  })
}

export function useSharedFoldersQuery(): UseQueryResult<FolderTreeNode[], Error> {
  return useQuery({
    queryKey: [...libraryQueryKeys.all, 'shared'] as const,
    queryFn: getSharedFolders,
  })
}

export function useFolderContentsQuery(
  folderId: string | null,
  tree: FolderTreeNode | undefined,
  query: FolderContentsQuery,
  sharedFolderNodes?: FolderTreeNode[],
) {
  return useInfiniteQuery({
    enabled: folderId !== null && tree !== undefined,
    initialPageParam: 0,
    queryKey: libraryQueryKeys.contents(folderId ?? 'none', query),
    getNextPageParam: (lastPage: FolderContents) => lastPage.nextOffset ?? undefined,
    queryFn: async ({ pageParam }: { pageParam: number }) => {
      if (folderId === null || tree === undefined) {
        throw new Error('Folder contents could not be loaded, please refresh and try again.')
      }

      return await getFolderContents(folderId, tree, query, pageParam, sharedFolderNodes)
    },
  })
}

export function useCreateFolderMutation(): UseMutationResult<
  FolderRecord,
  Error,
  CreateFolderInput
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: createFolder,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useUploadFilesMutation(): UseMutationResult<UploadResult, Error, UploadInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: uploadFiles,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useDeleteItemMutation(): UseMutationResult<void, Error, DeleteItemInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: deleteItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useUpdateFileContentMutation(): UseMutationResult<
  FileRecord,
  Error,
  { fileId: string; content: string }
> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ fileId, content }) => updateFileContent(fileId, content),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useMoveItemMutation(): UseMutationResult<void, Error, MoveItemInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: moveItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useTrashQuery(): UseQueryResult<TrashEntry[], Error> {
  return useQuery({
    queryKey: libraryQueryKeys.trash(),
    queryFn: getTrash,
  })
}

export function useRestoreTrashItemMutation(): UseMutationResult<void, Error, RestoreTrashInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: restoreTrashItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function usePermanentlyDeleteTrashItemMutation(): UseMutationResult<void, Error, PermanentlyDeleteTrashInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: permanentlyDeleteTrashItem,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useEmptyTrashMutation(): UseMutationResult<{ deletedCount: number }, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => emptyTrash(),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.all })
    },
  })
}

export function useFavoritesQuery(): UseQueryResult<FavoriteItem[], Error> {
  return useQuery({
    queryKey: libraryQueryKeys.favorites(),
    queryFn: getFavorites,
  })
}

export function useAddFavoriteMutation(): UseMutationResult<void, Error, { itemId: string; itemKind: 'file' | 'folder' }> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (input) => addFavorite(input.itemId, input.itemKind),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.favorites() })
    },
  })
}

export function useRemoveFavoriteMutation(): UseMutationResult<void, Error, string> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (itemId) => removeFavorite(itemId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: libraryQueryKeys.favorites() })
    },
  })
}

export function useFilePreview(file: FileRecord | null): {
  error: Error | null
  isPending: boolean
  previewUrl: string | null
} {
  const previewQuery = useQuery({
    enabled: file !== null && isPreviewableFile(file),
    queryKey: ['library', 'file-preview', file?.id ?? 'none', file?.updatedAt ?? 'none'],
    queryFn: async () => {
      if (file === null) {
        throw new Error('Preview could not be loaded, please choose a file and try again.')
      }

      return await getFilePreviewBlob(file)
    },
    staleTime: Number.POSITIVE_INFINITY,
  })

  const previewUrl = useMemo(() => {
    if (previewQuery.data === undefined) return null
    return URL.createObjectURL(previewQuery.data)
  }, [previewQuery.data])

  const prevUrlRef = useRef<string | null>(null)
  useEffect(() => {
    return () => {
      if (prevUrlRef.current !== null) {
        URL.revokeObjectURL(prevUrlRef.current)
      }
      prevUrlRef.current = previewUrl
    }
  }, [previewUrl])

  return {
    error: previewQuery.error ?? null,
    isPending: previewQuery.isPending,
    previewUrl,
  }
}
