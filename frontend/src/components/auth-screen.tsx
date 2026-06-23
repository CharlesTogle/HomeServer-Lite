import { LoaderCircle } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { useLoginMutation } from '../hooks/use-auth.ts'
import { fieldInputClass, primaryButtonClass } from '../lib/ui.ts'

const defaultEmail = 'admin@homeserver.tailnet'
const defaultPassword = 'media-demo'

export function AuthScreen(): React.JSX.Element {
  const loginMutation = useLoginMutation()
  const [email, setEmail] = useState(defaultEmail)
  const [password, setPassword] = useState(defaultPassword)

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    await loginMutation.mutateAsync({ email, password })
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--card-bg)] px-4">
      <div className="w-full max-w-sm animate-[slide-up_300ms_ease-out]">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex size-12 items-center justify-center rounded-xl bg-[var(--primary)] text-xl font-bold text-white">
            H
          </div>
          <h1 className="text-xl font-semibold text-[var(--on-surface)]">HomeServer</h1>
          <p className="mt-1 text-sm text-[var(--secondary)]">Sign in to your private library</p>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--on-surface-variant)]" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              type="email"
              autoComplete="username"
              className={fieldInputClass}
              value={email}
              onChange={(event) => setEmail(event.currentTarget.value)}
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-medium text-[var(--on-surface-variant)]" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              className={fieldInputClass}
              value={password}
              onChange={(event) => setPassword(event.currentTarget.value)}
            />
          </div>

          {loginMutation.error !== null ? (
            <div className="rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-3 py-2 text-sm text-[var(--on-error-container)]">
              {loginMutation.error.message}
            </div>
          ) : null}

          <button
            className={`${primaryButtonClass} w-full`}
            type="submit"
            disabled={loginMutation.isPending}
          >
            {loginMutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            Sign in
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-[var(--outline)]">
          Demo: {defaultEmail} / {defaultPassword}
        </p>
      </div>
    </div>
  )
}
