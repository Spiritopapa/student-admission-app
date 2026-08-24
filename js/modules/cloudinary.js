/**
 * Cloudinary Browser Helpers
 *
 * Handles EVERYTHING file-related that previously went to Supabase Storage:
 *   - Uploading student photos, school logos and teacher PDFs/documents.
 *   - Deleting old Cloudinary assets via the /api/cloudinary-delete proxy
 *     (the Admin API needs the API SECRET, which must stay server-side).
 *
 * Uploads use CLOUDINARY's UNSIGNED upload endpoint with a preset, so no API
 * secret is ever exposed to the browser. `resource_type=auto` means it handles
 * images (jpg, png, webp), PDFs and other documents with one call.
 *
 * The returned URL (data.secure_url) is stored in the existing Supabase TEXT
 * columns (student_photo_url / logo_url / photo_url / file_url) exactly like
 * the old Supabase Storage public URL, so every <img>/<a> in the app works
 * unchanged.
 */

import {
  CLOUDINARY_CLOUD_NAME,
  CLOUDINARY_UPLOAD_PRESET,
  CLOUDINARY_BASE_FOLDER,
  isCloudinaryReady,
} from '../cloudinary-config.js';

// ================================================================
// Config gate
// ================================================================

export { isCloudinaryReady };

// ================================================================
// Public ID helpers
// ================================================================

/** Keep a string safe to use inside a Cloudinary public id. */
function sanitizePublicId(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .slice(0, 90);
}

/**
 * Extract the Cloudinary public_id (including its extension) from a URL.
 * e.g. https://res.cloudinary.com/<cloud>/image/upload/v12345/online_v/abc.jpg
 *      → online_v/abc.jpg
 * Returns null when the URL is not a Cloudinary URL.
 */
export function getCloudinaryPublicIdFromUrl(fileUrl) {
  if (!fileUrl) return null;
  try {
    const { hostname, pathname } = new URL(fileUrl);
    if (!/cloudinary\.com$/i.test(hostname)) return null;

    const parts = pathname.split('/');
    const marker = parts.indexOf('upload');
    if (marker === -1 || marker >= parts.length - 1) return null;
    let rest = parts.slice(marker + 1).join('/');
    // Strip the optional auto version segment: /v1234567890/file.jpg
    rest = rest.replace(/^v\d+\//, '');
    return rest ? decodeURIComponent(rest) : null;
  } catch (e) {
    return null;
  }
}

/** Guess the Cloudinary resource type from a public id / file name. */
export function getCloudinaryResourceType(fileName) {
  return /\.(pdf|docx?|pptx?|xlsx?|txt|csv)$/i.test(fileName) ? 'raw' : 'image';
}

// ================================================================
// Upload
// ================================================================

/**
 * Upload a File (image or document) to Cloudinary.
 *
 * @param {File} file - the file picked from an <input type="file">.
 * @param {object} [options]
 * @param {string} [options.prefix='file'] - readable prefix for the public id.
 *   Every caller passes the owning USER / ENTITY id here (e.g. the student's
 *   STU-XXXXX or a teacher/school id), so the resulting file name in the
 *   Cloudinary folder always carries that id — making duplicate uploads for the
 *   same user easy to spot when deleting them manually.
 * @param {string} [options.folder=CLOUDINARY_BASE_FOLDER] - folder to place it in
 *   (best-effort; the unsigned preset may override with its own default folder).
 * @param {string} [options.resourceType='auto'] - image | raw | video | auto.
 * @returns {Promise<string|null>} the secure Cloudinary URL, or null on failure.
 */
export async function uploadToCloudinary(file, options = {}) {
  if (!file || !isCloudinaryReady()) return null;

  const { resourceType = 'auto' } = options;
  const prefix = sanitizePublicId(options.prefix || 'file');
  const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '');
  const baseName = (file.name.replace(/\.[a-z0-9]+$/i, '') || 'file')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40)
    .toLowerCase();
  const publicId = `${prefix}_${Date.now()}_${baseName}.${ext}`;
  const endpoint = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/${resourceType}/upload`;

  const send = async (
    folder /*: string|null */,
    includePublicId /*: boolean*/ = true,
    publicIdValue /*: string*/ = publicId
  ) => {
    const form = new FormData();
    form.append('file', file);
    form.append('upload_preset', CLOUDINARY_UPLOAD_PRESET);
    // Always try to keep the deterministic, user-id-bearing public id so the file
    // name in the Cloudinary Media Library can be traced back to its owner when
    // cleaning up duplicate uploads.
    if (includePublicId) form.append('public_id', publicIdValue);
    if (folder) form.append('folder', folder);
    const res = await fetch(endpoint, { method: 'POST', body: form });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.secure_url) {
      throw new Error(data?.error?.message || `Cloudinary HTTP ${res.status}`);
    }
    return data.secure_url || data.url;
  };

  const folder = options.folder || CLOUDINARY_BASE_FOLDER;
  try {
    // Attempt 1 — destination folder + user-id-tagged public id.
    return await send(folder, true);
  } catch (err) {
    const blocked =
      /preset|folder|public_id|unsigned|not allowed|forbidden|reject/i.test(err.message || '');
    if (blocked) {
      try {
        // Attempt 2 — some unsigned presets refuse a separate `folder` param but
        // still honor a `public_id`. Fold the folder INTO the public id and submit
        // WITHOUT the folder param, so we keep the user-id-tagged file name instead
        // of letting Cloudinary mint a random one. If the name carries a folder
        // already, Cloudinary keeps that path.
        const pathPublicId = folder ? `${folder}/${publicId}` : publicId;
        return await send(null, true, pathPublicId);
      } catch (err2) {
        // Attempt 3 (LAST resort) — an unsigned preset that forbids ANY public_id.
        // Cloudinary auto-generates a random id in its default folder. The name will
        // not contain the user id, but the upload still succeeds and deletion still
        // works because it resolves the public_id from the saved URL.
        try {
          return await send(null, false);
        } catch (err3) {
          console.warn('Cloudinary upload failed:', err3.message);
          return null;
        }
      }
    }
    console.warn('Cloudinary upload failed:', err.message);
    return null;
  }
}
// ================================================================
// Delete (via serverless proxy — API secret never reaches the browser)
// ================================================================

/**
 * Best-effort deletion of a Cloudinary asset by its URL (or public id).
 * Requires the Vercel serverless function /api/cloudinary-delete to be
 * deployed with CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY and
 * CLOUDINARY_API_SECRET configured. When the endpoint is missing (e.g. local
 * `npx serve`) the asset stays orphaned in Cloudinary — the database record is
 * still removed, so the app never breaks.
 *
 * @param {string} fileUrl - a Cloudinary https URL that came from a DB column.
 * @returns {Promise<boolean>} true when Cloudinary confirmed the asset is gone.
 */
export async function deleteCloudinaryFile(fileUrl) {
  const publicId = getCloudinaryPublicIdFromUrl(fileUrl);
  if (!publicId) return false;
  if (!isCloudinaryReady()) return false;

  try {
    const res = await fetch('/api/cloudinary-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        public_id: publicId,
        resource_type: getCloudinaryResourceType(publicId),
      }),
    });
    const raw = await res.text().catch(() => '');
    let data = {};
    try { data = raw ? JSON.parse(raw) : {}; }
    catch (e) { data = { __nonJson: true }; }
    if (!res.ok || !data.success) {
      // Non-JSON body usually means the request did NOT reach the serverless
      // function (e.g. the Vercel SPA fallback served index.html instead).
      // Surface that so it isn't mistaken for a Cloudinary rejection.
      if (data.__nonJson || /text\/html/i.test(res.headers?.get?.('content-type') || '')) {
        console.warn('Cloudinary-delete endpoint did not return JSON — is /api/cloudinary-delete deployed? Raw:', String(raw).slice(0, 120));
      }
      console.warn('Cloudinary delete not confirmed:', data?.error || `HTTP ${res.status}`);
      return false;
    }
    return true;
  } catch (err) {
    console.warn('Cloudinary delete unavailable (ignored — file left in Cloudinary):', err.message);
    return false;
  }
}