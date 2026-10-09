/**
 * apps/api/src/utils/duration.ts
 *
 * Accurate, bug-free call duration calculations.
 * Eliminates corrupt negative timestamps (-17289:-54) and distorted values (700:58).
 */

/**
 * Computes duration string (MM:SS) given call status, start and end timestamps.
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
 * Calculates raw elapsed seconds between two timestamps with status safety guards.
 */
export function calculateElapsedSeconds(
  status: string,
  startTime?: string | number | null,
  endTime?: string | number | null
): number {
  const nonConnected = [
    'failed',
    'declined',
    'busy',
    'no_answer',
    'ringing',
    'initiated',
    'invalid number'
  ];
  if (status && nonConnected.includes(status.toLowerCase())) {
    return 0;
  }
  if (!startTime || !endTime) return 0;

  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();

  if (isNaN(start) || isNaN(end) || end <= start) {
    return 0;
  }

  const elapsed = Math.floor((end - start) / 1000);
  if (elapsed < 0 || elapsed > 86400) {
    return 0;
  }

  return elapsed;
}

/**
 * Formats seconds into MM:SS.
 */
export function formatDurationSeconds(secs: number | null | undefined, status?: string): string {
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

  if (secs > 86400) {
    return '00:00';
  }

  const mins = Math.floor(secs / 60);
  const remainingSecs = Math.floor(secs % 60);
  return `${mins.toString().padStart(2, '0')}:${remainingSecs.toString().padStart(2, '0')}`;
}
