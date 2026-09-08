/**
 * iPhones have saved photos as HEIC by default since iOS 11 (2017), and it is
 * still, by a wide margin, the single most common reason an admin's "upload
 * from my device" silently fails: the server only recognises a file by its
 * actual magic bytes (spec §11.7) — JPEG, PNG, WebP, AVIF, GIF — and HEIC
 * matches none of them, so it is rejected outright. Worse, the browser's own
 * `accept` filter on the file input doesn't list HEIC either, so on some
 * mobile browsers the photo is never even selectable to begin with.
 *
 * There is no good server-side fix: HEIC's HEVC video codec is patent-
 * encumbered, so the prebuilt libvips/libheif binary sharp ships (and every
 * other Node image library) supports AVIF's codec but not HEIC's — adding
 * real HEIC decoding server-side means either an unlicensed/GPL codec build
 * (a real legal exposure for a production app) or a paid HEVC license.
 *
 * Converting client-side sidesteps the licensing question entirely — this
 * runs a WASM HEIF *decoder* (not an HEVC encoder) inside the visitor's own
 * browser, which is the same thing macOS/iOS Preview and every photo app on
 * the device already does locally, and produces a plain JPEG that the
 * existing upload pipeline needs no changes to accept.
 */
import heic2any from 'heic2any';

const HEIC_EXT = /\.hei[cf]$/i;

/** True for a file that is HEIC/HEIF by extension or (rarely, on some
 * Android browsers) by a MIME type the OS actually bothered to set. */
export function isHeic(file: File): boolean {
  return (
    file.type === 'image/heic' ||
    file.type === 'image/heif' ||
    HEIC_EXT.test(file.name)
  );
}

/**
 * Converts a single HEIC/HEIF file to a JPEG File with the same base name.
 * Quality is 0.92 rather than heic2any's own 0.92 default restated
 * explicitly — HEIC's compression is already efficient, so the source detail
 * is there to keep; this isn't being re-compressed from a lossy JPEG.
 */
export async function convertHeicToJpeg(file: File): Promise<File> {
  const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 });
  // heic2any returns Blob[] only when `multiple: true` is passed, which this
  // call never does — the array branch of its return type is unreachable
  // here, but TypeScript's declaration doesn't encode that.
  const blob = Array.isArray(result) ? result[0] : result;
  const name = file.name.replace(HEIC_EXT, '') + '.jpg';
  return new File([blob], name, { type: 'image/jpeg', lastModified: file.lastModified });
}

/**
 * Runs every HEIC/HEIF file in a list through conversion (in parallel;
 * non-HEIC files pass through untouched) and returns a same-shaped list, so
 * a caller can pass a `FileList`/`File[]` through this once, up front, before
 * any size or type validation runs — validation must see the JPEG's own
 * size, not the (usually smaller) HEIC original's, since HEIC compresses
 * appreciably better and a file just under the limit as HEIC can land over
 * it once re-encoded as JPEG.
 *
 * A file that fails to convert (a still-image HEIC sequence heic2any can't
 * handle, a corrupt file, etc.) is dropped from the result and reported via
 * `onError` rather than thrown — one bad photo in a multi-file drop should
 * not block the others from uploading.
 */
export async function convertHeicFiles(
  files: File[],
  onError?: (file: File, error: unknown) => void,
): Promise<File[]> {
  const converted = await Promise.all(
    files.map(async (f) => {
      if (!isHeic(f)) return f;
      try {
        return await convertHeicToJpeg(f);
      } catch (e) {
        onError?.(f, e);
        return null;
      }
    }),
  );
  return converted.filter((f): f is File => f !== null);
}
