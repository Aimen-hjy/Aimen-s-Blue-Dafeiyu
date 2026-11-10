export type ToolErrorCode =
  | "INVALID_INPUT"
  | "NOT_CONFIGURED"
  | "AUTH_EXPIRED"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "NETWORK_ERROR"
  | "UPSTREAM_ERROR"
  | "OPERATION_FAILED";

export class ToolError extends Error {
  constructor(
    public readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ToolError";
  }
}

export function toolError(code: ToolErrorCode, message: string): ToolError {
  return new ToolError(code, message);
}
