import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  Code,
  FileText,
  Info,
  LoaderCircle,
  Maximize,
  Minus,
  Pencil,
  Plus,
  RotateCcw,
  Save,
  Sidebar,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, type WheelEvent } from 'react'
import { apiResponse } from '../services/api-client.ts'
import { iconButtonClass, primaryButtonClass, secondaryButtonClass } from '../lib/ui.ts'
import { useUpdateFileContentMutation } from '../hooks/use-library.ts'
import type { FileRecord, FolderRecord } from '../types/library.ts'
import {
  formatBytes,
  formatMediaKind,
  formatRelativeTime,
  formatTimestamp,
} from '../utils/format.ts'

interface MediaViewerProps {
  currentFolderName: string | null
  inspectedFolder: FolderRecord | null
  isPreviewLoading: boolean
  mode: 'preview' | 'properties'
  previewErrorMessage: string | null
  previewUrl: string | null
  selectedFile: FileRecord | null
  onClose: () => void
}

const emptyCaptionTrack = 'data:text/vtt;charset=UTF-8,WEBVTT'

function DocumentViewer(props: { file: FileRecord }): React.JSX.Element {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editContent, setEditContent] = useState('')
  const [loadKey, setLoadKey] = useState(0)
  const updateMutation = useUpdateFileContentMutation()

  const isMarkdown = props.file.mimeType === 'text/markdown'

  useEffect(() => {
    let cancelled = false

    async function fetchText(): Promise<void> {
      setError(null)
      try {
        const response = await apiResponse(`/api/files/${props.file.id}/text`)

        if (cancelled) return

        if (!response.ok) {
          if (response.status === 400) {
            setContent(null)
            return
          }
          throw new Error(`Failed to load preview (${response.status})`)
        }

        const text = await response.text()

        if (!cancelled) {
          setContent(text)
        }
      } catch (err) {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to load text preview')
      }
    }

    void fetchText()

    return () => {
      cancelled = true
    }
  }, [props.file.id, loadKey])

  async function handleSave(): Promise<void> {
    await updateMutation.mutateAsync({
      fileId: props.file.id,
      content: editContent,
    })
    setIsEditing(false)
    setLoadKey((prev) => prev + 1)
  }

  function handleCancelEdit(): void {
    setIsEditing(false)
    setEditContent('')
  }

  function handleStartEdit(): void {
    setEditContent(content ?? '')
    setIsEditing(true)
  }

  if (error !== null) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-6 text-center">
        <div className="space-y-2">
          <FileText className="mx-auto size-5 text-[var(--secondary)]" />
          <p className="text-sm text-[var(--secondary)]">{error}</p>
        </div>
      </div>
    )
  }

  if (props.file.mimeType === 'application/pdf') {
    return (
      <iframe
        src={`/api/files/${props.file.id}/download`}
        title={props.file.name}
        className="h-[480px] w-full rounded-lg"
      />
    )
  }

  if (content === null) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-6 text-center">
        <div className="space-y-2">
          <Code className="mx-auto size-5 text-[var(--secondary)]" />
          <p className="text-sm font-medium text-[var(--on-surface)]">{props.file.name}</p>
          <p className="text-sm text-[var(--secondary)]">No inline text preview available.</p>
        </div>
      </div>
    )
  }

  if (isEditing && isMarkdown) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end gap-2">
          <button
            className={secondaryButtonClass}
            type="button"
            onClick={handleCancelEdit}
            disabled={updateMutation.isPending}
          >
            Cancel
          </button>
          <button
            className={primaryButtonClass}
            type="button"
            onClick={handleSave}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? (
              <LoaderCircle className="size-4 animate-spin" />
            ) : (
              <Save className="size-4" />
            )}
            Save
          </button>
        </div>
        <textarea
          aria-label="Edit markdown content"
          className="max-h-[480px] min-h-[300px] w-full resize-y rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4 font-mono text-sm leading-relaxed text-[var(--on-surface)] placeholder:text-[var(--outline)] focus:border-[var(--primary)] focus:outline-none focus:ring-1 focus:ring-[var(--primary)]"
          value={editContent}
          onChange={(event) => setEditContent(event.target.value)}
          spellCheck={false}
        />
      </div>
    )
  }

  if (isMarkdown) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-end">
          <button
            className="inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)]"
            type="button"
            onClick={handleStartEdit}
          >
            <Pencil className="size-3.5" />
            Edit
          </button>
        </div>
        <div className="max-h-[440px] w-full overflow-auto rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4 text-sm leading-relaxed text-[var(--on-surface)]">
          <div className="markdown-body">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
          </div>
        </div>
      </div>
    )
  }

  return (
    <pre className="max-h-[480px] w-full overflow-auto rounded-lg bg-[var(--inverse-surface)] p-4 text-sm leading-relaxed text-[var(--inverse-on-surface)]">
      <code>{content}</code>
    </pre>
  )
}

function ImageViewer(props: { src: string; alt: string }): React.JSX.Element {
  const [zoom, setZoom] = useState(1)
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [imageLoaded, setImageLoaded] = useState(false)
  const [naturalDims, setNaturalDims] = useState<{ w: number; h: number } | null>(null)
  const imgRef = useRef<HTMLImageElement>(null)

  const ZOOM_STEP = 0.25
  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 10

  function handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)))
  }

  function zoomIn(): void {
    setZoom((prev) => Math.min(MAX_ZOOM, prev + ZOOM_STEP))
  }

  function zoomOut(): void {
    setZoom((prev) => Math.max(MIN_ZOOM, prev - ZOOM_STEP))
  }

  function resetZoom(): void {
    setZoom(1)
    setOffset({ x: 0, y: 0 })
  }

  function handleMouseDown(event: React.MouseEvent): void {
    if (zoom <= 1) return
    event.preventDefault()
    setIsDragging(true)
    setDragStart({ x: event.clientX - offset.x, y: event.clientY - offset.y })
  }

  function handleMouseMove(event: React.MouseEvent): void {
    if (!isDragging || zoom <= 1) return
    setOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })
  }

  function handleMouseUp(): void {
    setIsDragging(false)
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] px-3 py-1.5">
        <div className="flex items-center gap-1">
          <button
            aria-label="Zoom out"
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)] disabled:opacity-30"
            type="button"
            onClick={zoomOut}
            disabled={zoom <= MIN_ZOOM}
          >
            <Minus className="size-3.5" />
          </button>
          <span className="w-14 text-center text-xs font-medium text-[var(--on-surface)] select-none">
            {zoomPercent}%
          </span>
          <button
            aria-label="Zoom in"
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)] disabled:opacity-30"
            type="button"
            onClick={zoomIn}
            disabled={zoom >= MAX_ZOOM}
          >
            <Plus className="size-3.5" />
          </button>
          <span className="mx-1 h-4 w-px bg-[var(--outline-variant)]" />
          <button
            aria-label="Reset zoom"
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)]"
            type="button"
            onClick={resetZoom}
          >
            <RotateCcw className="size-3.5" />
          </button>
        </div>
          {!imageLoaded ? (
            <LoaderCircle className="size-3.5 animate-spin text-[var(--primary)]" />
          ) : (
            <span className="text-xs text-[var(--outline)]">
              {naturalDims !== null ? `${naturalDims.w} × ${naturalDims.h}` : ''}
            </span>
          )}
      </div>

      <div
        className="relative flex max-h-[480px] min-h-[240px] items-start justify-center overflow-hidden rounded-lg bg-[var(--surface-container)]"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          ref={imgRef}
          src={props.src}
          alt={props.alt}
          onLoad={(event) => {
            setImageLoaded(true)
            const img = event.currentTarget
            setNaturalDims({ w: img.naturalWidth, h: img.naturalHeight })
          }}
          className="max-w-full transition-transform duration-100"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            margin: zoom <= 1 ? 'auto' : undefined,
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

function ImageFullscreen(props: {
  src: string
  alt: string
  onClose: () => void
}): React.JSX.Element {
  const [zoom, setZoom] = useState(1)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const ZOOM_STEP = 0.25
  const MIN_ZOOM = 0.25
  const MAX_ZOOM = 10

  function handleWheel(event: WheelEvent): void {
    if (!event.ctrlKey && !event.metaKey) return
    event.preventDefault()
    const delta = event.deltaY > 0 ? -ZOOM_STEP : ZOOM_STEP
    setZoom((prev) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev + delta)))
  }

  function handleMouseDown(event: React.MouseEvent): void {
    if (zoom <= 1) return
    event.preventDefault()
    setIsDragging(true)
    setDragStart({ x: event.clientX - offset.x, y: event.clientY - offset.y })
  }

  function handleMouseMove(event: React.MouseEvent): void {
    if (!isDragging || zoom <= 1) return
    setOffset({ x: event.clientX - dragStart.x, y: event.clientY - dragStart.y })
  }

  function handleMouseUp(): void {
    setIsDragging(false)
  }

  const zoomPercent = Math.round(zoom * 100)

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col bg-black"
      onKeyDown={(event) => {
        if (event.key === 'Escape') props.onClose()
      }}
      tabIndex={0}
    >
      <div className="flex items-center justify-between bg-black/60 px-4 py-2">
        <div className="flex items-center gap-2">
          <button
            aria-label="Zoom out"
            className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 disabled:opacity-30"
            type="button"
            onClick={() => setZoom((p) => Math.max(MIN_ZOOM, p - ZOOM_STEP))}
            disabled={zoom <= MIN_ZOOM}
          >
            <Minus className="size-4" />
          </button>
          <span className="w-14 text-center text-xs font-medium text-white/80 select-none">
            {zoomPercent}%
          </span>
          <button
            aria-label="Zoom in"
            className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10 disabled:opacity-30"
            type="button"
            onClick={() => setZoom((p) => Math.min(MAX_ZOOM, p + ZOOM_STEP))}
            disabled={zoom >= MAX_ZOOM}
          >
            <Plus className="size-4" />
          </button>
          <button
            aria-label="Reset zoom"
            className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10"
            type="button"
            onClick={() => { setZoom(1); setOffset({ x: 0, y: 0 }) }}
          >
            <RotateCcw className="size-4" />
          </button>
        </div>

        <p className="truncate px-4 text-sm font-medium text-white/80">{props.alt}</p>

        <button
          aria-label="Exit fullscreen"
          className="inline-flex size-8 items-center justify-center rounded-lg text-white/80 transition-colors hover:bg-white/10"
          type="button"
          onClick={props.onClose}
        >
          <X className="size-4" />
        </button>
      </div>

      <div
        className="flex flex-1 items-start justify-center overflow-hidden"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default' }}
      >
        <img
          src={props.src}
          alt={props.alt}
          className="max-w-full select-none"
          style={{
            transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
            transformOrigin: '0 0',
            margin: zoom <= 1 ? 'auto' : undefined,
            alignSelf: zoom <= 1 ? 'center' : undefined,
          }}
          draggable={false}
        />
      </div>
    </div>
  )
}

function ViewerStage(props: {
  file: FileRecord
  isPreviewLoading: boolean
  previewErrorMessage: string | null
  previewUrl: string | null
  isFullscreen: boolean
  onToggleFullscreen: () => void
  isSpan: boolean
  onToggleSpan: () => void
}): React.JSX.Element {
  const showToolbar = props.file.mediaKind === 'image' && props.previewUrl !== null

  if (props.previewErrorMessage !== null) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-6 text-center">
        <div className="space-y-2">
          <FileText className="mx-auto size-5 text-[var(--secondary)]" />
          <p className="text-sm font-medium text-[var(--on-surface)]">{props.file.name}</p>
          <p className="text-sm text-[var(--secondary)]">{props.previewErrorMessage}</p>
        </div>
      </div>
    )
  }

  if (props.isPreviewLoading) {
    return (
      <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-6 text-center">
        <div className="space-y-2">
          <LoaderCircle className="mx-auto size-5 animate-spin text-[var(--primary)]" />
          <p className="text-sm text-[var(--secondary)]">Loading preview...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {showToolbar ? (
        <div className="flex items-center justify-end gap-1">
          <button
            aria-label={props.isSpan ? 'Show details' : 'Hide details'}
            className={`inline-flex size-7 items-center justify-center rounded-md text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)] ${
              props.isSpan ? 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]' : ''
            }`}
            type="button"
            onClick={props.onToggleSpan}
          >
            <Sidebar className="size-3.5" />
          </button>
          <button
            aria-label="Open fullscreen"
            className="inline-flex size-7 items-center justify-center rounded-md text-[var(--secondary)] transition-colors hover:bg-[var(--surface-container-low)]"
            type="button"
            onClick={props.onToggleFullscreen}
          >
            <Maximize className="size-3.5" />
          </button>
        </div>
      ) : null}

      {(() => {
        switch (props.file.mediaKind) {
          case 'image':
            if (props.previewUrl !== null) {
              return (
                <ImageViewer src={props.previewUrl} alt={`Preview of ${props.file.name}`} />
              )
            }
            break
          case 'audio':
            if (props.previewUrl !== null) {
              return (
                <audio
                  controls
                  aria-label={`Audio preview for ${props.file.name}`}
                  className="w-full"
                  src={props.previewUrl}
                >
                  <track
                    kind="captions"
                    label="No captions available"
                    src={emptyCaptionTrack}
                    srcLang="en"
                  />
                </audio>
              )
            }
            break
          case 'video':
            if (props.previewUrl !== null) {
              return (
                <video
                  controls
                  playsInline
                  aria-label={`Video preview for ${props.file.name}`}
                  className="max-h-[360px] w-full rounded-lg object-cover"
                >
                  <source src={props.previewUrl} type={props.file.mimeType} />
                  <track
                    kind="captions"
                    label="No captions available"
                    src={emptyCaptionTrack}
                    srcLang="en"
                  />
                </video>
              )
            }
            break
          case 'document':
            return <DocumentViewer file={props.file} />
          default:
            break
        }

        return (
          <div className="flex min-h-[200px] items-center justify-center rounded-lg border border-dashed border-[var(--outline-variant)] bg-[var(--surface-container-low)] p-6 text-center">
            <div className="space-y-2">
              <FileText className="mx-auto size-5 text-[var(--secondary)]" />
              <p className="text-sm font-medium text-[var(--on-surface)]">{props.file.name}</p>
              <p className="text-sm text-[var(--secondary)]">
                {props.file.mediaKind === 'video'
                  ? 'Video playback will appear here after loading.'
                  : 'No inline preview available.'}
              </p>
            </div>
          </div>
        )
      })()}
    </div>
  )
}

export function MediaViewer(props: MediaViewerProps): React.JSX.Element {
  const [isSpan, setIsSpan] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  if (props.selectedFile === null && props.inspectedFolder === null) {
    return <></>
  }

  if (props.selectedFile !== null) {
    const selectedFile = props.selectedFile
    const isImage = selectedFile.mediaKind === 'image' && props.previewUrl !== null

    return (
      <>
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-[rgba(0,0,0,0.4)] px-4 py-6"
          role="presentation"
          tabIndex={-1}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              if (isFullscreen) {
                setIsFullscreen(false)
              } else {
                props.onClose()
              }
            }
          }}
          onMouseDown={() => {
            if (!isFullscreen) props.onClose()
          }}
        >
          <dialog
            open
            aria-labelledby="file-preview-title"
            className={`static m-0 w-full animate-[scale-in_200ms_ease-out] rounded-xl border border-[var(--outline-variant)] bg-[var(--card-bg)] p-0 shadow-xl ${
              isImage && isSpan ? 'max-w-[1200px]' : 'max-w-[960px]'
            }`}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between border-b border-[var(--outline-variant)] px-6 py-4">
              <div className="min-w-0 flex-1">
                <h2
                  className="truncate text-lg font-semibold text-[var(--on-surface)]"
                  id="file-preview-title"
                >
                  {selectedFile.name}
                </h2>
                {props.mode === 'properties' ? (
                  <p className="text-sm text-[var(--secondary)]">File properties</p>
                ) : (
                  <p className="text-sm text-[var(--secondary)]">
                    {formatMediaKind(selectedFile.mediaKind)} preview
                  </p>
                )}
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
              className={`grid gap-6 p-6 ${
                isImage && isSpan ? 'lg:grid-cols-[1fr]' : 'lg:grid-cols-[1fr_300px]'
              }`}
            >
              <ViewerStage
                file={selectedFile}
                isPreviewLoading={props.isPreviewLoading}
                previewErrorMessage={props.previewErrorMessage}
                previewUrl={props.previewUrl}
                isFullscreen={isFullscreen}
                onToggleFullscreen={() => setIsFullscreen(true)}
                isSpan={isSpan}
                onToggleSpan={() => setIsSpan((prev) => !prev)}
              />

              {(!isImage || !isSpan) ? (
                <div className="space-y-4">
                  <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
                    <h3 className="mb-3 text-sm font-semibold text-[var(--on-surface)]">Details</h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-[var(--secondary)]">Type</span>
                        <span className="text-[var(--on-surface)]">{selectedFile.mimeType}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--secondary)]">Size</span>
                        <span className="text-[var(--on-surface)]">{formatBytes(selectedFile.sizeBytes)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--secondary)]">Created</span>
                        <span className="text-[var(--on-surface)]">{formatTimestamp(selectedFile.createdAt)}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--secondary)]">Location</span>
                        <span className="text-right text-[var(--on-surface)]">{props.currentFolderName ?? '...'}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-[var(--secondary)]">Status</span>
                        <span className="text-[var(--on-surface)]">{selectedFile.status}</span>
                      </div>
                    </div>
                  </div>

                  <div className="rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
                    <button
                      className={`${secondaryButtonClass} w-full`}
                      type="button"
                      onClick={() => {
                        const link = document.createElement('a')
                        link.href = `/api/files/${selectedFile.id}/download`
                        link.download = selectedFile.name
                        link.click()
                      }}
                    >
                      <Download className="size-4" />
                      Download
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </dialog>
        </div>

        {isFullscreen && props.previewUrl !== null ? (
          <ImageFullscreen
            src={props.previewUrl}
            alt={selectedFile.name}
            onClose={() => setIsFullscreen(false)}
          />
        ) : null}
      </>
    )
  }

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-80 border-l border-[var(--outline-variant)] bg-[var(--card-bg)] p-6 shadow-lg animate-[slide-up_200ms_ease-out]">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[var(--on-surface)]">
            {props.inspectedFolder?.name}
          </h2>
          <p className="text-sm text-[var(--secondary)]">Folder properties</p>
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

      <div className="mt-6 space-y-3 rounded-lg border border-[var(--outline-variant)] bg-[var(--card-bg)] p-4">
        <div className="flex items-center gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-[color-mix(in_srgb,var(--primary)_8%,transparent)]">
            <Info className="size-5 text-[var(--primary)]" />
          </div>
          <div>
            <p className="text-sm font-medium text-[var(--on-surface)]">{props.inspectedFolder?.name}</p>
            <p className="text-xs text-[var(--secondary)]">{props.inspectedFolder?.itemCount ?? 0} items</p>
          </div>
        </div>
        <div className="text-xs text-[var(--secondary)]">
          Created {props.inspectedFolder?.createdAt ? formatRelativeTime(props.inspectedFolder.createdAt) : 'N/A'}
        </div>
      </div>
    </aside>
  )
}

function Download({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" x2="12" y1="15" y2="3" />
    </svg>
  )
}
