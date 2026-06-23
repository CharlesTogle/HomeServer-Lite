import { FolderPlus, LoaderCircle, X } from 'lucide-react'
import { fieldInputClass, ghostButtonClass, iconButtonClass, primaryButtonClass } from '../lib/ui.ts'

interface CreateFolderModalProps {
  open: boolean
  folderName: string
  isPending: boolean
  errorMessage: string | null
  onChangeFolderName: (value: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function CreateFolderModal(props: CreateFolderModalProps): React.JSX.Element | null {
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
        aria-labelledby="create-folder-title"
        className="static m-0 w-full max-w-[480px] animate-[scale-in_200ms_ease-out] rounded-none border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4 shadow-xl sm:rounded-xl sm:p-6"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">
              <FolderPlus className="size-5 text-[var(--primary)]" />
            </div>
            <div>
              <h2
                className="text-base font-semibold text-[var(--on-surface)]"
                id="create-folder-title"
              >
                New folder
              </h2>
              <p className="mt-0.5 text-sm text-[var(--secondary)]">
                Create a new folder in the current location.
              </p>
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

        <div className="space-y-1.5">
          <label className="text-xs font-medium text-[var(--on-surface-variant)]" htmlFor="create-folder-name">
            Folder name
          </label>
          <input
            id="create-folder-name"
            type="text"
            aria-label="Folder name"
            className={fieldInputClass}
            value={props.folderName}
            onChange={(event) => props.onChangeFolderName(event.currentTarget.value)}
          />
        </div>

        {props.errorMessage !== null ? (
          <div className="mt-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
            {props.errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
          <button
            className={`${ghostButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            className={`${primaryButtonClass} w-full sm:w-auto`}
            type="button"
            onClick={props.onConfirm}
            disabled={props.isPending}
          >
            {props.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <FolderPlus className="size-4" />
            )}
            Create
          </button>
        </div>
      </dialog>
    </div>
  )
}
