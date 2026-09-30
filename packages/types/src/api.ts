// Wire contracts shared by the API and its clients (architecture §15).

export interface ApiSuccess<T, M extends object = Record<string, unknown>> {
  data: T;
  meta: M;
}

export interface ApiErrorIssue {
  path: string;
  message: string;
}

export interface ApiErrorBody {
  error: {
    // Specific code such as LOAD_NOT_FOUND, or a category (VALIDATION_ERROR, FORBIDDEN…).
    code: string;
    message: string;
    requestId: string;
    issues?: ApiErrorIssue[];
  };
}

export interface PageMeta {
  total: number;
  limit: number;
  offset: number;
}
