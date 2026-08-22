/**
 * Vercel Serverless Function — Nalo Solutions SMS Proxy
 * =====================================================
 * Sends an SMS through the Nalo Solutions gateway:
 *
 *   https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/
 *
 * The Nalo credentials live ONLY in Vercel environment variables so the
 * secret key is never shipped to the browser (the static SPA cannot be
 * trusted with it). This mirrors the existing RESEND_API_KEY pattern
 * referenced in .env.example.
 *
 *   NALO_SMS_AUTH_KEY     Nalo API "key" (auth_key)          [preferred]
 *   NALO_SMS_USERNAME     Nalo account username (fallback auth)
 *   NALO_SMS_PASSWORD     Nalo account password (fallback auth)
 *   NALO_SMS_SENDER_ID    Registered sender id (default "NALO")
 *
 * Request:
 *   POST /api/send-sms
 *   { "phone": "233240000000", "message": "...", "sender_id": "NALO" }
 *
 * Nalo status "1701" = success. The gateway replies either as a pipe
 * string ("1701|233501234567|message_id") or JSON ({"status":"1701",...}).
 * Both formats are handled.
 */

const NALO_ENDPOINT =
  'https://sms.nalosolutions.com/smsbackend/Resl_Nalo/send-message/';

/**
 * Normalize a Ghana phone number to international 233XXXXXXXXX form.
 * Accepts "0244...", "+23324...", "23324...", with spaces/dashes stripped.
 */
function normalizeGhanaPhone(raw) {
  if (raw == null) return null;
  let digits = String(raw).trim().replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith('233')) return digits.length === 12 ? digits : null;
  if (digits.startsWith('0') && digits.length === 10) return '233' + digits.slice(1);
  return null;
}

/** Extract the Nalo status code from either response format. */
function parseNaloStatus(raw) {
  if (!raw) return null;
  const text = String(raw).trim();
  const pipe = /^(\d{4})\|/.exec(text); // "1701|233501234567|msg_id"
  if (pipe) return pipe[1];
  try {
    const parsed = JSON.parse(text);
    if (parsed && parsed.status) return String(parsed.status);
  } catch (e) {
    /* not JSON */
  }
  return null;
}

function naloErrorText(code) {
  const map = {
    '1702': 'Invalid request to Nalo gateway',
    '1703': 'Invalid Nalo username or password',
    '1704': 'Invalid message type',
    '1705': 'Invalid message',
    '1706': 'Invalid destination number',
    '1707': 'Invalid or unapproved sender ID',
    '1708': 'Invalid DLR setting',
    '1709': 'Nalo user validation failed',
    '1710': 'Nalo internal error',
  };
  return map[code] || 'Nalo gateway rejected the message';
}

function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = status;
  res.end(JSON.stringify(body));
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return json(res, 405, {
      success: false,
      error: 'Method not allowed. Use POST.',
    });
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

  const phone = normalizeGhanaPhone(payload.phone || payload.destination);
  const message = String(payload.message || '').trim();
  if (!phone) {
    return json(res, 400, {
      success: false,
      error: 'A valid recipient phone (233XXXXXXXXX) is required.',
    });
  }
  if (!message) {
    return json(res, 400, { success: false, error: 'Message text is required.' });
  }

  const senderId = String(payload.sender_id || process.env.NALO_SMS_SENDER_ID || 'NALO').trim();

  const authKey = (process.env.NALO_SMS_AUTH_KEY || '').trim();
  const username = (process.env.NALO_SMS_USERNAME || '').trim();
  const password = (process.env.NALO_SMS_PASSWORD || '').trim();

  if (!authKey && !(username && password)) {
    return json(res, 500, {
      success: false,
      error:
        'Nalo SMS is not configured. Set NALO_SMS_AUTH_KEY (or NALO_SMS_USERNAME + NALO_SMS_PASSWORD) as Vercel environment variables.',
    });
  }

  const naloBody = authKey
    ? { key: authKey, msisdn: phone, message, sender_id: senderId }
    : { username, password, msisdn: phone, message, sender_id: senderId };

  let upstream;
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      upstream = await fetch(NALO_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(naloBody),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    return json(res, 502, {
      success: false,
      error: 'Failed to reach Nalo gateway: ' + err.message,
    });
  }

  const raw = await upstream.text().catch(() => '');
  const statusCode = parseNaloStatus(raw);

  if (statusCode === '1701') {
    return json(res, 200, {
      success: true,
      status: '1701',
      message: 'SMS accepted by Nalo gateway',
      providerRaw: raw,
    });
  }

  return json(res, 502, {
    success: false,
    status: statusCode || 'unknown',
    message: naloErrorText(statusCode),
    providerRaw: raw,
  });
};
