import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { AuthResponse, LoginDto, SignupDto } from '@opspilot/types';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService, RequestContext, Session } from './auth.service';
import { CurrentUser } from './decorators/current-user.decorator';
import { Public } from './decorators/public.decorator';
import { LoginBody, SignupBody } from './dto/auth.dto';
import { AccessTokenPayload, TokenService } from './token.service';

export const REFRESH_COOKIE = 'opspilot_rt';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly tokens: TokenService,
  ) {}

  @Public()
  @Post('signup')
  @ApiOperation({ summary: 'Create an account (A1) — returns tokens, signs you in' })
  @ApiBody({ type: SignupBody })
  async signup(
    @Body(new ZodValidationPipe(SignupDto)) dto: SignupDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.signup(dto, this.ctx(req)));
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Log in (A2) — access JWT in body, refresh token as httpOnly cookie' })
  @ApiBody({ type: LoginBody })
  async login(
    @Body(new ZodValidationPipe(LoginDto)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.login(dto, this.ctx(req)));
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Rotate the refresh token (A2); reuse burns all sessions' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    return this.respond(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.ctx(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoke the refresh token server-side (A3)' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE], this.ctx(req));
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Current authenticated user' })
  me(@CurrentUser() user: AccessTokenPayload) {
    return this.auth.getMe(user.sub);
  }

  private ctx(req: Request): RequestContext {
    return { userAgent: req.headers['user-agent'], ip: req.ip };
  }

  /** Splits the session: refresh token → httpOnly cookie, rest → JSON body. */
  private respond(res: Response, session: Session): AuthResponse {
    const { refreshToken, ...body } = session;
    res.cookie(REFRESH_COOKIE, refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/api/v1/auth', // only ever sent to refresh/logout, not the whole API
      maxAge: this.tokens.refreshTtlSec * 1000,
    });
    return body;
  }
}
