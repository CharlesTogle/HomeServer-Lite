import { ChevronDown, LogOut, Menu, Moon, Search, Sun, User } from 'lucide-react'
import { useState } from 'react'
import { useLogoutMutation } from '../hooks/use-auth.ts'
import { useSessionStore } from '../stores/session-store.ts'
import { useWorkspaceStore } from '../stores/workspace-store.ts'
import { iconButtonClass } from '../lib/ui.ts'

function UserAvatar(props: { name: string; size?: number }): React.JSX.Element {
  const initials = props.name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2)

  return (
    <div
      className="flex items-center justify-center rounded-full bg-[var(--primary)] font-medium text-white select-none"
      style={{ width: props.size ?? 32, height: props.size ?? 32, fontSize: (props.size ?? 32) * 0.4 }}
    >
      {initials}
    </div>
  )
}

interface TopBarProps {
  showSidebarToggle?: boolean
  onToggleSidebar?: () => void
  onNavigate?: () => void
}

export function TopBar({ showSidebarToggle = false, onToggleSidebar, onNavigate }: TopBarProps): React.JSX.Element {
  const sessionUser = useSessionStore((state) => state.sessionUser)
  const setCurrentPage = useWorkspaceStore((state) => state.setCurrentPage)
  const currentPage = useWorkspaceStore((state) => state.currentPage)
  const librarySearchTerm = useWorkspaceStore((state) => state.librarySearchTerm)
  const darkMode = useWorkspaceStore((state) => state.darkMode)
  const toggleDarkMode = useWorkspaceStore((state) => state.toggleDarkMode)
  const logoutMutation = useLogoutMutation()
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)

  async function handleSignOut(): Promise<void> {
    setIsDropdownOpen(false)
    await logoutMutation.mutateAsync()
  }

  const displayName = sessionUser?.name ?? 'User'

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-[var(--outline-variant)] bg-[var(--card-bg)] px-4 lg:px-6">
      <div className="flex items-center gap-3">
        {showSidebarToggle ? (
          <button
            className={`${iconButtonClass} lg:hidden`}
            type="button"
            onClick={onToggleSidebar}
            aria-label="Open sidebar"
          >
            <Menu className="size-4" />
          </button>
        ) : null}
        <div className="flex size-8 items-center justify-center rounded-lg bg-[var(--primary)] text-sm font-bold text-white">
          H
        </div>
        <span className="text-sm font-semibold text-[var(--on-surface)]">HomeServer</span>
      </div>

      {currentPage !== 'account' ? (
        <button
          className={`group mx-3 hidden min-w-0 flex-1 items-center justify-center md:flex ${
            currentPage === 'search'
              ? 'text-[var(--primary)]'
              : 'text-[var(--secondary)] hover:text-[var(--on-surface)]'
          }`}
          type="button"
          onClick={() => {
            onNavigate?.()
            setCurrentPage('search')
          }}
          aria-label="Open search and sort controls"
        >
          <span className="relative flex h-10 w-full max-w-md items-center overflow-hidden rounded-full border border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--card-bg)_86%,var(--surface-container-low))] px-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors group-hover:border-[var(--outline)]">
            <span className="absolute inset-y-1 left-1 w-16 rounded-full bg-[color-mix(in_srgb,var(--primary)_12%,transparent)] animate-[search-pill-glide_4.8s_ease-in-out_infinite]" />
            <span className="relative z-10 flex min-w-0 items-center gap-3">
              <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--card-bg)] text-[var(--primary)] shadow-[0_1px_2px_rgba(0,0,0,0.05)]">
                <Search className="size-3.5" />
              </span>
              <span className="truncate text-sm font-medium">
                {librarySearchTerm.trim().length > 0 ? `Search: ${librarySearchTerm}` : 'Search, sort, and filter here'}
              </span>
            </span>
          </span>
        </button>
      ) : null}

      <div className="flex items-center gap-1">
        {currentPage !== 'account' ? (
          <button
            className={`${iconButtonClass} md:hidden ${currentPage === 'search' ? 'border-[var(--primary)] text-[var(--primary)]' : ''}`}
            type="button"
            onClick={() => {
              onNavigate?.()
              setCurrentPage('search')
            }}
            aria-label="Open search and sort controls"
            title="Search, sort, and filter"
          >
            <Search className="size-4" />
          </button>
        ) : null}

        <button
          className={iconButtonClass}
          type="button"
          onClick={() => toggleDarkMode()}
          aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
          title={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
        >
          {darkMode ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>

        <div className="relative">
          <button
            className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-[var(--surface-container-low)]"
            type="button"
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          >
            <UserAvatar name={displayName} />
            <span className="hidden text-sm font-medium text-[var(--on-surface)] sm:inline">
              {displayName}
            </span>
            <ChevronDown className="size-3.5 text-[var(--secondary)]" />
          </button>

          {isDropdownOpen ? (
            <>
              <div
                className="fixed inset-0 z-40"
                onClick={() => setIsDropdownOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 min-w-[200px] rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] py-1 shadow-lg">
                <button
                  className={`flex w-full items-center gap-3 px-4 py-2.5 text-sm transition-colors hover:bg-[var(--surface-container-low)] ${
                    currentPage === 'account' ? 'bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] text-[var(--primary)]' : 'text-[var(--on-surface)]'
                  }`}
                  type="button"
                  onClick={() => {
                    onNavigate?.()
                    setCurrentPage('account')
                    setIsDropdownOpen(false)
                  }}
                >
                  <User className="size-4" />
                  Account
                </button>
                <hr className="mx-3 border-[var(--outline-variant)]" />
                <button
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-sm text-[var(--error)] transition-colors hover:bg-[var(--surface-container-low)]"
                  type="button"
                  onClick={() => { void handleSignOut() }}
                >
                  <LogOut className="size-4" />
                  Sign out
                </button>
              </div>
            </>
          ) : null}
        </div>
      </div>
    </header>
  )
}
