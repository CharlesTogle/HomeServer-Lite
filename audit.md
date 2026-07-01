# Standards Compliance Audit — HomeServer-Lite

**Date:** 2026-06-24
**Scope:** Full repository (`/home/charles/Documents/Projects/HomeServer-Lite`), excluding ignored/generated artifacts such as `dist/`, `.env`, `node_modules/`, and storage directories.

---

## Overall Score

| Category | ERRORs | WARNINGs |
|----------|--------|----------|
| Security | 4 | 4 |
| Data Integrity | 4 | 2 |
| Performance | 1 | 2 |
| Code Quality | 2 | 6 |
| Error Handling | 1 | 1 |
| API Design | 1 | 2 |
| Concurrency | 2 | 1 |
| Testing | 0 | 2 |
| DevOps | 1 | 2 |
| **Total** | **15** | **22** |

---

## CRITICAL — Must Fix Before Any Deployment

---

### 1. `deleteFile()` and `deleteFolder()` Soft-Delete Metadata But Delete File Bytes

**Severity:** ERROR — Data Integrity
**Files:** `backend/src/services/sqlite-library-service.ts:1434-1450`, `backend/src/services/sqlite-library-service.ts:655-719`, `backend/src/services/sqlite-library-service.ts:1766-1826`

The trash flow marks rows as soft-deleted, then immediately unlinks the file bytes from disk. Restore later only clears `deleted_at`; it does not restore bytes because they are gone.

```ts
// backend/src/services/sqlite-library-service.ts:1443-1450
this.db
  .prepare('UPDATE files SET deleted_at = ?, updated_at = ? WHERE id = ?')
  .run(now, now, file.id);

await this.safeUnlink(file.storageRelPath);
```

For folders, every nested file is also unlinked after metadata is soft-deleted:

```ts
// backend/src/services/sqlite-library-service.ts:715-718
for (const file of filesInFolders) {
  await this.safeUnlink(file.storage_rel_path);
}
```

The user-visible risk is severe: a normal Delete action appears recoverable because the app has trash and restore APIs, but restoring creates metadata for files whose contents no longer exist. Preview/download then fail with missing disk content.

**Fix:** Do not unlink bytes during soft delete. Either keep bytes in place until permanent delete, or atomically move bytes into a trash namespace and move them back on restore. Only `hardDeleteFile()`, `permanentlyDeleteEntry()`, `emptyTrash()`, and expired-trash cleanup should remove bytes.

---

### 2. Upload Flow Blocks The Request Instead Of Returning Immediately And Reporting Progress

**Severity:** ERROR — Concurrency / API Design / Performance
**Files:** `frontend/src/services/library-service.ts:437-482`, `backend/src/routes/upload-routes.ts:124-146`, `backend/src/services/sqlite-library-service.ts:1031-1242`

The current upload flow waits for the content route to fully stream, hash, quota-check, rename, insert metadata, update counters, and refresh batch status before the client gets a response. The frontend uploads each file sequentially and awaits the full request for every file.

```ts
// frontend/src/services/library-service.ts:452-480
for (const [index, file] of input.files.entries()) {
  const uploadItem = await apiJson(...);
  const uploadedFile = await apiJson(`/api/upload-items/${uploadItem.id}/content`, {
    body: formData,
    method: 'POST',
  });
  uploadedFiles.push(toFileRecord(uploadedFile));
}
```

```ts
// backend/src/routes/upload-routes.ts:135-145
const multipartFile = await request.file();
const file = await app.libraryService.uploadItemContent(...);
reply.code(201);
return toFileResponse(file);
```

This keeps the HTTP request and UI action blocked for the duration of disk I/O and hashing. For large files or many files, the user cannot get a responsive queued/progress experience, and server request handlers are tied up doing long-running work.

**Fix:** Change the required flow to:

1. Client sends an upload request to the server.
2. Server validates/authenticates, creates an upload job, and returns `200` immediately with the upload/job ID.
3. Server-side worker continues the upload/finalization work outside the request lifecycle.
4. Client subscribes via WebSocket or SSE and the UI shows per-file and aggregate `%` progress.
5. The worker emits `queued`, `uploading`, `processing`, `complete`, and `failed` events so the client can update progress without polling or blocking user actions.

---

## HIGH — Fix Before Going Live

---

### 3. Quota Enforcement Has A Race Window Across Concurrent Uploads

**Severity:** ERROR — Data Integrity / Concurrency
**File:** `backend/src/services/sqlite-library-service.ts:1133-1213`

Quota is checked after the file has been streamed to disk, then usage is incremented later inside a transaction. Two concurrent uploads can both read the same `used_bytes`, both pass the check, and both increment usage beyond `quota_bytes`.

```ts
// backend/src/services/sqlite-library-service.ts:1136-1144
const usageRow = queryRequiredRow(...);

if (usageRow.used_bytes + uploadStats.sizeBytes > usageRow.quota_bytes) {
  throw new BadRequestError('Storage quota exceeded.');
}

// Later: backend/src/services/sqlite-library-service.ts:1199-1203
UPDATE user_storage_usage SET used_bytes = used_bytes + ? WHERE user_id = ?
```

The same pattern exists for shared-folder quota at `backend/src/services/sqlite-library-service.ts:1146-1154` and `backend/src/services/sqlite-library-service.ts:1205-1210`.

**Fix:** Reserve quota atomically before finalizing the upload. Use a conditional update such as `UPDATE user_storage_usage SET used_bytes = used_bytes + ? WHERE user_id = ? AND used_bytes + ? <= quota_bytes`, then check `changes === 1`. Roll back the reservation if later finalization fails. Apply the same pattern to `shared_folder_storage`.

---

### 4. Upload Validation Trusts Client-Supplied MIME And Extension

**Severity:** ERROR — Security / Data Integrity
**Files:** `backend/src/services/sqlite-library-service.ts:1070-1084`, `backend/src/services/sqlite-library-service.ts:1173-1176`, `backend/src/utils/file-types.ts:1-35`

The stored extension comes from the original filename, and the persisted MIME type comes from the multipart header. Both are attacker-controlled.

```ts
// backend/src/services/sqlite-library-service.ts:1082-1084
const storedExtension = getStoredExtension(effectiveOriginalName);

// backend/src/services/sqlite-library-service.ts:1173-1176
multipartFile.mimetype || 'application/octet-stream',
```

`backend/src/utils/file-types.ts` defines an allow/block policy, but upload finalization does not enforce it before storing the file. A malicious or mistaken client can upload content under a misleading MIME/extension. Since file content is later streamed back with the persisted MIME type, this can become an inline-content security issue as well as a viewing/data-quality issue.

**Fix:** Detect MIME from file contents server-side after streaming to temp storage, compare it with an allowlist, and reject blocked extensions before metadata insertion. Keep browser MIME only as a hint. Store the detected MIME type, not `multipartFile.mimetype`.

---

### 5. PDF Preview Uses A Direct Authenticated URL That Cannot Attach The Bearer Token

**Severity:** ERROR — Logic / API Design
**Files:** `frontend/src/components/media-viewer.tsx:131-138`, `backend/src/routes/file-routes.ts:119-141`, `frontend/src/hooks/use-library.ts:222-260`

The PDF preview iframe points directly at `/api/files/:id/download`.

```tsx
// frontend/src/components/media-viewer.tsx:131-138
<iframe
  src={resolveApiUrl(`/api/files/${props.file.id}/download`)}
  title={props.file.name}
/>
```

That backend route is protected by `preHandler: app.authenticate` and requires an `Authorization: Bearer ...` header. Browser iframe navigation cannot attach the app's in-memory bearer token, so PDF preview will return `401` even though the user is authenticated. This is especially likely because the app intentionally keeps access tokens out of storage.

**Fix:** Use the same blob preview path used for other media: fetch the PDF through `apiBlob()` with auth headers, create an object URL, and point the iframe at that object URL. Alternatively, expose a short-lived signed preview URL, but do not rely on iframe headers.

---

### 6. Favorites Can Store Arbitrary Item IDs Without Ownership Or Existence Checks

**Severity:** ERROR — Security / Data Integrity
**Files:** `backend/src/routes/favorite-routes.ts:80-96`, `backend/src/services/sqlite-library-service.ts:2086-2092`

`POST /api/favorites` accepts any `itemId` and `itemKind`, then inserts it directly into `user_favorites`.

```ts
// backend/src/services/sqlite-library-service.ts:2086-2092
this.db
  .prepare(
    'INSERT OR IGNORE INTO user_favorites (user_id, item_id, item_kind, created_at) VALUES (?, ?, ?, ?)',
  )
  .run(userId, itemId, itemKind, now);
```

There is no verification that the item exists, belongs to the user, or is shared with the user. This allows orphan favorite rows and can leak whether guessed IDs later become visible through inconsistent list behavior.

**Fix:** In `addFavorite()`, call `getFile(userId, itemId)` for file favorites and `getFolder(userId, itemId)` for folder favorites before inserting. Add foreign-key-like cleanup or validation where polymorphic FK is not available.

---

### 7. Permanent Folder Delete Mutates The Database Before Disk Deletion Finishes

**Severity:** ERROR — Data Integrity / Error Handling
**File:** `backend/src/services/sqlite-library-service.ts:721-791`

`hardDeleteFoldersAndFiles()` deletes database rows and updates usage inside a transaction, then removes directories afterward. It also starts file unlink operations inside the transaction but intentionally ignores unlink failures.

```ts
// backend/src/services/sqlite-library-service.ts:749-768
for (const file of filesInFolders) {
  this.db.prepare('DELETE FROM files WHERE id = ?').run(file.id);
  ...
  this.safeUnlink(file.storage_rel_path).catch(() => undefined);
}
```

If disk deletion fails because of permissions, missing mounts, or transient filesystem errors, metadata is already gone and the system has orphaned bytes that users cannot manage through the app.

**Fix:** Use a deletion job/state machine. Mark rows as `deleting`, delete bytes with retry/error recording, then delete metadata only after disk cleanup succeeds. If keeping synchronous deletion, at least perform disk deletion first into a recoverable trash/quarantine location and do not swallow unexpected unlink failures.

---

### 8. Auth Bootstrap Logs User Email Addresses

**Severity:** WARNING — Security
**File:** `backend/src/utils/bootstrap.ts:53-56`

Seed bootstrap logs raw email addresses.

```ts
app.log.info({ email: normalizedEmail }, 'Seeded user');
app.log.warn({ email: normalizedEmail }, 'User already exists');
```

Email addresses are PII. Logs are often shipped, retained, or copied during debugging. This violates the house rule to avoid sensitive data in logs unless there is a clear operational need.

**Fix:** Log user IDs or masked emails, for example `c***@domain.test`, and avoid logging raw seeded credentials or PII.

---

### 9. Login Screen Ships Hardcoded Demo Credentials As Field Defaults

**Severity:** ERROR — Security
**File:** `frontend/src/components/auth-screen.tsx:6-12`, `frontend/src/components/auth-screen.tsx:77-79`

The login screen initializes the email and password fields with committed demo credentials and displays them in the UI.

```tsx
const defaultEmail = 'admin@homeserver.tailnet'
const defaultPassword = 'media-demo'

const [email, setEmail] = useState(defaultEmail)
const [password, setPassword] = useState(defaultPassword)
```

Even for a private Tailscale app, committed default credentials become the first thing an attacker, guest on the tailnet, or future maintainer tries. If the seeded environment ever matches these values, the app is compromised by source disclosure alone.

**Fix:** Remove demo credentials from production source. Use empty fields by default. If demo mode is useful, gate it behind an explicit non-production flag and never prefill the password.

---

### 10. Any Authenticated User Can Trigger Global Trash Cleanup For All Users

**Severity:** ERROR — Security / Data Integrity
**Files:** `backend/src/routes/trash-routes.ts:118-139`, `backend/src/services/sqlite-library-service.ts:1912-1978`

`POST /api/trash/cleanup` is available to any authenticated user, but the service deletes expired trashed folders/files across the whole database without scoping to that user.

```ts
// backend/src/routes/trash-routes.ts:118-139
app.post('/api/trash/cleanup', { preHandler: app.authenticate }, async () => {
  const deletedCount = await app.libraryService.cleanupExpiredTrash();
  return { deletedCount };
});
```

```ts
// backend/src/services/sqlite-library-service.ts:1916-1927
FROM folders WHERE deleted_at IS NOT NULL AND deleted_at < ?
FROM files WHERE deleted_at IS NOT NULL AND deleted_at < ?
```

This lets one normal user initiate destructive cleanup of another user's expired trash. Even if the 30-day policy is intended, a user-triggered endpoint should not perform global maintenance.

**Fix:** Remove the public route and run cleanup as a trusted scheduled worker. If an endpoint is needed for manual maintenance, protect it with an admin-only capability and make the service's scope explicit.

---

### 11. `start-dev.sh` Starts The Wrong Repository

**Severity:** ERROR — DevOps
**File:** `start-dev.sh:5`

The script lives in `HomeServer-Lite` but changes into `/home/charles/Documents/Projects/HomeServer` before starting processes.

```bash
cd /home/charles/Documents/Projects/HomeServer || exit 1
```

Running this script from the lite repository starts and kills processes for the original `HomeServer` project, writes `.logs` and `.pids` there, and leaves the current repo untouched. This can make smoke tests and manual QA validate the wrong application.

**Fix:** Resolve the script directory dynamically and `cd` there:

```bash
script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir" || exit 1
```

---

## MEDIUM — Fix Soon

---

### 12. `.codex` Design-System Persistence Allows Path Traversal Writes

**Severity:** WARNING — Security / DevOps
**Files:** `.codex/skills/ui-ux-pro-max/scripts/design_system.py:504-531`, `.codex/skills/ui-ux-pro-max/scripts/search.py:68-70`

The local skill's `--persist` mode writes files using `project_name`, `page`, and `output_dir` without constraining the resolved path to the intended output tree.

```py
base_dir = Path(output_dir) if output_dir else Path.cwd()
project_slug = project_name.lower().replace(' ', '-')
design_system_dir = base_dir / "design-system" / project_slug
...
page_file = pages_dir / f"{page.lower().replace(' ', '-')}.md"
```

If `project_name` or `page` includes path separators such as `../`, the script can write outside the expected `design-system/<project>/` directory. This is a local developer tool, so the severity is lower than a network route, but it is still part of the intake file set and can modify arbitrary workspace files when invoked by an agent.

**Fix:** Slugify to a strict allowlist such as `[a-z0-9-]`, reject path separators, resolve the final path, and assert it remains under the chosen base output directory before writing.

---

### 13. Password Change Does Not Revoke Existing Refresh Sessions

**Severity:** WARNING — Security
**File:** `backend/src/services/sqlite-auth-service.ts:78-97`

Changing a password only updates `users.password_hash`. Existing refresh sessions remain active and can continue minting access tokens.

```ts
this.db.prepare(
  'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
).run(newHash, now, userId);
```

If a password is changed because a device or credential was compromised, the attacker keeps access until their refresh session expires or is explicitly logged out.

**Fix:** After a successful password change, revoke all sessions for that user except optionally the current session. The route may need to pass the current session ID into `changePassword()` so the active session can be preserved intentionally.

---

### 14. Multiple Package Manager Lockfiles Create Install Drift

**Severity:** WARNING — DevOps / Code Quality
**Files:** `frontend/package-lock.json`, `frontend/pnpm-lock.yaml`, `frontend/package.json:16`, `backend/pnpm-lock.yaml`, `backend/package.json:16`, `package.json:4-8`

The repo mixes npm and pnpm signals: root scripts use `npm --prefix`, backend declares `packageManager: pnpm@10.33.0`, and frontend has both `package-lock.json` and `pnpm-lock.yaml`.

This creates reproducibility risk because `npm install` and `pnpm install` can resolve different dependency trees. It is especially risky here because frontend dependencies include compiler/build tooling and backend dependencies include native SQLite bindings.

**Fix:** Choose one package manager for the monorepo, remove the other lockfiles, and update `README.md`, `start-dev.sh`, and root scripts to use the same tool consistently.

---

### 15. `SqliteLibraryService` Is A God Service Handling Most Backend Domains

**Severity:** WARNING — Code Quality
**File:** `backend/src/services/sqlite-library-service.ts:1-2132`
**Standard:** No God Classes / God Components

`SqliteLibraryService` is 2,132 lines and handles folder trees, shared folders, search/filter/sort, uploads, quota accounting, file replacement, moves, soft delete, hard delete, trash restore, expired cleanup, favorites, path resolution, and upload hashing.

This is not just a line-count issue. The class owns unrelated lifecycle rules: upload finalization, quota mutation, trash retention, favorite listing, shared-folder accounting, and filesystem cleanup. That makes it hard to test a single invariant without constructing the entire library service, and it increases the chance that a fix in one domain breaks another.

**Fix:** Split by cohesive backend capability while keeping transaction boundaries explicit. Start with `UploadService`, `TrashService`, `FolderService`, `FileService`, `QuotaService`, and `FavoriteService`, backed by small SQLite repository functions. Move shared path helpers and row mappers out of the service file.

---

### 16. `HomeShell` Is A God Component Coordinating Nearly The Entire App

**Severity:** WARNING — Code Quality
**File:** `frontend/src/components/home-shell.tsx:1-940`
**Standard:** No God Classes / God Components

`HomeShell` is 940 lines and owns sidebar layout, storage display, folder tree wiring, current-page switching, upload modal orchestration, create-folder modal orchestration, move modal orchestration, delete confirmation, preview/properties state, file download handling, folder download handling, selected folder sync, and page-level error state.

The component is doing shell layout, page routing, command orchestration, and modal state at the same time. This makes UI changes risky because unrelated flows share one stateful component and one render tree.

**Fix:** Extract feature coordinators without over-abstracting the visual design. Good seams are `StorageBar`, `SidebarNav`, `LibraryModals`, `useLibraryActions`, and `useInspectorState`. Keep `HomeShell` as a thin layout component that chooses the current page and passes action handlers down.

---

### 17. `MediaViewer` Combines Viewer Dialog, Image Zoom Engine, Fullscreen Overlay, PDF/Text Editor, And Metadata Panel

**Severity:** WARNING — Code Quality
**File:** `frontend/src/components/media-viewer.tsx:1-981`
**Standard:** No God Classes / God Components

`media-viewer.tsx` is 981 lines and contains Markdown/text loading and editing, image zoom/pan, fullscreen image overlay, media kind switching, PDF iframe rendering, preview error states, metadata rendering, span mode, and dialog chrome.

These responsibilities have different state machines. Image pan/zoom behavior, markdown editing, and file metadata display change for different reasons, but they all live in one file. That makes regressions likely when adding preview features.

**Fix:** Split by viewer kind and interaction state: `ImageViewer`, `ImageFullscreen`, `DocumentViewer`, `MediaPreviewDialog`, and `FileDetailsPanel` should be separate files. Keep shared formatting and toolbar button styles small and local.

---

### 18. Frontend Library API Module Is A God Client

**Severity:** WARNING — Code Quality
**File:** `frontend/src/services/library-service.ts:1-736`
**Standard:** No God Classes / God Components

`library-service.ts` handles backend DTO conversion, folder tree construction, folder content pagination, upload batching, file upload, delete, move, markdown replacement upload, download preparation, trash APIs, favorites APIs, shared-folder APIs, and client-side folder search helpers.

The module is a broad client-side domain service for almost every file-library concern. It creates high merge-conflict risk and makes it difficult to reason about cache invalidation because every library operation sits in one module.

**Fix:** Split into small API modules by backend resource: `folder-service.ts`, `file-service.ts`, `upload-service.ts`, `trash-service.ts`, `favorite-service.ts`, and `shared-folder-service.ts`. Keep DTO mappers close to the resource they map.

---

### 19. Local `.codex` Design-System Script Is A God Script

**Severity:** WARNING — Code Quality
**File:** `.codex/skills/ui-ux-pro-max/scripts/design_system.py:1-1067`
**Standard:** No God Classes / God Components

`design_system.py` is 1,067 lines and combines search orchestration, reasoning-rule matching, design-system selection, ASCII rendering, Markdown rendering, persistence, page override generation, and page-type heuristics.

This is a local skill utility rather than application runtime code, so it is lower risk than the app god components. It still belongs in the audit because the complete intake manifest includes `.codex/**`, and the same file also contains the path-write risk noted above.

**Fix:** Split the script into `generator.py`, `formatters.py`, `persistence.py`, and `page_overrides.py`. Keep CLI argument parsing in `search.py` and keep file-writing isolated behind a path-safe persistence function.

---

### 20. `verifyAccessToken()` Can Convert Malformed JSON Into A 500

**Severity:** WARNING — Error Handling / Security
**File:** `backend/src/utils/auth-crypto.ts:82-84`

The token signature is checked before parsing, but `JSON.parse()` is not guarded. If an attacker can produce a correctly signed but malformed payload through a secret/config mishap, or if a bug issues a malformed token, this path throws a raw `SyntaxError` that becomes a 500 rather than a clean 401.

```ts
const parsedPayload = JSON.parse(
  Buffer.from(rawPayload, 'base64url').toString('utf8'),
) as Partial<AccessTokenPayload>;
```

**Fix:** Wrap payload decode/parse in `try/catch` and throw `UnauthorizedError('Invalid access token.')` for any decode or parse failure.

---

### 21. Migration Tracking Uses A Non-Cryptographic Hash That Can Collide

**Severity:** WARNING — Data Integrity / DevOps
**File:** `backend/src/plugins/database-plugin.ts:167-175`, `backend/src/plugins/database-plugin.ts:198-219`, `backend/src/plugins/database-plugin.ts:258-278`

Migration identity is tracked by `simpleHash()`, a short 32-bit-style rolling hash converted to base36.

```ts
function simpleHash(input: string): string {
  let hash = 0;
  ...
  return hash.toString(36);
}
```

Collisions are unlikely in small lists but not impossible. A collision means a migration can be skipped even though it was never applied, leaving production schema out of sync.

**Fix:** Use a deterministic migration ID plus SHA-256 checksum. Store `id`, `name`, `checksum`, and `applied_at`. Do not use content hash alone as the primary identity.

---

### 22. Docs And Runtime Contract Disagree On Database/Auth Architecture

**Severity:** WARNING — Code Quality / API Design
**Files:** `README.md:7-11`, `README.md:46-63`, `PLAN.md:7-8`, `PLAN.md:55-64`, `backend/package.json:23-31`, `backend/src/utils/env.ts:47-62`

`README.md` describes PostgreSQL and a custom access/refresh-token contract. `PLAN.md` describes SQLite and Better Auth. The backend implementation uses SQLite (`better-sqlite3`) and a custom token/cookie service, not Better Auth.

This creates an implementation-risk problem: future agents and humans have three competing sources of truth, so new features may target the wrong auth/session/storage model.

**Fix:** Pick one authoritative v1 architecture document and update or archive the others. If the current implementation is the contract, update `README.md` and `PLAN.md` to say SQLite plus the current custom auth. If Better Auth is still required, create a migration issue and mark current custom auth as transitional.

---

### 23. `@tanstack/react-router` Is Installed Despite The Repo Constraint Of No React Router

**Severity:** WARNING — Code Quality / DevOps
**Files:** `AGENTS.md:6`, `frontend/package.json:20`

The repo guidance explicitly says no router and state-based page routing via Zustand, but `frontend/package.json` includes `@tanstack/react-router`.

```json
"@tanstack/react-router": "^1.170.8"
```

Even if unused today, the dependency invites future drift from the state-routing decision and adds install/build surface area.

**Fix:** Remove `@tanstack/react-router` unless there is a concrete planned use and the repo guidance is changed.

---

### 24. Backend Tests Cover Only Two Broad Scenarios

**Severity:** WARNING — Testing
**Files:** `backend/test/library-routes.test.ts:1-8`, `backend/test/auth-routes.test.ts:1-8`, `backend/test/support/library-route-scenarios.ts:220-234`

The test files delegate to two happy-path-ish scenario functions. They cover basic auth lifecycle and ownership browsing, but they do not assert the highest-risk behavior found in this audit: trash restore preserving bytes, permanent delete cleanup consistency, quota race handling, favorite ownership validation, MIME detection, PDF preview auth behavior, or upload progress behavior.

**Fix:** Add focused tests for each data-integrity and authorization invariant. In particular, add tests that delete then restore a file and assert content still downloads, attempt concurrent quota-exceeding uploads, and attempt to favorite another user's file.

---

### 25. Text Preview Reads Entire Files Into Memory

**Severity:** WARNING — Performance
**File:** `backend/src/routes/file-routes.ts:144-172`

`GET /api/files/:fileId/text` loads the whole file with `readFile(..., 'utf8')` before replying.

```ts
const content = await readFile(descriptor.absolutePath, 'utf8');
return content;
```

Any uploaded text-like file within the global 50MB upload limit can allocate the full file as a UTF-8 string. With concurrent previews, this can create avoidable memory pressure on a small homeserver.

**Fix:** Cap text preview bytes, for example the first 512KB or 1MB, and return `truncated: true` metadata if needed. Stream large text downloads through the download endpoint instead of previewing them in memory.

---

### 26. Folder Listing Recomputes Counts And Extension Lists With Multiple Round Trips

**Severity:** WARNING — Performance
**Files:** `backend/src/services/sqlite-library-service.ts:794-878`, `backend/src/services/sqlite-library-service.ts:365-405`

Folder entries are assembled with separate queries for folders, total file count, paged files, current folder file names, and extension derivation. Folder tree listing similarly queries folders and file counts separately, then builds counts in memory.

This is not a proven N+1 loop, but it is a sequential round-trip risk: one page response waits on several synchronous SQLite calls. It will get slower as folder size grows, especially because available extensions are derived by reading all current folder file names.

**Fix:** Consolidate count and extension queries, add targeted indexes for active folder listings, and consider precomputed folder counters if the UI needs counts on every tree render.

---

### 27. `getFavorites()` Uses Repeated Linear Searches While Building Results

**Severity:** WARNING — Performance / Code Quality
**File:** `backend/src/services/sqlite-library-service.ts:1981-2083`

`getFavorites()` fetches favorite rows, then batches folder and file lookup. That avoids SQL N+1, which is good. However, inside each fetched folder/file loop it calls `rows.find(...)`, creating O(n*m) in-memory work for larger favorite lists.

```ts
const fav = rows.find((r) => r.item_id === fr.id);
```

This is a low-severity performance smell today, but it is easy to avoid.

**Fix:** Build a `Map<string, FavoriteRow>` keyed by `item_id` once, then use constant-time lookups.

---

### 28. `database-plugin.ts` Duplicates Migration Application Logic

**Severity:** WARNING — Code Quality / DRY
**File:** `backend/src/plugins/database-plugin.ts:182-234`, `backend/src/plugins/database-plugin.ts:245-279`

The test-memory and durable branches contain near-identical migration tracking and application logic. Any migration behavior fix must be made twice.

**Fix:** Extract `applyMigrations(db: Database.Database): void` and call it from both branches.

---

## LOW — Should Fix

---

### 29. `parseByteRange()` Returns 400 Instead Of 416 For Invalid Ranges

**Severity:** WARNING — API Design
**File:** `backend/src/routes/file-routes.ts:96-101`

Invalid byte ranges currently throw `BadRequestError`, producing a 400.

```ts
if (range === null) {
  reply.header('content-range', `bytes */${descriptor.sizeBytes}`);
  throw new BadRequestError('Invalid range header.');
}
```

HTTP range semantics expect `416 Range Not Satisfiable` with `Content-Range: bytes */size`. Some media clients behave better with the standard status.

**Fix:** Add a `RangeNotSatisfiableError` or reply directly with `416` for invalid ranges.

---

### 30. Download Filename Is Not Sanitized For Header Context

**Severity:** WARNING — Security
**File:** `backend/src/routes/file-routes.ts:133-138`

The download endpoint injects `displayName` into `Content-Disposition`.

```ts
`attachment; filename="${descriptor.file.displayName}"`
```

`ensureValidDisplayName()` blocks slashes and length, but it does not explicitly reject quotes, CR, or LF. Many frameworks sanitize header values, but relying on that implicitly is fragile.

**Fix:** Use a safe `Content-Disposition` builder or encode with `filename*=` per RFC 5987. Reject or escape CR/LF and quotes before header construction.

---

### 31. Upload Cleanup Worker Is Designed But Not Implemented

**Severity:** WARNING — Error Handling / Data Integrity
**Files:** `docs/system-design-upload-storage.md:473-491`, `backend/src/services/sqlite-library-service.ts:1225-1240`

The design document correctly calls for stale upload cleanup and reconciliation, but the backend only handles cleanup in the immediate catch path. If the process crashes after an item is claimed or after a temp file is written, rows can remain stuck in `uploading` and `.part` files can remain on disk.

**Fix:** Add a startup/scheduled cleanup worker that marks stale `uploading` items failed, deletes stale temp files, and reconciles `ready` rows against missing disk files.

---

## Files With Zero Violations

- `frontend/src/stores/session-store.ts` — keeps access tokens in memory only and does not persist them to browser storage.
- `backend/src/utils/storage-paths.ts` — centralizes display-name checks and verifies resolved paths stay inside `STORAGE_ROOT`.
- `backend/src/utils/cookies.ts` — refresh cookies are serialized with `HttpOnly`, scoped path, and `SameSite=Strict`.
- `backend/src/plugins/multipart-plugin.ts` — caps multipart uploads to one file and a bounded file size.
- `frontend/src/utils/format.ts` — formatting utilities are pure and isolated from UI state.

---

## Things that we're done correctly

- `frontend/src/stores/session-store.ts:11-26` keeps the access token in Zustand memory only, matching the no-localStorage token requirement.
- `frontend/src/services/api-client.ts:138-192` deduplicates refresh-token calls with a shared `refreshPromise` and retries the original request after a successful refresh.
- `backend/src/utils/storage-paths.ts:48-64` resolves storage paths against a configured root and rejects path escapes.
- `backend/src/services/sqlite-library-service.ts:1076-1084` writes uploads through a temp `.part` path before final rename, which is the right shape for crash-safe upload finalization.
- `backend/src/services/sqlite-library-service.ts:365-405` avoids a folder-tree SQL N+1 by loading all folders and file counts in batches, then computing counts in memory.
- `backend/src/routes/file-routes.ts:72-117` supports byte-range reads for media playback.
- `backend/src/utils/env.ts:47-62` validates key environment inputs with Zod and refuses missing required production storage/database/token settings.

---

## Priority Fix Roadmap

### P0 — Data Loss And Upload Architecture

| # | Issue | File(s) |
|---|-------|---------|
| 1 | Stop deleting bytes during soft delete; make trash restore real | `sqlite-library-service.ts` |
| 2 | Replace blocking upload completion with immediate `200` + worker + SSE/WebSocket progress UI | `library-service.ts`, `upload-routes.ts`, `sqlite-library-service.ts` |
| 3 | Make quota reservation atomic | `sqlite-library-service.ts` |

### P1 — Security And Auth-Correct Preview

| # | Issue | File(s) |
|---|-------|---------|
| 4 | Detect MIME server-side and enforce the upload type policy | `sqlite-library-service.ts`, `file-types.ts` |
| 5 | Fix PDF preview to use authenticated blob URLs or signed URLs | `media-viewer.tsx`, `use-library.ts` |
| 6 | Validate favorite ownership/existence before insert | `favorite-routes.ts`, `sqlite-library-service.ts` |
| 7 | Remove hardcoded demo credentials from the login screen | `auth-screen.tsx` |
| 8 | Remove or admin-protect global trash cleanup endpoint | `trash-routes.ts`, `sqlite-library-service.ts` |

### P2 — Durability And Operational Safety

| # | Issue | File(s) |
|---|-------|---------|
| 9 | Make permanent delete disk/database cleanup recoverable | `sqlite-library-service.ts` |
| 10 | Implement stale upload cleanup/reconciliation worker | Backend services/jobs |
| 11 | Replace migration hash tracking with explicit IDs and SHA-256 checksums | `database-plugin.ts` |
| 12 | Fix `start-dev.sh` so it starts HomeServer-Lite, not HomeServer | `start-dev.sh` |
| 13 | Revoke existing sessions after password changes | `sqlite-auth-service.ts` |
| 14 | Split the god backend library service by cohesive capability | `sqlite-library-service.ts` |
| 15 | Split god frontend library shell/viewer/API modules | `home-shell.tsx`, `media-viewer.tsx`, `library-service.ts` |

### P3 — Consistency, Tests, And Polish

| # | Issue | File(s) |
|---|-------|---------|
| 16 | Align README, PLAN, docs, and implementation contract | `README.md`, `PLAN.md`, `docs/*` |
| 17 | Add focused tests for trash restore, quota races, favorites, MIME, and preview auth | `backend/test/*`, frontend tests |
| 18 | Cap text preview size and tighten range/download headers | `file-routes.ts` |
| 19 | Remove unused router dependency or update the architecture decision | `frontend/package.json`, `AGENTS.md` |
| 20 | Sanitize and split `.codex` design-system utility | `.codex/skills/ui-ux-pro-max/scripts/design_system.py` |
| 21 | Standardize on one package manager and lockfile | `package.json`, `frontend/*lock*`, `backend/*lock*` |

---

*Generated by audit on 2026-06-24 against repository standards, house experiences, and N+1/round-trip heuristics. Heuristic N+1 analysis was included. Second pass used `git ls-files -co --exclude-standard` as the complete intake manifest after the repo-intake script produced an empty candidate list due to an awk error.*
