import { Bookmark, FolderOpen, LoaderCircle, Trash2, User } from 'lucide-react'
import { useEffect, useState } from 'react'
import { AuthScreen } from './components/auth-screen.tsx'
import { HomeShell } from './components/home-shell.tsx'
import { TopBar } from './components/top-bar.tsx'
import { AccountPage } from './components/account-page.tsx'
import { useRestoreSessionQuery } from './hooks/use-auth.ts'
import { useUrlSync } from './hooks/use-url-sync.ts'
import { useSessionStore } from './stores/session-store.ts'
import { useWorkspaceStore } from './stores/workspace-store.ts'

function LoadingScreen(): React.JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--card-bg)]">
      <div className="flex flex-col items-center gap-3">
        <div className="flex size-12 items-center justify-center rounded-xl bg-[var(--primary)] text-xl font-bold text-white">
          H
        </div>
        <LoaderCircle className="size-5 animate-spin text-[var(--primary)]" />
        <p className="text-sm text-[var(--secondary)]">Restoring session...</p>
      </div>
    </div>
  )
}

function DarkModeSync(): null {
  const darkMode = useWorkspaceStore((state) => state.darkMode)
  useEffect(() => {
    document.documentElement.classList.toggle('dark', darkMode)
  }, [darkMode])
  return null
}

function MobileBottomNav(): React.JSX.Element {
  const currentPage = useWorkspaceStore((state) => state.currentPage)
  const setCurrentPage = useWorkspaceStore((state) => state.setCurrentPage)

  const items = [
    { icon: FolderOpen, label: 'Files', page: 'files' as const },
    { icon: Bookmark, label: 'Favorites', page: 'favorites' as const },
    { icon: Trash2, label: 'Trash', page: 'trash' as const },
    { icon: User, label: 'Account', page: 'account' as const },
  ]

  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--outline-variant)] bg-[color-mix(in_srgb,var(--card-bg)_94%,white)] px-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-2 backdrop-blur sm:hidden">
      <ul className="grid grid-cols-4 gap-1">
        {items.map((item) => {
          const isActive = currentPage === item.page
          const Icon = item.icon

          return (
            <li key={item.page}>
              <button
                className={`flex w-full flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 text-[11px] font-medium transition-colors ${
                  isActive
                    ? 'bg-[color-mix(in_srgb,var(--primary)_10%,transparent)] text-[var(--primary)]'
                    : 'text-[var(--secondary)] hover:bg-[var(--surface-container-low)]'
                }`}
                type="button"
                onClick={() => setCurrentPage(item.page)}
              >
                <Icon className="size-4" />
                <span>{item.label}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}

function AuthenticatedApp(): React.JSX.Element {
  useUrlSync()
  const currentPage = useWorkspaceStore((state) => state.currentPage)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  return (
    <div className="flex min-h-screen flex-col bg-[var(--surface)]">
      <TopBar
        showSidebarToggle={currentPage !== 'account'}
        onToggleSidebar={() => setIsMobileSidebarOpen((open) => !open)}
        onNavigate={() => setIsMobileSidebarOpen(false)}
      />
      <div className="flex flex-1 flex-col pb-20 sm:pb-0">
        {currentPage === 'account' ? (
          <AccountPage />
        ) : (
          <HomeShell
            isMobileSidebarOpen={isMobileSidebarOpen}
            onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
          />
        )}
      </div>
      <MobileBottomNav />
    </div>
  )
}

function App(): React.JSX.Element {
  const accessToken = useSessionStore((state) => state.accessToken)
  const restoreSessionQuery = useRestoreSessionQuery(accessToken === null)

  const content = accessToken === null
    ? restoreSessionQuery.isPending
      ? <LoadingScreen />
      : <AuthScreen />
    : <AuthenticatedApp />

  return (
    <>
      <DarkModeSync />
      {content}
    </>
  )
}

export default App
