/** The one error shape of every route. */
export interface Problem {
  readonly error: { readonly code: string; readonly message: string; readonly [key: string]: unknown };
}
