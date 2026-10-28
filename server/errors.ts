export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 422,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export function publicError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  return new AppError(
    'INSPECTION_FAILED',
    'The page could not be inspected. Try a smaller, publicly accessible page.',
    502,
  );
}
