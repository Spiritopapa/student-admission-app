/**
 * Vercel Serverless Function — Cloudinary Admin Delete Proxy
 * =============================================================
 * Deletes an asset from Cloudinary using the Admin (destroy) API.
 *
 * The browser CANNOT call Cloudinary's destroy API directly because it requires
 * the API SECRET. This proxy keeps the secret in Vercel environment variables
 * only — same pattern as /api/send-sms.
 *
 * Environment variables (set in Vercel; see .env.example):
 *   CLOUDINARY_CLOUD_NAME    your cloud name (public, same as js config)
 *   CLOUDINARY_API_KEY       API key from Cloudinary Dashboard → Settings → API Keys
 *   CLOUDINARY_API_SECRET    API secret (kept secret, server only)
 *
 * Request:
 *   POST /api/cloudinary-delete
 *   { "public_id": "online_v/student_photos_...jpg", "resource_type": "image|raw" }
 *
 * Response:
 *   200 { "success": true }          when Cloudinary reports result === "ok"
 *   404 { "success": true }          asset already gone (result === "not found")
 *   4xx / 5xx { "success": false, "error": "..." }
 *
 * The request is signed per Cloudinary docs:
 *   signature = SHA1( sorted params "k=v&k2=v2..." + API_SECRET )
 * `api_key`, `cloud_name`, `resource_type`, `signature` are excluded from the
 * signed string.
 */

const crypto = require('crypto');

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

/** Build the Cloudinary signature over the sorted params (excluding api_key etc.). */
function cloudinarySignature(params, apiSecret) {
  const sorted = Object.keys(params).sort();
  const toSign = sorted.map((k) => `${k}=${params[k]}`).join('&');
  return crypto.createHash('sha1').update(toSign + apiSecret).digest('hex');
}

function guessResourceType(publicId) {
  return /\.(pdf|docx?|xlsx?|pptx?|txt|csv)$/i.test(publicId) ? 'raw' : 'image';
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, { success: false, error: 'Method not allowed. Use POST.' });
  }

  // Parse the JSON body (Vercel may pre-parse it, may come as a raw string)
  let payload;
  try {
    payload =
      typeof req.body === 'object' && req.body !== null
        ? req.body
        : JSON.parse(req.body || '{}');
  } catch (e) {
    return json(res, 400, { success: false, error: 'Invalid JSON body.' });
  }

  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();

  if (!cloudName || !apiKey || !apiSecret) {
    return json(res, 503, {
      success: false,
      error:
        'Cloudinary deletion is not configured. Set CLOUDINARY_CLOUD_NAME, ' +
        'CLOUDINARY_API_KEY and CLOUDINARY_API_SECRET as Vercel environment variables.',
    });
  }

  const publicId = String(payload.public_id || '').trim();
  if (!publicId) {
    return json(res, 400, { success: false, error: 'public_id is required.' });
  }

  const providedType = String(payload.resource_type || '').trim().toLowerCase();
  const resourceType =
    providedType === 'image' || providedType === 'raw' || providedType === 'video'
      ? providedType
      : guessResourceType(publicId);

  const timestamp = Math.floor(Date.now() / 1000);
  const signedParams = { public_id: publicId, timestamp };
  const signature = cloudinarySignature(signedParams, apiSecret);

  const body = new URLSearchParams({
    public_id: publicId,
    timestamp: String(timestamp),
    api_key: apiKey,
    signature,
  });

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    let upstream;
    try {
      upstream = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/${resourceType}/destroy`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: body.toString(),
          signal: controller.signal,
        }
      );
    } finally {
      clearTimeout(timer);
    }

    const raw = await upstream.text().catch(() => '');
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      data = { raw };
    }

    if (!upstream.ok) {
      return json(res, upstream.status, {
        success: false,
        error: data?.error?.message || `Cloudinary Admin API HTTP ${upstream.status}`,
      });
    }

    // Cloudinary result: "ok" (deleted) or "not found" (already gone).
    if (data.result === 'ok') {
      return json(res, 200, { success: true, result: 'ok' });
    }
    if (data.result === 'not found') {
      return json(res, 404, { success: true, result: 'not found' });
    }
    return json(res, 502, { success: false, error: 'Cloudinary returned: ' + data.result });
  } catch (err) {
    return json(res, 502, {
      success: false,
      error: 'Failed to reach Cloudinary API: ' + err.message,
    });
  }
};