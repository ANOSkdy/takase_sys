const DATE_PARAM_ERROR_PREFIX = "Date parameter is not allowed";

export function assertNoDateSqlParams(params: unknown[], contextLabel: string): void {
  if (process.env.NODE_ENV === "production") return;

  for (const [index, param] of params.entries()) {
    if (param instanceof Date) {
      throw new Error(`${DATE_PARAM_ERROR_PREFIX}: index=${index}, context=${contextLabel}`);
    }
  }
}

