import { supabase } from './supabase';
import { STORAGE_BUCKETS } from './constants';

export function publicUrl(bucket, path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
  const { data } = supabase.storage.from(bucket).getPublicUrl(path);
  return data?.publicUrl || null;
}

export function resolveFileUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//.test(url)) return url;
  const buckets = Object.values(STORAGE_BUCKETS);
  for (const bucket of buckets) {
    if (url.startsWith(`${bucket}/`)) {
      return publicUrl(bucket, url.slice(bucket.length + 1));
    }
  }
  return url;
}

export function photoUrl(path) {
  if (!path) return null;
  if (/^https?:\/\//.test(path)) return path;
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

export async function uploadFile(bucket, path, file) {
  const { error } = await supabase.storage.from(bucket).upload(path, file, {
    cacheControl: '3600',
    upsert: true,
    contentType: file.type || 'application/octet-stream',
  });
  if (error) throw new Error(error.message);
  return `${bucket}/${path}`;
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