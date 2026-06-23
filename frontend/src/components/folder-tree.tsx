import { ChevronDown, ChevronRight, Folder, FolderOpen } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import type { FolderTreeNode } from '../types/library.ts'

interface FolderTreeProps {
  tree: FolderTreeNode
  selectedFolderId: string
  rootLabel?: string
  showRoot?: boolean
  onSelectFolder: (folderId: string) => void
}

interface FolderTreeBranchProps {
  node: FolderTreeNode
  collapsedFolderIds: Set<string>
  depth: number
  rootLabel?: string
  selectedPathIds: Set<string>
  selectedFolderId: string
  onToggleFolder: (folderId: string) => void
  onSelectFolder: (folderId: string) => void
}

function findFolderPathIds(node: FolderTreeNode, targetFolderId: string): string[] {
  if (node.folder.id === targetFolderId) {
    return [node.folder.id]
  }

  for (const childNode of node.children) {
    const childPath = findFolderPathIds(childNode, targetFolderId)

    if (childPath.length > 0) {
      return [node.folder.id, ...childPath]
    }
  }

  return []
}

function FolderTreeBranch(props: FolderTreeBranchProps): React.JSX.Element {
  const isRoot = props.depth === 0
  const isActive = props.node.folder.id === props.selectedFolderId
  const hasChildren = props.node.children.length > 0
  const isExpanded =
    isRoot ||
    (hasChildren &&
      (!props.collapsedFolderIds.has(props.node.folder.id) ||
        props.selectedPathIds.has(props.node.folder.id)))

  return (
    <div>
      <div
        className={cn(
          'flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm transition-colors',
          isRoot ? 'font-semibold' : '',
          isActive
            ? 'bg-[color-mix(in_srgb,var(--primary)_8%,transparent)] text-[var(--primary)]'
            : 'text-[var(--on-surface)] hover:bg-[var(--surface-container-low)]',
        )}
        style={{ paddingLeft: `${isRoot ? 8 : 8 + props.depth * 20}px` }}
      >
        <button
          aria-label={isExpanded ? 'Collapse' : 'Expand'}
          className="flex size-5 shrink-0 items-center justify-center rounded-md text-[var(--secondary)] hover:bg-[var(--surface-container)]"
          type="button"
          onClick={() => props.onToggleFolder(props.node.folder.id)}
          tabIndex={hasChildren && !isRoot ? 0 : -1}
          style={{ visibility: hasChildren && !isRoot ? 'visible' : 'hidden' }}
        >
          {isExpanded ? (
            <ChevronDown className="size-3.5" />
          ) : (
            <ChevronRight className="size-3.5" />
          )}
        </button>

        <button
          aria-current={isActive ? 'page' : undefined}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          type="button"
          onClick={() => props.onSelectFolder(props.node.folder.id)}
        >
          {isActive ? (
            <FolderOpen className="size-4 shrink-0 text-[var(--primary)]" />
          ) : (
            <Folder className="size-4 shrink-0 text-[var(--secondary)]" />
          )}
          <span className="truncate text-sm font-medium">
            {isRoot ? (props.rootLabel ?? props.node.folder.name) : props.node.folder.name}
          </span>
        </button>

        {!isRoot ? (
          <span className="shrink-0 text-xs text-[var(--outline)]">{props.node.folder.itemCount}</span>
        ) : null}
      </div>

      {hasChildren && isExpanded ? (
        <div>
          {props.node.children.map((childNode) => (
            <FolderTreeBranch
              key={childNode.folder.id}
              node={childNode}
              collapsedFolderIds={props.collapsedFolderIds}
              depth={props.depth + 1}
              rootLabel={props.rootLabel}
              selectedPathIds={props.selectedPathIds}
              selectedFolderId={props.selectedFolderId}
              onToggleFolder={props.onToggleFolder}
              onSelectFolder={props.onSelectFolder}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function FolderTree(props: FolderTreeProps): React.JSX.Element {
  const [collapsedFolderIds, setCollapsedFolderIds] = useState<Set<string>>(new Set())
  const selectedPathIds = new Set(findFolderPathIds(props.tree, props.selectedFolderId))

  function handleToggleFolder(folderId: string): void {
    setCollapsedFolderIds((currentValue) => {
      const nextValue = new Set(currentValue)

      if (nextValue.has(folderId)) {
        nextValue.delete(folderId)
      } else {
        nextValue.add(folderId)
      }

      return nextValue
    })
  }

  return (
    <div className="space-y-0.5">
      {props.showRoot === false
        ? props.tree.children.map((childNode) => (
            <FolderTreeBranch
              key={childNode.folder.id}
              node={childNode}
              collapsedFolderIds={collapsedFolderIds}
              depth={1}
              rootLabel={props.rootLabel}
              selectedPathIds={selectedPathIds}
              selectedFolderId={props.selectedFolderId}
              onToggleFolder={handleToggleFolder}
              onSelectFolder={props.onSelectFolder}
            />
          ))
        : (
            <FolderTreeBranch
              node={props.tree}
              collapsedFolderIds={collapsedFolderIds}
              depth={0}
              rootLabel={props.rootLabel}
              selectedPathIds={selectedPathIds}
              selectedFolderId={props.selectedFolderId}
              onToggleFolder={handleToggleFolder}
              onSelectFolder={props.onSelectFolder}
            />
          )}
    </div>
  )
}
