import type { LoadDocumentMimeType } from '@runtruck/types';

// The upload type allowlist (docs/13-document-system.md §4.2, a security rule). The type
// is decided from the file's leading bytes only; the client's Content-Type and file name
// are ignored. Anything that is not a PDF or an allowed raster image — SVG, HTML,
// archives, executables — returns null and is refused with DOCUMENT_FILE_TYPE_NOT_ALLOWED.

const startsWith = (bytes: Buffer, signature: readonly number[], offset = 0): boolean =>
  bytes.length >= offset + signature.length && signature.every((b, i) => bytes[offset + i] === b);

const ascii = (text: string): number[] => Array.from(Buffer.from(text, 'latin1'));

// DIB header sizes of the BMP variants (BITMAPCOREHEADER … BITMAPV5HEADER).
const BMP_DIB_HEADER_SIZES = new Set([12, 40, 52, 56, 108, 124]);

// A BMP only with a well-formed header: at least 26 bytes, the little-endian file size at
// bytes 2–5 equal to the upload's size, and a known DIB header size at bytes 14–17. A file
// that merely starts with "BM" (e.g. "BM<html><script>…") is refused.
function isBmp(bytes: Buffer): boolean {
  if (bytes.length < 26 || !startsWith(bytes, ascii('BM'))) return false;
  return bytes.readUInt32LE(2) === bytes.length && BMP_DIB_HEADER_SIZES.has(bytes.readUInt32LE(14));
}

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx']);
const HEIF_BRANDS = new Set(['mif1', 'msf1']);
const AVIF_BRANDS = new Set(['avif', 'avis']);

function brandType(brand: string): LoadDocumentMimeType | null {
  if (HEIC_BRANDS.has(brand)) return 'image/heic';
  if (HEIF_BRANDS.has(brand)) return 'image/heif';
  if (AVIF_BRANDS.has(brand)) return 'image/avif';
  return null;
}

// ISO-BMFF: an `ftyp` box first; its major brand decides, else the first known compatible brand.
function isoBmffType(bytes: Buffer): LoadDocumentMimeType | null {
  if (bytes.length < 12 || bytes.toString('latin1', 4, 8) !== 'ftyp') return null;
  const major = brandType(bytes.toString('latin1', 8, 12));
  if (major) return major;
  const boxEnd = Math.min(bytes.readUInt32BE(0), bytes.length);
  for (let at = 16; at + 4 <= boxEnd; at += 4) {
    const compatible = brandType(bytes.toString('latin1', at, at + 4));
    if (compatible) return compatible;
  }
  return null;
}

export function detectDocumentMimeType(bytes: Buffer): LoadDocumentMimeType | null {
  if (bytes.length === 0) return null;
  if (startsWith(bytes, ascii('%PDF-'))) return 'application/pdf';
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg';
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png';
  if (startsWith(bytes, ascii('GIF87a')) || startsWith(bytes, ascii('GIF89a'))) return 'image/gif';
  if (startsWith(bytes, ascii('RIFF')) && startsWith(bytes, ascii('WEBP'), 8)) return 'image/webp';
  if (startsWith(bytes, [0x49, 0x49, 0x2a, 0x00]) || startsWith(bytes, [0x4d, 0x4d, 0x00, 0x2a])) return 'image/tiff';
  if (isBmp(bytes)) return 'image/bmp';
  return isoBmffType(bytes);
}
