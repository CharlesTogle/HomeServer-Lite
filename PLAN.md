# HomeServer Lite Implementation Plan

## Target

Build a lightweight private cloud platform for two people, deployed on a homeserver and accessed over Tailscale.

The app should provide authenticated file and folder management with local filesystem storage, SQLite metadata, Better Auth sessions, and a React user interface.

## Base Repository

This project is duplicated from:

```text
/home/charles/Documents/Projects/HomeServer
```

The duplicate lives at:

```text
/home/charles/Documents/Projects/HomeServer-Lite
```

The original `HomeServer` project should remain untouched while this lightweight version is implemented.

## Product Scope

V1 is intentionally small:

- Private-only access over Tailscale
- Exactly two users
- Better Auth for authentication
- SQLite for auth tables, file metadata, folder metadata, and storage usage
- React + Vite user-facing app
- Local filesystem file bytes
- Full CRUD for folders and files
- Nested folder hierarchy
- Per-user quota of `100GB`
- Storage status display as `x GB / 100 GB`
- Browser viewing for supported file types
- Downloading files through an authorized backend route

## Non-Goals

V1 does not need:

- Public sharing links
- Object storage such as S3
- Multi-server deployment
- Complex role-based permissions
- Media transcoding
- Background thumbnail generation
- Office document viewing
- External internet exposure

## Recommended Stack

- Backend: Fastify
- Auth: Better Auth
- Database: SQLite
- SQLite driver: `better-sqlite3`
- Frontend: existing React + Vite app
- Server access: Tailscale only
- Storage: local disk under `/srv/homeserver-lite/storage` or configurable `STORAGE_ROOT`
- Deployment: homeserver process for the API and built frontend assets, optionally behind Caddy or Nginx

## Existing Pieces To Reuse

The duplicated repo already contains useful pieces:

- React + Vite frontend
- Fastify backend structure
- Folder tree and folder browsing UI
- File/folder actions UI
- Upload flow UI
- Media viewer component
- Protected file content endpoint shape
- Byte-range video/audio streaming logic
- Local filesystem storage model
- Tests around auth, library routes, and file operations

Reuse the current shape where practical, but simplify and realign around SQLite and Better Auth.

## Core Architecture

```text
React App
  -> Better Auth client
  -> TanStack Query API hooks
  -> Fastify API
  -> Better Auth server/session checks
  -> SQLite metadata
  -> Local filesystem bytes
```

Rules:

- Frontend never reads the filesystem directly.
- All file access goes through authorized Fastify routes.
- Tailscale is the network boundary, not a replacement for app auth.
- SQLite stores metadata and auth/session records.
- File bytes stay on disk.
- Display names live in SQLite, not physical disk paths.

## Database Plan

Use Better Auth's SQLite tables for users and sessions.

Add app-owned tables for folders, files, and quota tracking.

### SQLite Runtime Pragmas

Enable these during database initialization:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Why:

- `WAL` improves normal read/write behavior for a small homeserver app.
- `foreign_keys` keeps folder/file/user metadata honest.
- `busy_timeout` avoids random lock errors during normal two-user activity.

### App Tables

```sql
CREATE TABLE folders (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  parent_folder_id TEXT NULL,
  name TEXT NOT NULL,
  storage_rel_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (parent_folder_id) REFERENCES folders(id) ON DELETE RESTRICT
);
```

```sql
CREATE UNIQUE INDEX folders_sibling_name_unique_idx
  ON folders (user_id, parent_folder_id, name);

CREATE UNIQUE INDEX folders_storage_rel_path_unique_idx
  ON folders (storage_rel_path);
```

```sql
CREATE TABLE files (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  folder_id TEXT NOT NULL,
  name TEXT NOT NULL,
  original_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_rel_path TEXT NOT NULL,
  sha256 TEXT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (folder_id) REFERENCES folders(id) ON DELETE RESTRICT
);
```

```sql
CREATE INDEX files_folder_lookup_idx
  ON files (user_id, folder_id, created_at);

CREATE UNIQUE INDEX files_storage_rel_path_unique_idx
  ON files (storage_rel_path);
```

```sql
CREATE TABLE user_storage_usage (
  user_id TEXT PRIMARY KEY,
  used_bytes INTEGER NOT NULL DEFAULT 0,
  quota_bytes INTEGER NOT NULL
);
```

Use `user_storage_usage` instead of recalculating usage on every request. Keep it correct inside upload/delete transactions.

## Storage Layout

Use stable IDs on disk instead of display names.

Recommended layout:

```text
/srv/homeserver-lite/storage
  /users
    /<user-id>
      /folders
        /<folder-id>
      /files
        /<file-id>.<ext>
      /tmp
        /<upload-id>.part
```

Rules:

- User-supplied names never become trusted filesystem paths.
- File display names stay in SQLite.
- Folder display names stay in SQLite.
- Stored filenames should use file IDs plus validated extensions.
- Store relative paths in SQLite.
- Resolve all relative paths against `STORAGE_ROOT` and reject escapes.

## Auth Plan

Replace custom auth with Better Auth.

Auth goals:

- Login/logout through Better Auth
- Session cookies managed by Better Auth
- Server-side route protection through a Fastify pre-handler
- Frontend auth state through Better Auth client
- No localStorage token storage

Routes:

```text
POST /api/auth/*
GET  /api/me
```

`GET /api/me` should return:

```json
{
  "user": {
    "id": "user-id",
    "email": "person@example.com"
  },
  "storage": {
    "usedBytes": 27487790694,
    "quotaBytes": 107374182400
  }
}
```

## Two-User Setup

Keep setup boring and safe.

Preferred v1 options:

1. Seed two users from environment variables during first boot.
2. Or allow registration only until two users exist, then disable it.

Recommended first implementation:

```text
HOMESERVER_USER_1_EMAIL=
HOMESERVER_USER_1_PASSWORD=
HOMESERVER_USER_2_EMAIL=
HOMESERVER_USER_2_PASSWORD=
```

On startup:

- Ensure each configured user exists.
- Ensure each user has a root folder.
- Ensure each user has a `100GB` quota row.
- Do not overwrite existing passwords silently after first creation unless explicitly designed.

## API Plan

Preserve the current API shape where practical.

### Folders

```text
GET    /api/folders/tree
GET    /api/folders/:folderId
GET    /api/folders/:folderId/entries
POST   /api/folders
PATCH  /api/folders/:folderId
DELETE /api/folders/:folderId
```

Folder operations:

- Create folder
- Rename folder
- Move folder
- Delete folder
- List folder entries
- List full folder tree

### Files

```text
GET    /api/files/:fileId
GET    /api/files/:fileId/content
GET    /api/files/:fileId/download
GET    /api/files/:fileId/text
POST   /api/files/upload
PATCH  /api/files/:fileId
DELETE /api/files/:fileId
```

File operations:

- Upload file
- Rename file
- Move file
- Delete file
- View inline content
- Download file
- Read text preview

### Storage

```text
GET /api/storage/usage
```

Response:

```json
{
  "usedBytes": 27487790694,
  "quotaBytes": 107374182400
}
```

## Upload Plan

Upload flow:

1. Authenticate request.
2. Validate target folder belongs to authenticated user.
3. Validate extension and MIME type.
4. Stream upload to a temp file.
5. Count bytes while streaming.
6. Compute SHA-256 while streaming if cheap enough for v1.
7. Check quota before finalizing.
8. If quota would be exceeded, delete temp file and reject.
9. Insert file metadata in SQLite.
10. Move temp file to final storage path.
11. Increment `user_storage_usage.used_bytes`.
12. Return file metadata.

Do not buffer full uploads in memory.

## Quota Plan

Each user gets:

```text
100GB = 107374182400 bytes
```

Rules:

- Enforce quota on the backend.
- Show quota in the frontend.
- Uploads must fail if `used_bytes + incoming_file_size > quota_bytes`.
- Deleting files decrements `used_bytes`.
- Rename and move operations do not affect quota.
- Folder deletion should subtract all nested file sizes when recursively deleting.

Frontend display:

```text
x GB / 100 GB
```

## File Type Policy

### Allowed For Viewing

```text
image/*
video/*
application/pdf
text/plain
text/markdown
text/csv
application/json
application/xml
text/html
text/css
```

### Explicitly Excluded

```text
.doc
.docx
.ppt
.pptx
.xls
.xlsx
.odt
.pages
.key
```

PDFs are allowed and should be viewed with an iframe.

Use both extension and MIME checks. Browser-provided MIME values are useful but not fully trustworthy.

## Viewing Plan

Frontend viewer behavior:

- `image/*`: render with `<img>`
- `video/*`: render with `<video controls playsInline>`
- `application/pdf`: render with `<iframe>`
- supported text: fetch `/api/files/:fileId/text` and render in `<pre>`

PDF viewer example:

```tsx
<iframe
  src={previewUrl}
  title={file.name}
  className="h-[70vh] w-full rounded-[24px] border-0"
/>
```

Backend headers for inline viewing:

```text
Content-Type: application/pdf
Content-Disposition: inline; filename="example.pdf"
```

Videos should continue supporting byte ranges:

```text
Accept-Ranges: bytes
Content-Range: bytes start-end/total
```

## Download Plan

Make file downloading work through a dedicated authorized endpoint.

Endpoint:

```text
GET /api/files/:fileId/download
```

Backend behavior:

- Authenticate user.
- Confirm file belongs to user.
- Resolve storage path safely.
- Stream file from disk.
- Set download headers.

Headers:

```text
Content-Type: <file mime type>
Content-Length: <file size>
Content-Disposition: attachment; filename="safe-file-name.ext"
```

Frontend behavior:

- Download button calls the endpoint through the shared API layer.
- Use a blob response.
- Create an object URL.
- Trigger an `<a download>` click.
- Revoke the object URL after use.

## Frontend Plan

Reuse current frontend structure where practical.

Changes:

- Replace custom auth service with Better Auth client.
- Keep TanStack Query for server data.
- Keep Zustand for client UI state only.
- Add storage usage card.
- Add text viewer branch in `media-viewer.tsx`.
- Add PDF iframe viewer branch in `media-viewer.tsx`.
- Wire download actions to `/api/files/:fileId/download`.
- Remove document/archive assumptions that conflict with the allowlist.
- Show blocked file errors before upload where possible.

## Backend Implementation Phases

1. Replace package dependencies.
2. Add SQLite database plugin.
3. Add migration/bootstrap path.
4. Integrate Better Auth.
5. Replace custom auth pre-handler with Better Auth session lookup.
6. Replace Postgres library service with SQLite library service.
7. Add quota service logic.
8. Add file type allowlist/blocklist utilities.
9. Add `/api/files/:fileId/download`.
10. Add `/api/files/:fileId/text`.
11. Keep `/api/files/:fileId/content` for inline media/PDF viewing.
12. Update tests to run against SQLite.

## Frontend Implementation Phases

1. Replace auth service/hooks with Better Auth client integration.
2. Update session bootstrap flow.
3. Add storage usage query.
4. Add storage usage display.
5. Update media kind inference to include `pdf` and `text`.
6. Add PDF iframe rendering.
7. Add text rendering.
8. Wire download button to real backend download route.
9. Add upload validation messages for excluded file types.

## Verification Plan

Backend:

```text
pnpm install
pnpm typecheck
pnpm test
```

Frontend:

```text
pnpm install
pnpm build
```

Manual smoke flow:

```text
login
create folder
upload image
upload video
upload pdf
upload text file
preview image
preview video
preview pdf in iframe
preview text file
download each file
delete file
confirm quota updates
move file
rename file
create nested folder
delete nested folder
```

## Migration Notes From Original HomeServer

The original project is more than a scaffold. It already contains a large chunk of the needed product, but its contract differs from this version.

Important changes from original:

- Postgres becomes SQLite.
- Custom auth becomes Better Auth.
- Access/refresh token handling becomes Better Auth session handling.
- Quota becomes a first-class product feature.
- PDFs become explicitly viewable through iframe.
- File downloads become a dedicated required route.
- Office documents and presentation files stay excluded.

## Implementation Bias

Keep this version boring and lightweight.

Prefer:

- Direct SQLite queries over heavy ORM abstractions
- Small Fastify plugins over large framework layers
- Simple file streaming over background processing
- Server-side quota enforcement over UI-only checks
- Stable ID-based storage paths over user-name-based paths
- Existing frontend components over redesigning the app
