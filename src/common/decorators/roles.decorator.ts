import { SetMetadata } from "@nestjs/common";
import type { AppRole } from "@prisma/client";

export const ROLES_KEY = "roles";

/** Restricts a route to callers holding one of these roles (read from the DB, never the client). */
export const Roles = (...roles: AppRole[]) => SetMetadata(ROLES_KEY, roles);
