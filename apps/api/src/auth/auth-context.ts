import type { Permission } from '@runtruck/permissions';

// The authenticated user context (architecture §11). Built only from the
// server-side session — never from anything the client sends (Rule 4).
export interface AuthContext {
  userId: string;
  organizationId: string;
  sessionId: string;
  // The organization's IANA timezone, for business-date calculations.
  timezone: string;
  permissions: ReadonlySet<Permission>;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace -- Express's documented augmentation point
  namespace Express {
    interface Request {
      auth?: AuthContext;
    }
  }
}
