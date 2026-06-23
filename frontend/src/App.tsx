import { LoaderCircle } from 'lucide-react'
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

function AuthenticatedApp(): React.JSX.Element {
  useUrlSync()
  const currentPage = useWorkspaceStore((state) => state.currentPage)
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)

  return (
    <div className="flex h-dvh min-h-dvh flex-col overflow-hidden bg-[var(--surface)]">
      <TopBar
        showSidebarToggle={currentPage !== 'account'}
        onToggleSidebar={() => setIsMobileSidebarOpen((open) => !open)}
        onNavigate={() => setIsMobileSidebarOpen(false)}
      />
      <div className="flex min-h-0 flex-1 flex-col">
        {currentPage === 'account' ? (
          <AccountPage />
        ) : (
          <HomeShell
            isMobileSidebarOpen={isMobileSidebarOpen}
            onCloseMobileSidebar={() => setIsMobileSidebarOpen(false)}
          />
        )}
      </div>
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
