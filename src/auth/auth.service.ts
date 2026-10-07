import { randomInt } from "node:crypto";

import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { JwtService } from "@nestjs/jwt";
import { AppRole, Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";

import type { AuthUser } from "../common/types/auth-user";
import { INVALID_PHONE_MESSAGE, normalisePhone } from "../communications/phone";
import type { Env } from "../config/env.validation";
import { PrismaService } from "../prisma/prisma.service";
import { UsersService } from "../users/users.service";
import type { LoginDto, RegisterDto } from "./dto/auth.dto";
import type { JwtPayload } from "./jwt-payload";

const BCRYPT_ROUNDS = 10;
const MAX_METER_NUMBER_ATTEMPTS = 5;

export interface MeResponse {
  id: string;
  email: string;
  fullName: string | null;
  phoneNumber: string | null;
  roles: AppRole[];
  isAdmin: boolean;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  /**
   * Sign-up. Replaces Supabase Auth sign-up plus the public.handle_new_user()
   * trigger: creates the account, its profile, the `customer` role and a
   * virtual meter numbered '4501' + 8 random digits — all in one transaction.
   */
  async register(dto: RegisterDto): Promise<{ user: MeResponse }> {
    const existing = await this.users.findByEmail(dto.email);
    if (existing) throw new ConflictException("User already registered");

    let phone: string | null = null;
    if (dto.phoneNumber) {
      phone = normalisePhone(dto.phoneNumber);
      if (!phone) throw new BadRequestException(INVALID_PHONE_MESSAGE);
    }

    const fullName = dto.fullName ?? dto.email.split("@")[0] ?? "Customer";
    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    for (let attempt = 1; attempt <= MAX_METER_NUMBER_ATTEMPTS; attempt += 1) {
      try {
        const user = await this.prisma.$transaction(async (tx) => {
          const created = await tx.user.create({
            data: { email: dto.email, password_hash: passwordHash },
          });
          await tx.profile.create({
            data: { id: created.id, full_name: fullName, email: dto.email, phone_number: phone },
          });
          await tx.userRole.create({ data: { user_id: created.id, role: AppRole.customer } });
          await tx.meter.create({
            data: {
              user_id: created.id,
              meter_number: generateMeterNumber(),
              customer_name: fullName,
              phone_number: phone,
            },
          });
          return created;
        });
        return { user: await this.me(user.id) };
      } catch (error) {
        if (isUniqueViolation(error, "email"))
          throw new ConflictException("User already registered");
        // Meter number collision: try again with a new random number.
        if (isUniqueViolation(error, "meter_number") && attempt < MAX_METER_NUMBER_ATTEMPTS)
          continue;
        throw error;
      }
    }
    throw new ConflictException("Could not allocate a meter number, please try again");
  }

  async login(dto: LoginDto) {
    const user = await this.users.findByEmail(dto.email);
    // Same generic message for unknown email and wrong password.
    const ok = user ? await bcrypt.compare(dto.password, user.password_hash) : false;
    if (!user || !ok) throw new UnauthorizedException("Invalid login credentials");

    const payload: JwtPayload = { sub: user.id, email: user.email, ver: user.token_version };
    const accessToken = await this.jwt.signAsync(payload);
    return {
      accessToken,
      tokenType: "Bearer" as const,
      expiresIn: this.config.get("JWT_EXPIRES_IN", { infer: true }),
      user: await this.me(user.id),
    };
  }

  /** Revokes every token issued so far for this user. */
  async logout(user: AuthUser) {
    await this.prisma.user.update({
      where: { id: user.id },
      data: { token_version: { increment: 1 } },
    });
    return { ok: true };
  }

  async me(userId: string): Promise<MeResponse> {
    const [user, profile, roles] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: { id: true, email: true },
      }),
      this.users.getProfile(userId),
      this.users.getRoles(userId),
    ]);
    return {
      id: user.id,
      email: user.email,
      fullName: profile?.full_name ?? null,
      phoneNumber: profile?.phone_number ?? null,
      roles,
      isAdmin: roles.includes(AppRole.admin),
    };
  }
}

/** '4501' || lpad(floor(random()*100000000)::text, 8, '0') — same format as the original trigger. */
export function generateMeterNumber(): string {
  return `4501${String(randomInt(0, 100_000_000)).padStart(8, "0")}`;
}

function isUniqueViolation(error: unknown, field: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002")
    return false;
  const target = (error.meta as { target?: unknown } | undefined)?.target;
  const text = Array.isArray(target) ? target.join(",") : String(target ?? error.message);
  return text.includes(field);
}
