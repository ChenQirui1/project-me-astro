/** Content types for the asset kinds this site actually stores in R2. */
const TYPES = {
  ".apng": "image/apng",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webm": "video/webm",
  ".webp": "image/webp",
};

export function contentTypeFor(filename) {
  const dot = filename.lastIndexOf(".");
  if (dot === -1) return "application/octet-stream";
  return TYPES[filename.slice(dot).toLowerCase()] ?? "application/octet-stream";
}
