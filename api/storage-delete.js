import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL =
  process.env.SUPABASE_URL || 'https://rfsfkxplafwlmwncwduz.supabase.co';
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/** Buckets the app may remove files from. */
const ALLOWED_BUCKETS = new Set([
  'student-photos',
  'applications',
  'school-logos',
  'documents',
]);

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  try {
    return JSON.parse(req.body || '{}');
  } catch (err) {
    return {};
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
  }

  if (!SERVICE_ROLE_KEY) {
    return json(res, 503, {
      success: false,
      error:
        'Storage deletion is not configured. Set SUPABASE_SERVICE_ROLE_KEY as a Vercel environment variable.',
    });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!token) {
    return json(res, 401, { success: false, error: 'Authentication required.' });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verify the caller holds a valid session before removing files.
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  if (userError || !userData?.user) {
    return json(res, 401, { success: false, error: 'Invalid or expired session.' });
  }

  const payload = parseBody(req);
  const files = Array.isArray(payload.files) ? payload.files : [];
  if (!files.length) {
    return json(res, 400, { success: false, error: 'files[] is required.' });
  }

  const removed = [];
  const failed = [];

  for (const entry of files) {
    const file = typeof entry === 'string' ? entry : entry?.path;
    if (!file || typeof file !== 'string') continue;
    const parts = file.split('/');
    const bucket = parts[0];
    if (!ALLOWED_BUCKETS.has(bucket)) {
      failed.push({ path: file, error: 'Bucket not allowed.' });
      continue;
    }
    const path = parts.slice(1).join('/');
    try {
      const { error } = await admin.storage.from(bucket).remove([path]);
      if (error) {
        failed.push({ path: file, error: error.message });
      } else {
        removed.push(file);
      }
    } catch (err) {
      failed.push({ path: file, error: err.message });
    }
  }

  return json(res, 200, { success: failed.length === 0, removed, failed });
}