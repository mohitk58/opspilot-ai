# Devlog

One entry per shipped task: what shipped, what went wrong, how it was resolved.
This becomes the "challenges and how I resolved them" interview write-up.

## 2026-07-07 — Auth module (Epic 1, A1–A5)

**Shipped:**
- Full auth flow: signup (first user in org auto-ADMIN), login, silent refresh with rotating refresh tokens, logout, `GET /me`, and ADMIN-only role assignment. Access JWT 15 min in body; refresh JWT 7 d in an httpOnly SameSite=Lax cookie scoped to `/api/v1/auth`, stored as SHA-256 hash, allowlisted in Redis.
- Replay detection per ADR-006: presenting an already-rotated/revoked refresh token revokes **every** active session for that user and writes an `auth.refresh_replay_detected` audit row. Verified live: the replayed cookie AND the legitimate new cookie both die.
- Shared infrastructure the first real module forced into existence: `ZodValidationPipe` (422 + flattened issues), global RFC 7807 `problem+json` filter with stable `code`s, `RedisService` with the 100 ms timeout/degrade-to-DB contract, global `JwtAuthGuard`/`RolesGuard`, ESLint config, Jest config, and the initial Prisma migration.
- 36 unit tests; coverage: auth service 92 %, token service 100 %.

**What went wrong / decisions:**
- `docker compose` (plugin form) doesn't exist on this machine — Docker runs via **colima**, so it's `colima start` + `docker-compose up -d`.
- Review caught a config-drift bug: refresh TTL was hardcoded in four places (JWT `exp`, DB `expiresAt`, cookie `maxAge`, Redis TTL) while the JWT alone read `JWT_REFRESH_TTL` from env. Fixed by deriving all four from one parsed config value in `TokenService`.
- Review also added: last-admin demotion protection (409 `LAST_ADMIN`), human-readable RFC 7807 titles, and a documented CLAUDE.md exemption — routine 15-min token rotation is not audited (noise), while login/logout/replay are.
- Deliberate MVP concessions, documented: login timing oracle (no dummy bcrypt compare on unknown email), session issuance outside the signup transaction (crash → 500 but account exists; user just logs in).
- Redis-down degradation verified empirically: stopped the Redis container, login/refresh still returned 200 via DB fallback.
