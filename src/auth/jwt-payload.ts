export interface JwtPayload {
  /** user id */
  sub: string;
  email: string;
  /** users.token_version at issue time; logout increments it. */
  ver: number;
}
