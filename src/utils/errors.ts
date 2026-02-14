/**
 * Custom error classes for better error handling
 */

export class ApplicationError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500, isOperational: boolean = true) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export class ValidationError extends ApplicationError {
  constructor(message: string) {
    super(message, 400, true);
  }
}

export class NotFoundError extends ApplicationError {
  constructor(resource: string) {
    super(`${resource} not found`, 404, true);
  }
}

export class UnauthorizedError extends ApplicationError {
  constructor(message: string = 'Unauthorized access') {
    super(message, 401, true);
  }
}

export class ForbiddenError extends ApplicationError {
  constructor(message: string = 'Access forbidden') {
    super(message, 403, true);
  }
}

export class ConflictError extends ApplicationError {
  constructor(message: string) {
    super(message, 409, true);
  }
}

export class DatabaseError extends ApplicationError {
  constructor(message: string, originalError?: Error) {
    super(`Database error: ${message}`, 500, true);
    if (originalError) {
      this.stack = originalError.stack;
    }
  }
}

export class ExternalServiceError extends ApplicationError {
  constructor(service: string, message: string) {
    super(`${service} error: ${message}`, 503, true);
  }
}

export class RateLimitError extends ApplicationError {
  public readonly retryAfter?: number;

  constructor(message: string = 'Rate limit exceeded', retryAfter?: number) {
    super(message, 429, true);
    this.retryAfter = retryAfter;
  }
}

/**
 * Error handler middleware for Express
 */
export function errorHandler(err: Error, req: any, res: any, next: any) {
  if (err instanceof ApplicationError) {
    return res.status(err.statusCode).json({
      error: err.message,
      statusCode: err.statusCode,
      ...(err instanceof RateLimitError &&
        err.retryAfter && {
          retryAfter: err.retryAfter,
        }),
    });
  }

  // Unknown error - don't expose details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  return res.status(500).json({
    error: isDevelopment ? err.message : 'Internal server error',
    statusCode: 500,
    ...(isDevelopment && { stack: err.stack }),
  });
}
