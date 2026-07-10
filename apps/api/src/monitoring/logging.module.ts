import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { extractUserId, isNoisyRequest, resolveLogLevel, resolveRequestId } from './logger';

/**
 * pino structured logging (docs/02 §5): app.useLogger(app.get(Logger)) in
 * main.ts then patches every existing `new Logger(X.name)` call in the
 * codebase to emit through this — no service files change.
 */
@Module({
  imports: [
    LoggerModule.forRoot({
      pinoHttp: {
        level: resolveLogLevel(),
        genReqId: resolveRequestId,
        customProps: (req) => ({ userId: extractUserId(req as never) }),
        // Tokens/session cookies never hit the log stream
        redact: {
          paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
          censor: '[Redacted]',
        },
        autoLogging: { ignore: isNoisyRequest },
        transport:
          process.env.NODE_ENV === 'production'
            ? undefined // plain JSON to stdout — CloudWatch tails the container
            : { target: 'pino-pretty', options: { singleLine: true } },
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
