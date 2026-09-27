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
 * Verify a storage bucket exists in the connected Supabase project.
 * Set `force: true` to skip the in-memory cache and always hit the server
 * (used by diagnostics); false (default) fast-paths already-known buckets.
 *
 * @param {string} bucket - bucket id, e.g. "student-photos"
 * @returns {Promise<{ exists: boolean, error?: string }>}
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
    knownBuckets.delete(bucket);
    return { exists: false, error: error?.message || 'Bucket not found.' };
  } catch (err) {
    knownBuckets.delete(bucket);
    return { exists: false, error: err.message };
  }
}

/**
 * Ensure a storage bucket exists, creating it when it is missing and the
 * project's storage RLS allows authenticated bucket creation (mirrors the
 * legacy app's behaviour). Bucket creation can only fail when the project
 * denies it - the caller is told exactly how to fix that.
 */
export async function ensureStorageBucket(bucket) {
  if (!bucket) return { ok: false, error: new Error('No storage bucket specified.') };
  if (knownBuckets.has(bucket)) return { ok: true, exists: true, created: false };

  const { data: existing } = await supabase.storage.getBucket(bucket);
  if (existing) {
    knownBuckets.add(bucket);
    return { ok: true, exists: true, created: false };
  }
  try {
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

export async function uploadFile(bucket, path, file) {
  const prepare = async () => {
    const ensured = await ensureStorageBucket(bucket);
    if (!ensured.ok) {
      throw new Error(
        `Storage bucket "${bucket}" is missing and could not be created automatically ` +
          `(${ensured.error?.message || 'permission denied'}). ` +
          'Open the Supabase SQL Editor once and run "sql/073-supabase-storage-buckets.sql" ' +
          'to create the file buckets (student-photos, applications, school-logos, documents).'
      );
    }
  };

  await prepare();

  const upload = () =>
    supabase.storage.from(bucket).upload(path, file, {
      cacheControl: '3600',
      upsert: true,
      contentType: file.type || 'application/octet-stream',
    });

  let result = await upload();
  // The bucket may have been removed after our cache was set - re-verify once.
  if (result.error && /bucket not found/i.test(result.error.message)) {
    knownBuckets.delete(bucket);
    await prepare();
    result = await upload();
  }
  if (result.error) throw new Error(result.error.message);
  return `${bucket}/${result.data.path || path}`;
}

export async function deleteStoredFiles(entries) {
  const files = entries.filter(Boolean);
  if (!files.length) return;
  try {
    const res = await fetch('/api/storage-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
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