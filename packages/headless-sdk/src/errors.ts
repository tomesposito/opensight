import type { ApiErrorBody } from './types.js';

/**
 * Error thrown for every non-2xx v1 response. Carries the named
 * `errorCode` the API guarantees (e.g. RATE_LIMIT_EXCEEDED), the HTTP
 * status, and the Retry-After seconds for rate-limited responses.
 */
export class OpenSightApiError extends Error {
  readonly errorCode: string;
  readonly status: number;
  /** Present for 429 RATE_LIMIT_EXCEEDED */
  readonly retryAfter?: number;
  readonly body: ApiErrorBody;

  constructor(opts: {
    errorCode: string;
    message: string;
    status: number;
    body: ApiErrorBody;
    retryAfter?: number;
  }) {
    super(opts.message);
    this.name = 'OpenSightApiError';
    this.errorCode = opts.errorCode;
    this.status = opts.status;
    this.retryAfter = opts.retryAfter;
    this.body = opts.body;
  }
}
