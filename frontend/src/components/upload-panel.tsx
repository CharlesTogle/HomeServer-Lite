import { LoaderCircle, Upload, X } from 'lucide-react'
import { useRef, useState, type ChangeEvent } from 'react'
import { dangerButtonClass, iconButtonClass, primaryButtonClass, secondaryButtonClass } from '../lib/ui.ts'
import { formatBytes } from '../utils/format.ts'

interface UploadPanelProps {
  currentFolderName: string
  existingFileNames: string[]
  isPending: boolean
  errorMessage: string | null
  onClose: () => void
  onUpload: (files: File[]) => Promise<void>
}

export function UploadPanel(props: UploadPanelProps): React.JSX.Element {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [inputKey, setInputKey] = useState<number>(0)
  const [duplicateWarnings, setDuplicateWarnings] = useState<string[]>([])
  const [confirmUpload, setConfirmUpload] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function handleFileChange(event: ChangeEvent<HTMLInputElement>): void {
    setSelectedFiles(Array.from(event.currentTarget.files ?? []))
    setDuplicateWarnings([])
    setConfirmUpload(false)
  }

  async function handleSubmit(): Promise<void> {
    if (selectedFiles.length === 0) {
      return
    }

    if (!confirmUpload) {
      const existingSet = new Set(props.existingFileNames)
      const warnings: string[] = []

      for (const file of selectedFiles) {
        if (existingSet.has(file.name)) {
          const dotIndex = file.name.lastIndexOf('.')
          const predictedName = dotIndex <= 0
            ? `${file.name} (1)`
            : `${file.name.slice(0, dotIndex)} (1)${file.name.slice(dotIndex)}`
          warnings.push(
            `Duplicate filename detected: "${file.name}" will be saved as "${predictedName}"`,
          )
        }
      }

      if (warnings.length > 0) {
        setDuplicateWarnings(warnings)
        setConfirmUpload(true)
        return
      }
    }

    await props.onUpload(selectedFiles)

    setSelectedFiles([])
    setInputKey((value) => value + 1)
    setDuplicateWarnings([])
    setConfirmUpload(false)
    props.onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.4)] px-4 py-6"
      role="presentation"
      tabIndex={-1}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          props.onClose()
        }
      }}
      onMouseDown={props.onClose}
    >
      <dialog
        open
        aria-labelledby="upload-dialog-title"
        className="static m-0 w-full max-w-[640px] animate-[scale-in_200ms_ease-out] rounded-xl border border-[var(--outline-variant)] bg-[var(--card-bg)] p-6 shadow-xl"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-[var(--on-surface)]" id="upload-dialog-title">
              Upload files
            </h2>
            <p className="text-sm text-[var(--secondary)]">
              To: <strong className="text-[var(--on-surface)]">{props.currentFolderName}</strong>
            </p>
          </div>
          <button
            aria-label="Close"
            className={iconButtonClass}
            type="button"
            onClick={props.onClose}
          >
            <X className="size-4" />
          </button>
        </div>

        <div
          className="flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] px-6 py-10 text-center transition-colors hover:border-[var(--primary)]"
          onClick={() => fileInputRef.current?.click()}
        >
          <Upload className="size-8 text-[var(--outline)]" />
          <p className="mt-3 text-sm font-medium text-[var(--on-surface)]">
            Click to select files
          </p>
          <p className="mt-1 text-xs text-[var(--secondary)]">
            Any file type is supported
          </p>
          <input
            ref={fileInputRef}
            key={inputKey}
            multiple
            type="file"
            aria-label="Choose files"
            className="hidden"
            onChange={handleFileChange}
          />
        </div>

        {selectedFiles.length > 0 ? (
          <div className="mt-4 grid max-h-[240px] gap-2 overflow-y-auto">
            {selectedFiles.map((file) => (
              <div
                key={`${file.name}-${file.lastModified}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] px-4 py-2.5"
              >
                <div className="min-w-0 flex-1 truncate">
                  <span className="truncate text-sm font-medium text-[var(--on-surface)]">
                    {file.name}
                  </span>
                </div>
                <span className="shrink-0 text-xs text-[var(--secondary)]">
                  {formatBytes(file.size)}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {props.errorMessage !== null ? (
          <div className="mt-4 rounded-lg border border-[var(--error-container)] bg-[var(--error-container)] px-4 py-3 text-sm text-[var(--on-error-container)]">
            {props.errorMessage}
          </div>
        ) : null}

        {duplicateWarnings.length > 0 ? (
          <div className="mt-4 space-y-1 rounded-lg border border-yellow-300 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
            {duplicateWarnings.map((w) => (
              <p key={w}>{w}</p>
            ))}
          </div>
        ) : null}

        <div className="mt-6 flex justify-end gap-3">
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={props.onClose}
          >
            Cancel
          </button>
          <button
            className={confirmUpload ? dangerButtonClass : primaryButtonClass}
            type="button"
            onClick={() => { void handleSubmit() }}
            disabled={props.isPending || selectedFiles.length === 0}
          >
            {props.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Upload className="size-4" />
            )}
            {props.isPending
              ? 'Uploading...'
              : confirmUpload
                ? `Upload anyway (${selectedFiles.length})`
                : `Upload (${selectedFiles.length})`}
          </button>
        </div>
      </dialog>
    </div>
  )
}
