/** Typed domain errors mapped to HTTP status codes by the error middleware. (Spec §20.4) */

export interface ErrorDetail {
  field?: string;
  code: string;
  message: string;
  meta?: Record<string, unknown>;
}

export class AppError extends Error {
  readonly code: string;
  readonly httpStatus: number;
  readonly details?: ErrorDetail[];
  readonly isOperational = true;

  constructor(code: string, httpStatus: number, message: string, details?: ErrorDetail[]) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.httpStatus = httpStatus;
    this.details = details;
    Error.captureStackTrace?.(this, new.target);
  }
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[], message = 'Some fields need attention.') {
    super('VALIDATION_FAILED', 422, message, details);
  }
}

export class UnauthenticatedError extends AppError {
  constructor(message = 'You need to sign in to do that.') {
    super('UNAUTHENTICATED', 401, message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'You do not have permission to do that.') {
    super('FORBIDDEN', 403, message);
  }
}

export class NotFoundError extends AppError {
  constructor(what = 'Resource') {
    super('NOT_FOUND', 404, `${what} not found.`);
  }
}

export class GoneError extends AppError {
  constructor(message = 'This item is no longer available.') {
    super('GONE', 410, message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, code = 'CONFLICT', details?: ErrorDetail[]) {
    super(code, 409, message, details);
  }
}

export class PriceChangedError extends ConflictError {
  constructor(details: ErrorDetail[]) {
    super('Prices have changed. Please review your order and try again.', 'PRICE_CHANGED', details);
  }
}

export class InsufficientStockError extends ConflictError {
  constructor(details: ErrorDetail[]) {
    super('Some items are no longer available in the quantity requested.', 'INSUFFICIENT_STOCK', details);
  }
}

export class InvalidStateTransitionError extends ConflictError {
  constructor(from: string, to: string) {
    super(`An order cannot move from "${from}" to "${to}".`, 'INVALID_STATE_TRANSITION');
  }
}

export class TokenInvalidError extends AppError {
  constructor(message = 'This link is no longer valid.') {
    super('TOKEN_INVALID', 400, message);
  }
}

export class RateLimitError extends AppError {
  constructor(message = 'Too many requests. Please slow down.') {
    super('RATE_LIMITED', 429, message);
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'That file is too large.') {
    super('PAYLOAD_TOO_LARGE', 413, message);
  }
}

export class UnsupportedMediaTypeError extends AppError {
  constructor(message = 'That file type is not accepted.') {
    super('UNSUPPORTED_MEDIA_TYPE', 415, message);
  }
}
