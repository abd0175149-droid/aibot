/** أكواد ثابتة قابلة للترجمة. لا نصّ خطأ يُرسل للواجهة بلا كود. */
export const ErrorCode = {
  WINDOW_CLOSED: 'WINDOW_CLOSED',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  CHANNEL_DISCONNECTED: 'CHANNEL_DISCONNECTED',
  CHANNEL_UNSUPPORTED: 'CHANNEL_UNSUPPORTED',
  TOOL_TIMEOUT: 'TOOL_TIMEOUT',
  TOOL_BLOCKED: 'TOOL_BLOCKED',
  SIGNATURE_INVALID: 'SIGNATURE_INVALID',
  TENANT_NOT_FOUND: 'TENANT_NOT_FOUND',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  RATE_LIMITED: 'RATE_LIMITED',
  VALIDATION: 'VALIDATION',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
  toJSON() {
    return { error: { code: this.code, message: this.message, details: this.details } };
  }
}
