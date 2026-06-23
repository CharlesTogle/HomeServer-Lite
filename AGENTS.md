## Goal
Redesign the HomeServer-Lite frontend UI to look sleek and professional like Google Drive while retaining the existing color palette, and add an account page.

## Constraints & Preferences
- Keep the existing pink/blush color palette (CSS custom properties unchanged)
- No react-router — use simple state-based page routing via Zustand
- Use Zustand for client state, TanStack Query for server state
- Keep types concrete, prefer semantic HTML
- Must pass `tsc --noEmit`, `npm run lint`, and `npm run build` with zero errors
- Google Drive design cues: clean white background, 56px top bar, 240px sidebar, rounded buttons (8px), subtle borders (`--outline-variant`), hover-reveal action menus, breadcrumb path, grid/list view toggle
- Add full-screen, span (expand preview to full width), and zoom capabilities to the image preview

## Progress
### Done
- Rewrote `global.css` — removed all radial gradients, grid patterns, and glass effects; clean white body with warm-cream sidebar; smooth scrollbars; fade-in, slide-up, scale-in keyframe animations
- Rewrote `lib/ui.ts` — new utility classes using Tailwind v4 inline approach: `primaryButtonClass`, `secondaryButtonClass`, `ghostButtonClass`, `dangerButtonClass`, `iconButtonClass`, `fieldInputClass`, `cardClass`, `hoverCardClass`, `selectedCardClass`
- Added `currentPage: AppPage` (`'files' | 'account'`) and `setCurrentPage` to `stores/workspace-store.ts`
- Created `components/top-bar.tsx` — fixed 56px header with app logo, user avatar (initials circle), dropdown with Account link and Sign out; uses `useLogoutMutation` from `use-auth.ts`
- Created `components/account-page.tsx` — full page with large user avatar, name, email, `StorageSection` (progress bar via `useStorageUsageQuery`), `ChangePasswordSection` (expand/collapse form via `useChangePasswordMutation`), sign out button
- Redesigned `components/auth-screen.tsx` — clean centered card on white background, subtle slide-up animation, demo credentials shown discreetly at bottom
- Redesigned `components/home-shell.tsx` — removed all gradient/glass styling; layout: sidebar (w-60, warm-cream bg, "My Drive" button, `FolderTree`, `StorageBar` at bottom) + main content area; all mutations and state management preserved
- Redesigned `components/library-panel.tsx` — Google Drive-style grid and list views; breadcrumb path; Upload + New Folder buttons; search input with expand-on-focus; grid/list toggle (primary highlight for active mode); action menu (⋮) with Properties, Download, Move, Delete; column headers for list view (Name, Type, Size, Added)
- Cleaned up `components/folder-tree.tsx` — removed sticky backdrop-blur header; flat indentation with rounded active state and primary color highlighting
- Cleaned up `components/media-viewer.tsx` — white dialogs with scale-in animation; `ViewerStage` handles all media kinds; file preview dialog split into preview area + details sidebar (Type, Size, Created, Location, Status) + Download button; image viewer with zoom (mousewheel + buttons), pan when zoomed, full-screen overlay, and span mode (hides details sidebar)
- Cleaned up `components/upload-panel.tsx` — dashed upload area, file list with size, primary/secondary buttons
- Cleaned up `components/confirmation-modal.tsx`, `create-folder-modal.tsx`, `move-item-modal.tsx` — consistent white dialogs, icon + title header, primary/danger action buttons
- Updated `App.tsx` — added `LoadingScreen`, `AuthenticatedApp` with `TopBar` + conditional `HomeShell`/`AccountPage` based on `currentPage` from workspace store
- Updated `index.html` — title changed to "HomeServer", added Inter font from Google Fonts
- Fixed `use-library.ts` lint error — refactored `useFilePreview` to avoid `setState` inside `useEffect` by using `useMemo` for blob URL creation and `useRef` for cleanup tracking
- Added image zoom (Ctrl+wheel + buttons, 25%-1000%, pan on drag when zoomed), full-screen (overlay with dark backdrop, own zoom controls, Escape to close), and span mode (toggle to hide details sidebar, expand preview to full width) to `media-viewer.tsx`
- Fixed all lint and type errors — zero warnings, zero errors on `npm run lint`, `tsc --noEmit`, and `npm run build`

### Blocked
- (none)

## Key Decisions
- Use a single `currentPage` state in the existing `workspace-store.ts` to toggle between `'files'` and `'account'` views instead of adding a router dependency
- Refactored `useFilePreview` to compute blob URLs during render via `useMemo` (with `useRef`-based cleanup in `useEffect`) rather than calling `setState` inside the effect, to satisfy the `react-hooks/set-state-in-effect` lint rule
- Replaced the large `@layer components` CSS approach with inline Tailwind utility classes exported from `lib/ui.ts`, making the styling more maintainable and co-located with components
- Track image natural dimensions via `onLoad` event state instead of reading `ref.current` during render, to satisfy the `react-hooks/refs` lint rule

## Critical Context
- `tsc --noEmit`, `npm run lint`, and `npm run build` all pass with zero errors after the full UI redesign
- The color palette is defined as CSS custom properties in `global.css :root` and is untouched — all components reference them via `var(--primary)`, `var(--secondary)`, `var(--outline-variant)`, etc.
- The demo credentials (`admin@homeserver.tailnet` / `media-demo`) are still present in `auth-screen.tsx` but shown discreetly at the bottom
- Image preview zoom is: 25%-1000% range, Ctrl+wheel to zoom, drag to pan when zoomed > 1x, reset button, dimension readout on load
- Full-screen mode is a separate fixed overlay (`z-[60]`) with its own zoom controls and a dark backdrop
- Span mode hides the 300px details sidebar and lets the preview expand to the full dialog width; toggled by a button in the toolbar above the preview
- `useFolderContentsQuery` depends on `selectedFolderId` and the folder tree; enabled only when both are available
- `useFilePreview` uses `staleTime: Number.POSITIVE_INFINITY` and creates blob URLs; cleanup revokes them on dependency change

## Relevant Files
- `frontend/src/components/media-viewer.tsx`: Contains `ViewerStage` (renders image/video/audio/document previews), `ImageViewer` (zoom + pan), `ImageFullscreen` (full-screen overlay), and `MediaViewer` (the preview dialog); image preview at `ViewerStage` case `'image'`
- `frontend/src/components/library-panel.tsx`: Main file/folder grid and list with action menus
- `frontend/src/components/home-shell.tsx`: Main app shell with sidebar, folder tree, storage bar, and content area
- `frontend/src/components/account-page.tsx`: New account page with user info, storage, password change
- `frontend/src/components/top-bar.tsx`: New top bar with user dropdown
- `frontend/src/lib/ui.ts`: UI utility class exports
- `frontend/src/global.css`: CSS custom properties and base styles
- `frontend/src/stores/workspace-store.ts`: Zustand store with `currentPage`, `selectedFolderId`, `viewMode`, etc.
- `frontend/src/hooks/use-library.ts`: `useFilePreview` hook (blob URL logic)
- `frontend/src/types/library.ts`: Type definitions for `FileRecord`, `FolderRecord`, `FolderTreeNode`, etc.
