const VIEWABLE_MIME_TYPES = new Set([
  'image/',
  'video/',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/xml',
  'text/html',
  'text/css',
]);

const BLOCKED_EXTENSIONS = new Set([
  'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx',
  'odt', 'pages', 'key',
]);

export function isMimeTypeViewable(mimeType: string): boolean {
  for (const prefix of VIEWABLE_MIME_TYPES) {
    if (mimeType.startsWith(prefix)) {
      return true;
    }
  }

  return false;
}

export function isExtensionBlocked(extension: string): boolean {
  return BLOCKED_EXTENSIONS.has(extension.toLowerCase());
}

export function canViewInline(mimeType: string): boolean {
  return isMimeTypeViewable(mimeType);
}
