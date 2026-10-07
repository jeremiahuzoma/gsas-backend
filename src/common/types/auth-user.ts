import type { AppRole } from "@prisma/client";

/** The authenticated caller, resolved from the JWT and the database on every request. */
export interface AuthUser {
  id: string;
  email: string;
  roles: AppRole[];
  isAdmin: boolean;
}
