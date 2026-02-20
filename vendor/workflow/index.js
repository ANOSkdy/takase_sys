export class RetryableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "RetryableError";
    this.retryAfter = options.retryAfter;
  }
}

export class FatalError extends Error {
  constructor(message) {
    super(message);
    this.name = "FatalError";
  }
}

export function getStepMetadata() {
  return { stepId: `local-step-${Date.now()}`, attempt: 1 };
}
