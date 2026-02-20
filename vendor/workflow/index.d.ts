export class RetryableError extends Error {
  retryAfter?: string;
  constructor(message: string, options?: { retryAfter?: string });
}
export class FatalError extends Error {
  constructor(message: string);
}
export function getStepMetadata(): { stepId: string; attempt: number };
