import multer from "multer";
import os from "os";
import path from "path";
import fs from "fs";
import crypto from "crypto";

// Uploads are staged on disk, never held in the Node heap.
//
// This used to use multer.memoryStorage(), which buffers the entire file in
// memory before it is forwarded on. With a 200 MB video limit, two concurrent
// hero-video uploads meant 400 MB of heap on top of everything else, and a small
// container would be OOM-killed — taking the whole API down, not just the upload.
// The quote uploader allowed 5 x 10 MB per request, and any logged-in customer
// could trigger that one.
//
// With disk staging, memory stays flat regardless of file size: multer streams to
// a temp file, and supabaseStorage streams that file straight out to object
// storage via fs.openAsBlob without ever reading it fully into a Buffer.
//
// Every staged file MUST be cleaned up — see cleanupStagedFiles below, which the
// upload routes call on both the success and failure paths.
const stagingDir = path.join(os.tmpdir(), "gsc-uploads");
fs.mkdirSync(stagingDir, { recursive: true });

function createUploader(limits) {
  return multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, stagingDir),
      filename: (req, file, cb) => {
        // The client's filename is never used on disk — it is attacker-controlled
        // and could contain path separators or traversal sequences. The real
        // extension is derived from the file's bytes later, in supabaseStorage.
        cb(null, `${crypto.randomUUID()}.upload`);
      },
    }),
    limits,
  });
}

// No fileFilter here on purpose. Extension-based filtering gave a false sense of
// safety — "payload.html" renamed to "photo.png" passed it every time. Type
// enforcement now happens in supabaseStorage against the file's actual leading
// bytes, where it cannot be talked out of by a filename.
export const quoteUpload = createUploader({
  fileSize: 10 * 1024 * 1024,
  files: 5,
});

export const productImageUpload = createUploader({
  fileSize: 5 * 1024 * 1024,
  files: 10,
});

export const galleryImageUpload = createUploader({
  fileSize: 5 * 1024 * 1024,
  files: 1,
});

export const videoUpload = createUploader({
  fileSize: 200 * 1024 * 1024,
  files: 1,
});

/**
 * Runs a multer middleware and turns its failures into a clean 400.
 *
 * Multer can fail *after* it has already written bytes to disk — a file that
 * exceeds the size limit is the common case. The controller never runs in that
 * situation, so its finally-block cleanup never fires and the partial temp file
 * would be left behind forever. This cleans up on the failure path too.
 */
export function handleUpload(multerMiddleware) {
  return (req, res, next) => {
    multerMiddleware(req, res, async (err) => {
      if (err) {
        await cleanupStagedFiles(req);
        return res
          .status(400)
          .json({ error: err.message || "File upload failed" });
      }
      next();
    });
  };
}

// Deletes whatever multer staged for this request. Safe to call more than once
// and safe to call when nothing was staged. Never throws: a cleanup failure must
// not turn a successful upload into a failed request, so it only logs.
export async function cleanupStagedFiles(req) {
  const staged = [
    ...(Array.isArray(req?.files) ? req.files : []),
    ...(req?.file ? [req.file] : []),
  ];

  await Promise.all(
    staged.map(async (file: any) => {
      if (!file?.path) return;
      try {
        await fs.promises.unlink(file.path);
      } catch (err: any) {
        if (err?.code !== "ENOENT") {
          console.error("Failed to remove staged upload:", file.path, err);
        }
      }
    }),
  );
}
