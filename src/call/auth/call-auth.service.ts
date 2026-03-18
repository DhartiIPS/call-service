import { Inject, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import { Socket } from 'socket.io';
import { firstValueFrom, timeout, catchError, throwError } from 'rxjs';

export interface AuthPayload {
  sub:    number;
  email?: string;
  roles?: string[];
}

const TOKEN_TIMEOUT_MS = 8_000; 

@Injectable()
export class CallAuthService {
  private readonly logger = new Logger(CallAuthService.name);

  constructor(
    @Inject('AUTH_SERVICE')
    private readonly authClient: ClientProxy,
  ) {}

  async validateSocket(socket: Socket): Promise<AuthPayload> {
    const token = this.extractToken(socket);

    this.logger.log(
      `[validateSocket] socket=${socket.id}\n` +
      `  auth.token  : "${token?.slice(0, 60)}..."\n` +
      `  resolved    : "${token?.slice(0, 60)}..."`,
    );

    if (!token) {
      throw new UnauthorizedException('No token provided');
    }

    let payload: AuthPayload;

    try {
      payload = await firstValueFrom<AuthPayload>(
        this.authClient
          .send<AuthPayload>({ cmd: 'verify_token' }, { token })
          .pipe(
            timeout(TOKEN_TIMEOUT_MS),
            catchError((err) => {
              const rpcMessage =
                err?.error?.message ??   // RpcException shape
                err?.message ??
                JSON.stringify(err);
              return throwError(() => new Error(rpcMessage));
            }),
          ),
      );
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : JSON.stringify(err);
      const isTimeout   = message.toLowerCase().includes('timeout');
      const isConnRefused =
        message.toLowerCase().includes('econnrefused') ||
        message.toLowerCase().includes('connect');

      if (isTimeout || isConnRefused) {
        this.logger.error(
          `[validateSocket] ❌ AUTH-SERVICE UNREACHABLE socket=${socket.id}\n` +
          `  → Is auth-service running on ${process.env.AUTH_TCP_HOST ?? 'localhost'}:${process.env.AUTH_TCP_PORT ?? 5002}?\n` +
          `  → Raw error: ${message}`,
        );
        throw new UnauthorizedException('Auth service unavailable — please try again');
      }

      this.logger.error(
        `[validateSocket] ❌ TOKEN REJECTED socket=${socket.id}\n` +
        `  → Raw error: ${message}`,
      );
      throw new UnauthorizedException('Invalid or expired token');
    }

    if (!payload || typeof payload.sub !== 'number') {
      this.logger.error(
        `[validateSocket] ❌ BAD PAYLOAD socket=${socket.id}: ${JSON.stringify(payload)}`,
      );
      throw new UnauthorizedException('Invalid token payload from auth-service');
    }

    this.logger.log(
      `[validateSocket]  OK socket=${socket.id} userId=${payload.sub}`,
    );

    return payload;
  }

  private extractToken(socket: Socket): string | null {
    const fromAuth = (socket.handshake.auth as Record<string, unknown>)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const fromHeader = socket.handshake.headers.authorization?.split(' ')[1];
    if (fromHeader) return fromHeader;

    const fromQuery = socket.handshake.query?.token;
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

    return null;
  }
}