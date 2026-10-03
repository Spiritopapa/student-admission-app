import { supabase } from './supabase';
import { STORAGE_BUCKETS } from './constants';

// Cache of storage buckets we've already verified/created so the app skips the
// network round-trip for every single photo upload. If a bucket is ever
// removed server-side, uploadFile() detects the "Bucket not found" error and
// re-verifies once before giving up.
const knownBuckets = new Set(Object.values(STORAGE_BUCKETS));

export function publicUrl(bucket, path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

// Files are stored in the database as "<bucket>/<path>" (e.g.
// "student-photos/students/STU-1/abc.jpg"). getPublicUrl() expects the path
// WITHOUT the bucket, so split the two apart before building the URL.
export function stripBucketPrefix(value) {
  for (const bucket of Object.values(STORAGE_BUCKETS)) {
    if (value.startsWith(`${bucket}/`)) {
      return { bucket, path: value.slice(bucket.length + 1) };
    }
  }
  return null;
}

export function resolveFileUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  const match = stripBucketPrefix(url);
  if (match) return publicUrl(match.bucket, match.path);
  return url;
}

export function photoUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const match = stripBucketPrefix(path);
  if (match) return publicUrl(match.bucket, match.path);
  // Backwards compatibility: legacy bare paths (no bucket prefix) resolve in
  // the student-photos bucket just like the old helper did.
  return publicUrl(STORAGE_BUCKETS.studentPhotos, path);
}

export function fileExtension(name) {
  const dot = String(name || '').lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function randomPath(prefix, filename) {
  const ext = fileExtension(filename);
  const token = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  return ext ? `${prefix}/${token}.${ext}` : `${prefix}/${token}`;
}

/**
 * Verify a storage bucket is visible to the current session.
 *
 * IMPORTANT: storage.buckets RLS in some projects blocks authenticated users
 * from reading/creating buckets. Uploading to an EXISTING bucket does NOT need
 * bucket-level access (only the storage.object INSERT policy), so a hidden
 * bucket here never blocks uploadFile() - uploads are always attempted
 * directly.
 *
 * @param {string} bucket - bucket id, e.g. "student-photos"
 * @returns {Promise<{ exists: boolean | null, error?: string }>}
 *   exists: true  - the bucket is visible to this session
 *   exists: false - the API reported the bucket cannot be found/accessed
 *   exists: null  - indeterminate (storage.buckets RLS hid the row)
 */
export async function checkStorageBucket(bucket, { force = false } = {}) {
  if (!bucket) return { exists: false, error: 'No bucket specified.' };
  if (!force && knownBuckets.has(bucket)) return { exists: true };
  try {
    const { data, error } = await supabase.storage.getBucket(bucket);
    if (data) {
      knownBuckets.add(bucket);
      return { exists: true };
    }
    // No data AND no error usually means the row is hidden by storage.buckets
    // RLS. Leave the in-memory cache untouched and report "unknown" - uploading
    // still works and is attempted directly regardless.
    return { exists: error ? false : null, error: error?.message };
  } catch (err) {
    return { exists: false, error: err.message };
  }
}

/**
 * Best-effort creation of a missing bucket. Used ONLY as a fallback after an
 * upload reports "Bucket not found". Browser-side bucket creation requires the
 * project's storage.buckets RLS to allow authenticated INSERT - when it does
 * not, ok:false is returned and the caller surfaces the actionable migration.
 */
export async function ensureStorageBucket(bucket) {
  if (!bucket) return { ok: false, error: new Error('No storage bucket specified.') };
  if (knownBuckets.has(bucket)) return { ok: true, exists: true, created: false };

  try {
    const { data: existing } = await supabase.storage.getBucket(bucket);
    if (existing) {
      knownBuckets.add(bucket);
      return { ok: true, exists: true, created: false };
    }
    const { error } = await supabase.storage.createBucket(bucket, { public: true });
    if (error) {
      // The bucket may have just been created elsewhere; treat that as success.
      const again = await supabase.storage.getBucket(bucket);
      if (again.data) {
        knownBuckets.add(bucket);
        return { ok: true, exists: true, created: false };
      }
      return { ok: false, exists: false, error };
    }
    knownBuckets.add(bucket);
    return { ok: true, exists: true, created: true };
  } catch (err) {
    return { ok: false, exists: false, error: err };
  }
}

function uploadErrorMessage(error, bucket) {
  const msg = error?.message || String(error || '');
  if (/new row violates row-level security policy/i.test(msg)) {
    return (
      `Upload to "${bucket}" was blocked by the storage row-level security policy. ` +
      'Open the Supabase SQL Editor once and run "sql/073-supabase-storage-buckets.sql" ' +
      'so the "Authenticated users upload app files" policy on storage.objects is in place.'
    );
  }
  return msg;
}

/**
 * Upload a file to a storage bucket.
 *
 * Design: the upload is attempted FIRST. Writing to an existing bucket only
 * needs the storage.object INSERT policy - it does NOT require reading or
 * creating buckets, so a strict storage.buckets RLS configuration can never
 * block a legitimate upload. Bucket existence is only checked when the upload
 * itself reports "Bucket not found".
 */
export async function uploadFile(bucket, path, file) {
  if (!bucket) throw new Error('No storage bucket specified for the upload.');
  const upload = () =>
    supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });

  let result = await upload();

  // The bucket is genuinely missing (not merely hidden) - try to create it once.
  if (result.error && /bucket not found/i.test(result.error.message)) {
    knownBuckets.delete(bucket);
    const ensured = await ensureStorageBucket(bucket);
    if (ensured.ok) {
      result = await upload();
    } else {
      throw new Error(
        `Storage bucket "${bucket}" was not found in this project and could not be created automatically ` +
          `(${ensured.error?.message || 'permission denied - storage.buckets RLS blocks bucket creation'}). ` +
          'Open the Supabase SQL Editor once and run "sql/073-supabase-storage-buckets.sql" ' +
          'to create the file buckets (student-photos, applications, school-logos, documents).'
      );
    }
  }

  if (result.error) throw new Error(uploadErrorMessage(result.error, bucket));
  return `${bucket}/${result.data.path || path}`;
}

export async function deleteStoredFiles(entries) {
  const files = entries.filter(Boolean);
  if (!files.length) return;
  try {
    // The /api/storage-delete proxy verifies the caller via Bearer token, so
    // attach the current session's access token instead of being rejected 401.
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData?.session?.access_token || '';
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/storage-delete', {
      method: 'POST',
      headers,
      body: JSON.stringify({ files }),
    });
    const data = await res.json();
    if (!data.success) {
      console.warn('storage-delete proxy did not remove files:', data.error);
    }
  } catch (err) {
    console.warn('storage-delete proxy unreachable:', err.message);
  }
}

export function validateImageFile(file, maxMb = 0.5) {
  if (!file) return { valid: false, error: 'No file selected.' };
  if (!file.type.startsWith('image/')) {
    return { valid: false, error: 'This file is not an image.' };
  }
  if (file.size > maxMb * 1024 * 1024) {
    return {
      valid: false,
      error: `Photo exceeds ${maxMb} MB. Please choose a smaller image.`,
    };
  }
  return { valid: true };
}

function optimizedPhotoName(originalName, mime) {
  const base = String(originalName || 'photo').replace(/\.[^.]+$/, '');
  return `${base}.${mime === 'image/png' ? 'png' : 'jpg'}`;
}

/**
 * Compress / resize an image entirely on the client so uploads stay within the
 * recommended photo size (~500 KB). Modern camera-phone photos are often 3-8 MB;
 * this decodes them, downscales the longest edge to `maxDim` px and re-encodes
 * them. PNG files stay PNG (so logos keep transparency); everything else is
 * encoded as quality JPEG. EXIF orientation is applied by the browser when the
 * frame is drawn.
 *
 * Safe by design: the ORIGINAL file is returned unchanged (with
 * `optimized: false`) whenever re-encoding would not make it meaningfully
 * smaller, so no upload is ever worsened.
 *
 * @param {File|Blob} file
 * @param {object} [opts]
 * @param {number} [opts.maxDim=1024]   - longest edge in pixels
 * @param {number} [opts.quality=0.82]  - JPEG quality (0..1)
 * @param {number|null} [opts.maxMb]    - target max upload size in MB
 * @returns {Promise<{ file: File|Blob, optimized: boolean }>}
 */
export function optimizeImageFile(file, { maxDim = 1024, quality = 0.82, maxMb } = {}) {
  if (!file || !file.type || !file.type.startsWith('image/')) {
    return Promise.resolve({ file, optimized: false });
  }
  const maxBytes = maxMb ? Math.max(Math.floor(maxMb * 1024 * 1024), 1) : null;
  // Already comfortably inside the recommended size? Skip the re-encode.
  if (maxBytes && file.size <= maxBytes * 0.6) {
    return Promise.resolve({ file, optimized: false });
  }

  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onerror = () => resolve({ file, optimized: false });
    reader.onload = (e) => {
      const dataUrl = (e && e.target && e.target.result) || reader.result || '';
      if (!dataUrl) return resolve({ file, optimized: false });
      const img = new Image();
      img.onerror = () => resolve({ file, optimized: false });
      img.onload = () => {
        try {
          const w = Number(img.width);
          const h = Number(img.height);
          if (!w || !h) return resolve({ file, optimized: false });

          const keepPng = file.type === 'image/png';
          const attempts = keepPng
            ? [{ d: maxDim, q: 0.9, mime: 'image/png' }]
            : [
                { d: maxDim, q: quality, mime: 'image/jpeg' },
                { d: 800, q: 0.72, mime: 'image/jpeg' },
                { d: 640, q: 0.6, mime: 'image/jpeg' },
              ];

          let best = null;
          const done = (blob, mime) => {
            if (!blob || blob.size >= file.size) {
              // Never return a file bigger than the original.
              compose();
              return;
            }
            resolve({
              file: new File([blob], optimizedPhotoName(file.name, mime), { type: mime }),
              optimized: true,
            });
          };
          const compose = () => {
            if (best && best.blob.size < file.size) {
              resolve({
                file: new File([best.blob], optimizedPhotoName(file.name, best.mime), { type: best.mime }),
                optimized: true,
              });
            } else {
              resolve({ file, optimized: false });
            }
          };

          const render = (i) => {
            if (i >= attempts.length) {
              compose();
              return;
            }
            const { d, q, mime } = attempts[i];
            const scale = Math.min(1, d / Math.max(w, h));
            const dw = Math.max(1, Math.round(w * scale));
            const dh = Math.max(1, Math.round(h * scale));
            try {
              const canvas = document.createElement('canvas');
              canvas.width = dw;
              canvas.height = dh;
              const ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0, dw, dh);
              canvas.toBlob((blob) => {
                if (blob) {
                  if (!best || blob.size < best.blob.size) best = { blob, mime };
                  if (maxBytes ? blob.size <= maxBytes : true) {
                    done(blob, mime);
                    return;
                  }
                }
                render(i + 1);
              }, mime, q);
            } catch (err) {
              render(i + 1);
            }
          };
          render(0);
        } catch (err) {
          resolve({ file, optimized: false });
        }
      };
      img.src = dataUrl;
      if (typeof img.decode === 'function') img.decode();
    };
    reader.readAsDataURL(file);
  });
}