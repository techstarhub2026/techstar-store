import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { prisma } from './prisma.js';
import { newUlid, sha256 } from './util.js';
import { UnsupportedMediaTypeError } from './errors.js';

/**
 * Local-disk media store.
 *
 * Accepted types are determined by magic bytes, not by the client's
 * Content-Type header or the file extension (spec §11.7). Files are stored
 * under a generated ULID; the uploader's filename is kept as metadata only and
 * never used as a path component.
 *
 * Derivative generation (sm/md/lg) is deliberately not implemented here — the
 * three URLs point at the same stored original. Adding `sharp` and writing real
 * derivatives is a drop-in change behind this module; nothing outside it knows.
 */

const SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'image/jpeg',
    ext: 'jpg',
    test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mime: 'image/png',
    ext: 'png',
    test: (b) =>
      b.length > 8 &&
      b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 &&
      b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a,
  },
  {
    mime: 'image/webp',
    ext: 'webp',
    test: (b) =>
      b.length > 12 &&
      b.subarray(0, 4).toString('ascii') === 'RIFF' &&
      b.subarray(8, 12).toString('ascii') === 'WEBP',
  },
  {
    mime: 'image/avif',
    ext: 'avif',
    test: (b) =>
      b.length > 12 &&
      b.subarray(4, 8).toString('ascii') === 'ftyp' &&
      /avif|avis/.test(b.subarray(8, 12).toString('ascii')),
  },
  {
    mime: 'image/gif',
    ext: 'gif',
    test: (b) => b.length > 6 && b.subarray(0, 6).toString('ascii').startsWith('GIF8'),
  },
];

export function detectImageType(buffer: Buffer) {
  const hit = SIGNATURES.find((s) => s.test(buffer));
  if (!hit) {
    throw new UnsupportedMediaTypeError(
      'Only JPEG, PNG, WebP, AVIF and GIF images are accepted.',
    );
  }
  return hit;
}

const DOCUMENT_SIGNATURES: { mime: string; ext: string; test: (b: Buffer) => boolean }[] = [
  {
    mime: 'application/pdf',
    ext: 'pdf',
    test: (b) => b.length > 4 && b.subarray(0, 4).toString('ascii') === '%PDF',
  },
];

export function detectDocumentType(buffer: Buffer) {
  const hit = DOCUMENT_SIGNATURES.find((s) => s.test(buffer));
  if (!hit) {
    throw new UnsupportedMediaTypeError('Only PDF documents are accepted.');
  }
  return hit;
}

/** Best-effort intrinsic dimensions, used to reserve layout space in the UI. */
export function readDimensions(buffer: Buffer, mime: string): { width?: number; height?: number } {
  try {
    if (mime === 'image/png') {
      return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
    }
    if (mime === 'image/jpeg') {
      let i = 2;
      while (i < buffer.length - 9) {
        if (buffer[i] !== 0xff) { i += 1; continue; }
        const marker = buffer[i + 1];
        const len = buffer.readUInt16BE(i + 2);
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
        }
        i += 2 + len;
      }
    }
  } catch {
    /* dimensions are advisory */
  }
  return {};
}

function shard(id: string) {
  return path.join(id.slice(0, 2), id.slice(2, 4));
}

export interface StoredMedia {
  id: number;
  publicId: string;
  sm: string;
  md: string;
  lg: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}

export function toMediaDto(m: {
  id: number;
  publicId: string;
  urlSm: string;
  urlMd: string;
  urlLg: string;
  width: number | null;
  height: number | null;
  altText: string | null;
}): StoredMedia {
  return {
    id: m.id,
    publicId: m.publicId,
    sm: m.urlSm,
    md: m.urlMd,
    lg: m.urlLg,
    width: m.width,
    height: m.height,
    altText: m.altText,
  };
}

type StoreOpts = { originalFilename?: string; altText?: string; uploadedById?: number | null };

/**
 * Persists an uploaded buffer under a detected {mime, ext} and returns its
 * MediaFile row. Identical uploads are deduplicated by checksum so
 * re-uploading the same file does not grow the store.
 */
async function persist(
  buffer: Buffer,
  kind: { mime: string; ext: string },
  opts: StoreOpts,
) {
  const checksum = sha256(buffer.toString('binary'));
  const digest = crypto.createHash('sha256').update(buffer).digest('hex');

  const existing = await prisma.mediaFile.findFirst({
    where: { checksumSha256: digest, deletedAt: null },
  });
  if (existing) return existing;

  const publicId = newUlid();
  const dir = path.join(config.mediaRoot, shard(publicId));
  await fs.mkdir(dir, { recursive: true });

  const filename = `${publicId}.${kind.ext}`;
  const relKey = path.posix.join(shard(publicId).replace(/\\/g, '/'), filename);
  await fs.writeFile(path.join(dir, filename), buffer);

  const url = `${config.MEDIA_PUBLIC_URL.replace(/\/$/, '')}/${relKey}`;
  const dims = readDimensions(buffer, kind.mime);

  return prisma.mediaFile.create({
    data: {
      publicId,
      storageDriver: 'local',
      storageKey: relKey,
      originalFilename: (opts.originalFilename ?? '').slice(0, 255),
      mimeType: kind.mime,
      byteSize: buffer.length,
      width: dims.width ?? null,
      height: dims.height ?? null,
      checksumSha256: digest || checksum,
      urlSm: url,
      urlMd: url,
      urlLg: url,
      altText: opts.altText?.slice(0, 255) ?? null,
      uploadedById: opts.uploadedById ?? null,
      referenceCount: 0,
    },
  });
}

export async function storeImage(buffer: Buffer, opts: StoreOpts = {}) {
  return persist(buffer, detectImageType(buffer), opts);
}

export async function storeDocument(buffer: Buffer, opts: StoreOpts = {}) {
  return persist(buffer, detectDocumentType(buffer), opts);
}

/**
 * Accepts either an image or a PDF — the media library and every uploader in
 * the admin (product photos, spec sheets) share this one entry point so
 * there is a single place that decides what a file "is".
 */
export async function storeUpload(buffer: Buffer, opts: StoreOpts = {}) {
  try {
    return await storeImage(buffer, opts);
  } catch {
    try {
      return await storeDocument(buffer, opts);
    } catch {
      throw new UnsupportedMediaTypeError(
        'Only JPEG, PNG, WebP, AVIF, GIF images or PDF documents are accepted.',
      );
    }
  }
}

export async function ensureMediaRoot() {
  await fs.mkdir(config.mediaRoot, { recursive: true });
}
