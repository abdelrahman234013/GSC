import { StorageClient } from "@supabase/storage-js";
import crypto from "crypto";
import fs from "fs";
import { detectFileType, DETECTION_HEAD_BYTES } from "./fileTypes";

// Built on first use, not at import.
//
// Constructing it at module load meant reading SUPABASE_URL the moment this file
// was imported — and with the variable unset that becomes "undefined/storage/v1",
// which throws "Invalid URL" and takes the whole process down before it can
// serve anything. A developer without a Supabase project could not start the API
// at all, even to work on something unrelated.
//
// Deferring it means the app boots fine without storage configured, and only the
// endpoints that actually upload or serve files fail — with a message naming the
// missing variables instead of a URL parse error.
let cachedClient: StorageClient | null = null;

function storage(): StorageClient {
  if (cachedClient) return cachedClient;

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase storage is not configured: set SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY. File uploads and downloads are unavailable.",
    );
  }

  cachedClient = new StorageClient(`${url}/storage/v1`, {
    apikey: key,
    Authorization: `Bearer ${key}`,
  });
  return cachedClient;
}

// Buckets holding customer-submitted files are PRIVATE: their contents are only
// reachable through a short-lived signed URL minted by this server, after the
// request has been authorised. Everything else is public site content.
//
// IMPORTANT — the private flag must also be set on the bucket itself in the
// Supabase dashboard. Code alone cannot make a public bucket private; if the
// bucket is left public, its objects stay readable by anyone who has the URL
// regardless of what this file does.
export const PRIVATE_BUCKETS = ["quote-files"];

export function isPrivateBucket(bucket: string): boolean {
  return PRIVATE_BUCKETS.includes(bucket);
}

const SIGNED_URL_TTL_SECONDS = 300; // 5 minutes — long enough to click, short enough not to leak

class UploadError extends Error {
  status = 400;
}

async function readHead(filePath: string, bytes: number): Promise<Buffer> {
  const handle = await fs.promises.open(filePath, "r");
  try {
    const buf = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buf, 0, bytes, 0);
    return buf.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}

/**
 * Uploads one multer-staged file to a bucket.
 *
 * `file` is a disk-staged multer file (it has .path, not .buffer). The bytes are
 * streamed from disk straight to storage, so memory use is flat no matter how
 * large the file is.
 *
 * The stored object's extension and Content-Type both come from sniffing the
 * file's actual leading bytes — never from file.originalname or file.mimetype,
 * which the client controls and can lie about. `allowedExtensions` is checked
 * against the *detected* type, so renaming an HTML payload to .png doesn't help.
 */
export async function uploadToSupabase(
  bucket: string,
  file: any,
  allowedExtensions?: string[],
) {
  const head = await readHead(file.path, DETECTION_HEAD_BYTES);
  const detected = detectFileType(head);

  if (!detected) {
    throw new UploadError(
      `"${file.originalname}" is not a file type we recognise. Please upload a supported format.`,
    );
  }
  if (allowedExtensions && !allowedExtensions.includes(detected.ext)) {
    throw new UploadError(
      `"${file.originalname}" is a ${detected.ext.slice(1).toUpperCase()} file, which isn't accepted here.`,
    );
  }

  const objectPath = `${crypto.randomUUID()}${detected.ext}`;

  // openAsBlob hands storage-js a lazily-read, file-backed Blob, so the upload
  // streams from disk instead of loading the whole file into the heap.
  const body = await fs.openAsBlob(file.path);

  const { error } = await storage().from(bucket).upload(objectPath, body, {
    // Server-derived, never file.mimetype. This is what stops a file whose bytes
    // are HTML from ever being served back as text/html.
    contentType: detected.mime,
    upsert: false,
  });

  if (error) {
    throw new Error(`Failed to upload file to Supabase: ${error.message}`);
  }

  if (isPrivateBucket(bucket)) {
    // Private buckets have no usable public URL. Persist the object path and mint
    // a signed URL at read time, once the caller has been authorised.
    return { url: objectPath, originalName: file.originalname };
  }

  const { data } = storage().from(bucket).getPublicUrl(objectPath);
  return { url: data.publicUrl, originalName: file.originalname };
}

/**
 * Mints a short-lived signed URL for one object in a private bucket.
 *
 * `download` forces a Content-Disposition: attachment response, so the browser
 * saves the file rather than rendering it. That's the belt to the content-type
 * braces: even a polyglot that is simultaneously valid PNG and valid HTML cannot
 * execute as a document when it arrives as an attachment.
 */
export async function createSignedDownloadUrl(
  bucket: string,
  objectPath: string,
  downloadName?: string,
) {
  const { data, error } = await storage()
    .from(bucket)
    .createSignedUrl(objectPath, SIGNED_URL_TTL_SECONDS, {
      download: downloadName || true,
    });

  if (error || !data) {
    console.error(
      `Failed to sign URL for ${bucket}/${objectPath}:`,
      error?.message,
    );
    return null;
  }
  return data.signedUrl;
}

/**
 * Recovers the object's path inside its bucket from whatever we stored.
 *
 * Public buckets store a full public URL; private ones store the bare object
 * path. Deleting needs the path either way.
 */
export function objectPathFor(bucket: string, urlOrPath: string): string | null {
  if (typeof urlOrPath !== "string" || urlOrPath.length === 0) return null;

  // Private bucket: already a path.
  if (!/^https?:\/\//i.test(urlOrPath)) return urlOrPath;

  const marker = `/object/public/${bucket}/`;
  const idx = urlOrPath.indexOf(marker);
  if (idx === -1) return null;

  return decodeURIComponent(
    urlOrPath.slice(idx + marker.length).split("?")[0],
  );
}

/**
 * Deletes stored objects. Best-effort: never throws.
 *
 * Storage was previously never cleaned up — deleting a product, gallery image or
 * video removed the database row and left the file behind forever, so the bill
 * grew with every edit and nothing ever reclaimed the space.
 *
 * Deliberately non-fatal. These are always called AFTER the database row is
 * gone, and the caller's intent (delete this thing) has already succeeded by
 * then. Failing the request at that point would report an error for an operation
 * that did happen, and leave the caller unsure what state they were in. A
 * leftover file is a cost problem; a confusing error is a correctness problem.
 */
export async function removeFromSupabase(
  bucket: string,
  urlsOrPaths: Array<string | null | undefined>,
): Promise<void> {
  const paths = urlsOrPaths
    .map((v) => (typeof v === "string" ? objectPathFor(bucket, v) : null))
    .filter((p): p is string => Boolean(p));

  if (paths.length === 0) return;

  try {
    const { error } = await storage().from(bucket).remove(paths);
    if (error) {
      console.error(
        `[storage] failed to remove ${paths.length} object(s) from ${bucket}:`,
        error.message,
      );
    }
  } catch (err) {
    console.error(`[storage] remove threw for bucket ${bucket}:`, err);
  }
}

/**
 * Swaps each quote attachment's stored value for a short-lived signed URL.
 *
 * Because "quote-files" is private, QuoteFile.url holds an object path rather
 * than a fetchable URL. Signing happens at read time, after the caller has been
 * authorised to see the quote — so a leaked response body goes stale in minutes
 * instead of granting permanent access to a customer's engineering drawings.
 *
 * Rows written before the bucket went private still hold a real public URL;
 * those pass through untouched so existing data keeps working.
 */
export async function signQuoteFiles(files) {
  if (!Array.isArray(files)) return files;

  return Promise.all(
    files.map(async (file) => {
      if (!file?.url || /^https?:\/\//i.test(file.url)) return file;
      return {
        ...file,
        url: await createSignedDownloadUrl(
          "quote-files",
          file.url,
          file.originalName || undefined,
        ),
      };
    }),
  );
}

export { UploadError };
