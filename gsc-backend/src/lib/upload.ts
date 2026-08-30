import multer from "multer";

function createUploader(allowedExtensions, limits) {
  return multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
      const ext = "." + file.originalname.split(".").pop().toLowerCase();
      if (!allowedExtensions.includes(ext)) {
        return cb(new Error(`Unsupported file type: ${ext}`));
      }
      cb(null, true);
    },
    limits,
  });
}

export const quoteUpload = createUploader(
  [".jpg", ".jpeg", ".png", ".pdf", ".dwg", ".dxf", ".step", ".stp"],
  { fileSize: 10 * 1024 * 1024, files: 5 },
);

export const productImageUpload = createUploader(
  [".jpg", ".jpeg", ".png", ".webp"],
  { fileSize: 5 * 1024 * 1024, files: 10 },
);

export const galleryImageUpload = createUploader(
  [".jpg", ".jpeg", ".png", ".webp"],
  { fileSize: 5 * 1024 * 1024, files: 1 },
);

export const videoUpload = createUploader([".mp4", ".mov", ".webm", ".avi"], {
  fileSize: 200 * 1024 * 1024,
  files: 1,
});
