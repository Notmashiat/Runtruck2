import { documentStorageKey as seedStorageKey } from '@runtruck/database/seed';
import { describe, expect, it } from 'vitest';
import { sanitizeFileName } from '../file-name.js';
import { detectDocumentMimeType } from '../file-type.js';
import { documentStorageKey } from '../storage-key.js';

const bytes = (...parts: (string | number[])[]) => Buffer.concat(parts.map((p) => (typeof p === 'string' ? Buffer.from(p, 'latin1') : Buffer.from(p))));

function bmp(size: number, dibHeader = 40, declared = size): Buffer {
  const b = Buffer.alloc(size);
  b.write('BM', 0, 'latin1');
  b.writeUInt32LE(declared, 2);
  b.writeUInt32LE(54, 10);
  b.writeUInt32LE(dibHeader, 14);
  return b;
}

function ftyp(major: string, compatible: string[] = []): Buffer {
  const size = 16 + compatible.length * 4;
  const b = Buffer.alloc(size + 8);
  b.writeUInt32BE(size, 0);
  b.write('ftyp', 4, 'latin1');
  b.write(major, 8, 'latin1');
  compatible.forEach((c, i) => b.write(c, 16 + i * 4, 'latin1'));
  return b;
}

describe('detectDocumentMimeType (13 §4.2)', () => {
  it('recognizes every allowed signature', () => {
    expect(detectDocumentMimeType(bytes('%PDF-1.7\n…'))).toBe('application/pdf');
    expect(detectDocumentMimeType(bytes([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe('image/jpeg');
    expect(detectDocumentMimeType(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe('image/png');
    expect(detectDocumentMimeType(bytes('GIF87a…'))).toBe('image/gif');
    expect(detectDocumentMimeType(bytes('GIF89a…'))).toBe('image/gif');
    expect(detectDocumentMimeType(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('image/webp');
    expect(detectDocumentMimeType(bytes([0x49, 0x49, 0x2a, 0x00, 8]))).toBe('image/tiff');
    expect(detectDocumentMimeType(bytes([0x4d, 0x4d, 0x00, 0x2a, 0]))).toBe('image/tiff');
    expect(detectDocumentMimeType(bmp(70))).toBe('image/bmp');
    expect(detectDocumentMimeType(bmp(26, 12))).toBe('image/bmp');
    expect(detectDocumentMimeType(ftyp('heic'))).toBe('image/heic');
    expect(detectDocumentMimeType(ftyp('hevx'))).toBe('image/heic');
    expect(detectDocumentMimeType(ftyp('mif1'))).toBe('image/heif');
    expect(detectDocumentMimeType(ftyp('avif'))).toBe('image/avif');
    expect(detectDocumentMimeType(ftyp('isom', ['mp41', 'avis']))).toBe('image/avif');
  });

  it('refuses a two-byte "BM" match without a valid header', () => {
    expect(detectDocumentMimeType(bytes('BM<html><script>alert(1)</script></html>'))).toBeNull();
    expect(detectDocumentMimeType(bmp(70, 40, 71))).toBeNull();
    expect(detectDocumentMimeType(bmp(70, 41))).toBeNull();
    expect(detectDocumentMimeType(bmp(25, 40))).toBeNull();
  });

  it('refuses SVG, HTML, archives, video and empty files', () => {
    expect(detectDocumentMimeType(bytes('<svg xmlns="http://www.w3.org/2000/svg"><script/></svg>'))).toBeNull();
    expect(detectDocumentMimeType(bytes('<?xml version="1.0"?><svg/>'))).toBeNull();
    expect(detectDocumentMimeType(bytes('<!DOCTYPE html><html></html>'))).toBeNull();
    expect(detectDocumentMimeType(bytes('PK', [3, 4]))).toBeNull();
    expect(detectDocumentMimeType(ftyp('isom', ['mp41']))).toBeNull();
    expect(detectDocumentMimeType(Buffer.alloc(0))).toBeNull();
  });
});

describe('sanitizeFileName (13 §4.3)', () => {
  it('drops the path, control characters and quotes, and trims', () => {
    expect(sanitizeFileName('C:\\scans\\rate-con-40223.pdf')).toBe('rate-con-40223.pdf');
    expect(sanitizeFileName('../../etc/passwd')).toBe('passwd');
    expect(sanitizeFileName('  bol\u0000\r\n"x".pdf  ')).toBe('bolx.pdf');
  });

  it('normalizes to NFC and cuts to 255 characters without splitting a pair', () => {
    expect(sanitizeFileName('cafe\u0301.pdf')).toBe('café.pdf');
    expect(sanitizeFileName('a'.repeat(300))).toHaveLength(255);
    const emoji = sanitizeFileName('😀'.repeat(200));
    expect(emoji.length).toBeLessThanOrEqual(255);
    expect(emoji).toBe('😀'.repeat(127));
  });

  it('falls back to "document"', () => {
    expect(sanitizeFileName('')).toBe('document');
    expect(sanitizeFileName('dir/')).toBe('document');
    expect(sanitizeFileName(undefined)).toBe('document');
    expect(sanitizeFileName('"\u0007"')).toBe('document');
  });
});

describe('documentStorageKey (13 §2)', () => {
  it('builds org/{org}/loads/{load}/documents/{version}, exactly as the seed does', () => {
    const [org, load, version] = ['7c1d0a52-0000-4000-8000-000000000001', '7c1d0a52-0000-4000-8000-000000000002', '7c1d0a52-0000-4000-8000-000000000003'];
    expect(documentStorageKey(org, load, version)).toBe(`org/${org}/loads/${load}/documents/${version}`);
    expect(documentStorageKey(org, load, version)).toBe(seedStorageKey(org, load, version));
  });
});
