import { HardDrive, Key, LoaderCircle, LogOut } from 'lucide-react'
import { useState } from 'react'
import {
  useChangePasswordMutation,
  useLogoutMutation,
  useStorageUsageQuery,
} from '../hooks/use-auth.ts'
import { useSessionStore } from '../stores/session-store.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'
import { dangerButtonClass, primaryButtonClass, fieldInputClass } from '../lib/ui.ts'

function UserAvatar(props: { name: string; size: number }): React.JSX.Element {
  const initials = props.name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className="flex items-center justify-center rounded-full bg-[var(--primary)] font-medium text-white select-none"
      style={{ width: props.size, height: props.size, fontSize: props.size * 0.38 }}
    >
      {initials}
    </div>
  )
}

function StorageSection(): React.JSX.Element {
  const storageQuery = useStorageUsageQuery()

  if (storageQuery.isPending) {
    return (
      <div className="flex items-center gap-3 rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
        <LoaderCircle className="size-4 animate-spin text-[var(--primary)]" />
        <span className="text-sm text-[var(--secondary)]">Loading storage info...</span>
      </div>
    )
  }

  if (storageQuery.error !== null || storageQuery.data === undefined) {
    return <></>
  }

  const { usedBytes, quotaBytes } = storageQuery.data
  const usedGB = usedBytes / 1_073_741_824
  const quotaGB = quotaBytes / 1_073_741_824
  const ratio = quotaBytes > 0 ? usedBytes / quotaBytes : 0
  const barColor =
    ratio > 0.9
      ? 'bg-[var(--error)]'
      : ratio > 0.7
        ? 'bg-amber-500'
        : 'bg-[var(--primary)]'

  return (
    <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <HardDrive className="size-4 text-[var(--secondary)]" />
        <span className="text-sm font-medium text-[var(--on-surface)]">Storage</span>
      </div>
      <div className="mb-2 h-2 overflow-hidden rounded-full bg-[var(--surface-container)]">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(ratio * 100, 100)}%` }}
        />
      </div>
      <p className="text-xs text-[var(--secondary)]">
        {usedGB.toFixed(1)} GB of {quotaGB.toFixed(0)} GB used
      </p>
    </div>
  )
}

function ChangePasswordSection(): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const changePasswordMutation = useChangePasswordMutation()

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (currentPassword.length < 8 || newPassword.length < 8) return

    try {
      await changePasswordMutation.mutateAsync({ currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setIsOpen(false)
    } catch {
      // error shown below
    }
  }

  function handleCancel(): void {
    setCurrentPassword('')
    setNewPassword('')
    setIsOpen(false)
    changePasswordMutation.reset()
  }

  return (
    <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
      <div className="mb-3 flex items-center gap-2">
        <Key className="size-4 text-[var(--secondary)]" />
        <span className="text-sm font-medium text-[var(--on-surface)]">Password</span>
      </div>

      {!isOpen ? (
        <button
          className="text-sm text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)]"
          type="button"
          onClick={() => setIsOpen(true)}
        >
          Change password
        </button>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-3">
          <input
            className={fieldInputClass}
            type="password"
            placeholder="Current password"
            minLength={8}
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
          <input
            className={fieldInputClass}
            type="password"
            placeholder="New password (min 8 chars)"
            minLength={8}
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
          {changePasswordMutation.error !== null ? (
            <p className="text-xs text-[var(--error)]">{changePasswordMutation.error.message}</p>
          ) : null}
          {changePasswordMutation.isSuccess ? (
            <p className="text-xs text-green-700">Password updated.</p>
          ) : null}
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              className={`${primaryButtonClass} w-full sm:w-auto`}
              type="submit"
              disabled={changePasswordMutation.isPending}
            >
              {changePasswordMutation.isPending ? 'Saving...' : 'Save'}
            </button>
            <button
              className="inline-flex h-9 w-full items-center justify-center rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] px-4 text-sm font-medium text-[var(--on-surface)] transition-colors hover:bg-[var(--surface-container-low)] sm:w-auto"
              type="button"
              onClick={handleCancel}
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

export function AccountPage(): React.JSX.Element {
  const sessionUser = useSessionStore((state) => state.sessionUser)
  const setCurrentPage = useWorkspaceStore((state) => state.setCurrentPage)
  const logoutMutation = useLogoutMutation()

  const displayName = sessionUser?.name ?? 'User'
  const displayEmail = sessionUser?.email ?? ''

  async function handleSignOut(): Promise<void> {
    await logoutMutation.mutateAsync()
  }

  return (
    <div className="mx-auto w-full max-w-2xl animate-[fade-in_200ms_ease-out] p-4 sm:p-6">
      <button
        className="mb-5 text-sm text-[var(--primary)] transition-colors hover:text-[var(--primary-hover)] sm:mb-6"
        type="button"
        onClick={() => setCurrentPage('files')}
      >
        &larr; Back to files
      </button>

      <div className="mb-6 flex flex-col items-start gap-4 sm:mb-8 sm:flex-row sm:items-center sm:gap-5">
        <UserAvatar name={displayName} size={56} />
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-[var(--on-surface)]">{displayName}</h1>
          <p className="mt-1 break-all text-sm text-[var(--secondary)]">{displayEmail}</p>
        </div>
      </div>

      <div className="space-y-4">
        <StorageSection />
        <ChangePasswordSection />

        <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
          <button
            className={`${dangerButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={() => { void handleSignOut() }}
            disabled={logoutMutation.isPending}
          >
            {logoutMutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <LogOut className="size-4" />
            )}
            Sign out
          </button>
        </div>
      </div>
    </div>
  )
}
