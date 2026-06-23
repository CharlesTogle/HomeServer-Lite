import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from '@tanstack/react-query'
import {
  changePassword,
  loginWithPassword,
  logoutSession,
  restoreSession,
} from '../services/auth-service.ts'
import { getMe, getSharedStorageUsage, type StorageUsage } from '../services/library-service.ts'
import type { AuthSession, LoginInput } from '../types/auth.ts'

export function useLoginMutation(): UseMutationResult<AuthSession, Error, LoginInput> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: loginWithPassword,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useLogoutMutation(): UseMutationResult<void, Error, void> {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: logoutSession,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['library'] })
    },
  })
}

export function useRestoreSessionQuery(enabled: boolean): UseQueryResult<AuthSession, Error> {
  return useQuery({
    enabled,
    queryKey: ['auth', 'restore-session'],
    queryFn: restoreSession,
    retry: false,
  })
}

export function useChangePasswordMutation(): UseMutationResult<void, Error, { currentPassword: string; newPassword: string }> {
  return useMutation({
    mutationFn: (input) => changePassword(input.currentPassword, input.newPassword),
  })
}

export function useStorageUsageQuery(): UseQueryResult<StorageUsage, Error> {
  return useQuery({
    queryKey: ['auth', 'storage-usage'],
    queryFn: async () => {
      const data = await getMe()
      return data.storage
    },
    staleTime: 30_000,
  })
}

export function useSharedStorageUsageQuery(): UseQueryResult<StorageUsage, Error> {
  return useQuery({
    queryKey: ['auth', 'shared-storage-usage'],
    queryFn: getSharedStorageUsage,
    staleTime: 30_000,
  })
}
