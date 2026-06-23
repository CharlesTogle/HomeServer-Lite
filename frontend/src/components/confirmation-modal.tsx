import { AlertTriangle, LoaderCircle, X } from 'lucide-react'
import { cn } from '../lib/cn.ts'
import { dangerButtonClass, ghostButtonClass, iconButtonClass, primaryButtonClass } from '../lib/ui.ts'

interface ConfirmationModalProps {
  open: boolean
  title: string
  description: string
  confirmLabel: string
  cancelLabel: string
  tone: 'danger' | 'neutral'
  isPending: boolean
  errorMessage: string | null
  onConfirm: () => void
  onCancel: () => void
}

export function ConfirmationModal(props: ConfirmationModalProps): React.JSX.Element | null {
  if (!props.open) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.4)] px-4 py-6"
      role="presentation"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          props.onCancel()
        }
      }}
      onMouseDown={props.onCancel}
    >
      <dialog
        open
        aria-labelledby="dialog-title"
        className="static m-0 w-full max-w-[480px] animate-[scale-in_200ms_ease-out] rounded-none border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4 shadow-xl sm:rounded-xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3 sm:gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div
              className={cn(
                'flex size-10 items-center justify-center rounded-lg',
                props.tone === 'danger' ? 'bg-[var(--error-container)]' : 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]',
              )}
            >
              <AlertTriangle
                className={cn(
                  'size-5',
                  props.tone === 'danger' ? 'text-[var(--error)]' : 'text-[var(--primary)]',
                )}
              />
            </div>
             <div className="min-w-0">
               <h2
                 className="text-base font-semibold text-[var(--on-surface)]"
                 id="dialog-title"
               >
                 {props.title}
               </h2>
               <p className="mt-0.5 text-sm text-[var(--secondary)]">{props.description}</p>
             </div>
           </div>
          <button
            aria-label="Close"
            className={iconButtonClass}
            type="button"
            onClick={props.onCancel}
          >
            <X className="size-4" />
          </button>
        </div>

        {props.errorMessage !== null ? (
          <div className="mb-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
            {props.errorMessage}
          </div>
        ) : null}

        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className={`${ghostButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onCancel}
          >
            {props.cancelLabel}
          </button>
          <button
            className={`${props.tone === 'danger' ? dangerButtonClass : primaryButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onConfirm}
            disabled={props.isPending}
          >
            {props.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : null}
            {props.confirmLabel}
          </button>
        </div>
      </dialog>
    </div>
  )
}
