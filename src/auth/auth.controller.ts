import { Body, Controller, Get, HttpCode, Post } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { Throttle } from "@nestjs/throttler";

import { CurrentUser } from "../common/decorators/current-user.decorator";
import { Public } from "../common/decorators/public.decorator";
import type { AuthUser } from "../common/types/auth-user";
import { AuthService } from "./auth.service";
import { LoginDto, RegisterDto } from "./dto/auth.dto";

/**
 * Brute-force protection for the credential endpoints. Read from the
 * environment at load time because decorator metadata is static.
 */
const authRateLimit = Number(process.env["AUTH_RATE_LIMIT_PER_MINUTE"] ?? 10) || 10;

@ApiTags("auth")
@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: authRateLimit, ttl: 60_000 } })
  @Post("register")
  @ApiOperation({
    summary: "Create an account",
    description:
      "Creates the user, profile, customer role and a virtual meter (replaces Supabase sign-up + handle_new_user trigger).",
  })
  register(@Body() dto: RegisterDto) {
    return this.auth.register(dto);
  }

  @Public()
  @Throttle({ default: { limit: authRateLimit, ttl: 60_000 } })
  @Post("login")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign in with email and password; returns a JWT access token" })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto);
  }

  @ApiBearerAuth()
  @Post("logout")
  @HttpCode(200)
  @ApiOperation({ summary: "Sign out and revoke every token issued for this user" })
  logout(@CurrentUser() user: AuthUser) {
    return this.auth.logout(user);
  }

  @ApiBearerAuth()
  @Get("me")
  @ApiOperation({ summary: "Current user, profile and roles" })
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user.id);
  }
}
