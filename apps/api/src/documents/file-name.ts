import { LOAD_DOCUMENT_MAX_FILE_NAME } from '@runtruck/validation';

// The stored file name (docs/13-document-system.md §4.3): display data only. The path is
// removed (last segment after / or \), control characters and `"` are dropped, the text is
// NFC-normalized, trimmed and cut to 255 characters; an empty result becomes "document".
// It never reaches the object key, a header or a file system path.

// eslint-disable-next-line no-control-regex -- stripping control characters is the point
const UNSAFE = /[\u0000-\u001f\u007f-\u009f"]/g;

export function sanitizeFileName(name: string | undefined | null): string {
  const lastSegment = (name ?? '').split(/[/\\]/).pop() ?? '';
  const cleaned = lastSegment.replace(UNSAFE, '').normalize('NFC').trim();
  // Cut at a code-point boundary so a surrogate pair is never split.
  let cut = '';
  for (const ch of cleaned) {
    if (cut.length + ch.length > LOAD_DOCUMENT_MAX_FILE_NAME) break;
    cut += ch;
  }
  cut = cut.trim();
  return cut === '' ? 'document' : cut;
}
