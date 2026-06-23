import { ArrowRightLeft, LoaderCircle, X } from 'lucide-react'
import { fieldInputClass, ghostButtonClass, iconButtonClass, primaryButtonClass } from '../lib/ui.ts'
import type { LibraryItemKind } from '../types/library.ts'

export interface MoveDestinationOption {
  id: string
  label: string
  disabled: boolean
}

interface MoveItemModalProps {
  open: boolean
  itemKind: LibraryItemKind
  itemName: string
  destinationFolderId: string
  destinations: MoveDestinationOption[]
  isPending: boolean
  errorMessage: string | null
  onChangeDestination: (folderId: string) => void
  onConfirm: () => void
  onCancel: () => void
}

export function MoveItemModal(props: MoveItemModalProps): React.JSX.Element | null {
  if (!props.open) {
    return null
  }

  const hasValidDestination = props.destinations.some(
    (destination) =>
      destination.id === props.destinationFolderId && !destination.disabled,
  )

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
        aria-labelledby="move-dialog-title"
        className="static m-0 w-full max-w-[480px] animate-[scale-in_200ms_ease-out] rounded-xl border border-[var(--outline-variant)] bg-[var(--card-bg)] p-6 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">
              <ArrowRightLeft className="size-5 text-[var(--primary)]" />
            </div>
            <div>
              <h2
                className="text-base font-semibold text-[var(--on-surface)]"
                id="move-dialog-title"
              >
                Move {props.itemKind}
              </h2>
              <p className="mt-0.5 text-sm text-[var(--secondary)]">
                Move &ldquo;{props.itemName}&rdquo; to another folder.
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
          <label className="text-xs font-medium text-[var(--on-surface-variant)]" htmlFor="move-destination">
            Destination
          </label>
          <select
            id="move-destination"
            className={fieldInputClass}
            value={props.destinationFolderId}
            onChange={(event) => props.onChangeDestination(event.currentTarget.value)}
          >
            {props.destinations.map((destination) => (
              <option
                key={destination.id}
                value={destination.id}
                disabled={destination.disabled}
              >
                {destination.label}
              </option>
            ))}
          </select>
        </div>

        {props.errorMessage !== null ? (
          <div className="mt-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
            {props.errorMessage}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className={ghostButtonClass}
            type="button"
            onClick={props.onCancel}
          >
            Cancel
          </button>
          <button
            className={primaryButtonClass}
            type="button"
            onClick={props.onConfirm}
            disabled={props.isPending || !hasValidDestination}
          >
            {props.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <ArrowRightLeft className="size-4" />
            )}
            Move
          </button>
        </div>
      </dialog>
    </div>
  )
}
