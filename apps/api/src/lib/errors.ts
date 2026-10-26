export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly pointer?: string;
  readonly details?: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { pointer?: string; details?: unknown } = {},
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.pointer = options.pointer;
    this.details = options.details;
  }

  toJSON(): { error: { code: string; message: string; pointer?: string; details?: unknown } } {
    return {
      error: {
        code: this.code,
        message: this.message,
        pointer: this.pointer,
        details: this.details,
      },
    };
  }
}
