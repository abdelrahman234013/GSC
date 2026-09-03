// Content-sniffing allowlist for uploads.
//
// A filename extension and a Content-Type header are both supplied by whoever is
// uploading, so neither can be trusted to say what a file actually is. The attack
// that matters: upload bytes that are really HTML, call the file "photo.png",
// declare it as "text/html", and object storage will happily serve it back as a
// live page on your storage domain — a stored XSS with your own origin behind it.
//
// So the bytes decide. We read the leading bytes, match them against this fixed
// table, and derive BOTH the stored extension and the Content-Type from whatever
// we recognise. Anything unrecognised is rejected rather than stored with a
// guessed type.
//
// Note this is an allowlist of container formats, not a guarantee the file is
// harmless — a polyglot can be a valid PNG and valid HTML at once. What makes
// that harmless is the second half of the defence in supabaseStorage.ts: the
// Content-Type is always one we chose, and non-image types are served as
// attachments, so the browser never renders an upload as a document.

export type DetectedType = {
  ext: string;
  mime: string;
  kind: "image" | "video" | "document" | "cad";
};

function startsWith(buf: Buffer, bytes: number[], offset = 0): boolean {
  if (buf.length < offset + bytes.length) return false;
  return bytes.every((b, i) => buf[offset + i] === b);
}

function asciiAt(buf: Buffer, text: string, offset = 0): boolean {
  return startsWith(buf, [...Buffer.from(text, "ascii")], offset);
}

// ASCII CAD formats (DXF, STEP) have no binary magic number, so they're matched
// on their documented leading tokens instead. Both are plain text, so we also
// require the head of the file to look like text rather than arbitrary binary.
function looksLikeText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 512));
  for (const byte of sample) {
    // Allow tab, LF, CR, and printable ASCII. NUL or control bytes mean binary.
    const printable =
      byte === 0x09 || byte === 0x0a || byte === 0x0d || (byte >= 0x20 && byte <= 0x7e);
    if (!printable) return false;
  }
  return true;
}

export function detectFileType(buf: Buffer): DetectedType | null {
  // --- images ---
  if (startsWith(buf, [0xff, 0xd8, 0xff])) {
    return { ext: ".jpg", mime: "image/jpeg", kind: "image" };
  }
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return { ext: ".png", mime: "image/png", kind: "image" };
  }
  if (asciiAt(buf, "RIFF") && asciiAt(buf, "WEBP", 8)) {
    return { ext: ".webp", mime: "image/webp", kind: "image" };
  }

  // --- documents ---
  if (asciiAt(buf, "%PDF-")) {
    return { ext: ".pdf", mime: "application/pdf", kind: "document" };
  }

  // --- video ---
  // ISO base media (MP4/MOV) put a 4-byte size first, then "ftyp", then a brand.
  if (asciiAt(buf, "ftyp", 4)) {
    const brand = buf.subarray(8, 12).toString("ascii");
    if (brand.startsWith("qt")) {
      return { ext: ".mov", mime: "video/quicktime", kind: "video" };
    }
    return { ext: ".mp4", mime: "video/mp4", kind: "video" };
  }
  if (startsWith(buf, [0x1a, 0x45, 0xdf, 0xa3])) {
    // EBML — WebM and Matroska share it; we only advertise WebM.
    return { ext: ".webm", mime: "video/webm", kind: "video" };
  }
  if (asciiAt(buf, "RIFF") && asciiAt(buf, "AVI ", 8)) {
    return { ext: ".avi", mime: "video/x-msvideo", kind: "video" };
  }

  // --- CAD ---
  // DWG version tag, e.g. AC1015 / AC1018 / AC1027 / AC1032.
  if (asciiAt(buf, "AC10") || asciiAt(buf, "AC1.")) {
    return { ext: ".dwg", mime: "application/acad", kind: "cad" };
  }
  // Binary DXF has an explicit sentinel; ASCII DXF opens with group code 0
  // followed by SECTION.
  if (asciiAt(buf, "AutoCAD Binary DXF")) {
    return { ext: ".dxf", mime: "image/vnd.dxf", kind: "cad" };
  }
  if (looksLikeText(buf)) {
    const head = buf.subarray(0, 512).toString("ascii");
    if (/^[\s]*0[\r\n]+\s*SECTION/.test(head)) {
      return { ext: ".dxf", mime: "image/vnd.dxf", kind: "cad" };
    }
    if (/^[\s]*ISO-10303-21\s*;/.test(head)) {
      return { ext: ".step", mime: "application/step", kind: "cad" };
    }
  }

  return null;
}

// How many leading bytes detectFileType needs. Everything above matches within
// the first 512 bytes; reading a little extra costs nothing and leaves room.
export const DETECTION_HEAD_BYTES = 1024;

export const IMAGE_TYPES = [".jpg", ".png", ".webp"];
export const VIDEO_TYPES = [".mp4", ".mov", ".webm", ".avi"];
export const QUOTE_ATTACHMENT_TYPES = [
  ".jpg",
  ".png",
  ".pdf",
  ".dwg",
  ".dxf",
  ".step",
];
