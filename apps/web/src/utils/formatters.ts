/**
 * apps/web/src/utils/formatters.ts
 *
 * Safe call duration calculations, E.164 normalization, and UI formatters.
 * Strictly prevents negative durations (-17289:-54) and corrupted numbers (700:58).
 */

/**
 * Computes call duration string (MM:SS) given call status, start and end timestamps.
 * Guaranteed to return '00:00' for non-connected calls or corrupted/negative intervals.
 */
export function computeCallDuration(
  status: string,
  startTime?: string | number | null,
  endTime?: string | number | null
): string {
  // If the call was never connected or answered, duration is always 00:00
  const nonConnectedStatuses = [
    'Failed',
    'Declined',
    'Busy',
    'Invalid number',
    'No Answer',
    'Ringing',
    'failed',
    'declined',
    'busy',
    'no_answer',
    'ringing',
    'initiated'
  ];
  if (!startTime || !endTime || nonConnectedStatuses.includes(status)) {
    return '00:00';
  }

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (isNaN(start) || isNaN(end) || end <= start) {
    return '00:00';
  }

  const elapsedSeconds = Math.floor((end - start) / 1000);

  // Guard against corrupted system timestamps exceeding 24 hours
  if (elapsedSeconds > 86400 || elapsedSeconds < 0) {
    return '00:00';
  }

  const mins = Math.floor(elapsedSeconds / 60);
  const secs = elapsedSeconds % 60;
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Formats a duration in seconds safely.
 * Returns '00:00' for null/negative values or non-connected call statuses.
 */
export function formatDuration(secs: number | null | undefined, status?: string): string {
  if (status) {
    const nonConnected = [
      'failed',
      'declined',
      'busy',
      'invalid number',
      'no answer',
      'no_answer',
      'ringing',
      'initiated'
    ];
    if (nonConnected.includes(status.toLowerCase())) {
      return '00:00';
    }
  }

  if (secs === null || secs === undefined || isNaN(secs) || secs <= 0) {
    return '00:00';
  }

  // Guard against unrealistic durations exceeding 24 hours
  if (secs > 86400) {
    return '00:00';
  }

  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
}

/**
 * Strict E.164 phone normalizer.
 * Strips non-digits (except leading +), prepends defaultCountry if 10 or 11 digits.
 */
export function formatE164(raw: string, defaultCountry = '+1'): string {
  if (!raw) return '';
  const cleaned = raw.trim().replace(/[^\d+]/g, '');
  if (!cleaned) return '';
  if (cleaned.startsWith('+')) return cleaned;
  if (cleaned.length === 10) {
    const prefix = defaultCountry.startsWith('+') ? defaultCountry : `+${defaultCountry}`;
    return `${prefix}${cleaned}`;
  }
  if (cleaned.length === 11 && cleaned.startsWith('1')) {
    return `+${cleaned}`;
  }
  return `+${cleaned}`;
}

/**
 * Formats monetary amounts in USD ($0.00).
 */
export function formatCurrency(amount: number | null | undefined): string {
  if (amount === null || amount === undefined || isNaN(amount)) return '$0.00';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/**
 * Formats timestamp into local time (e.g., 08:19 AM).
 */
export function formatTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  } catch {
    return '—';
  }
}

/**
 * Formats timestamp into local date and time.
 */
export function formatDateTime(ts: string | null | undefined): string {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
}
