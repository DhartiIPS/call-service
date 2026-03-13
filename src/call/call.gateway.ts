import { Inject, Logger } from '@nestjs/common';
import { ClientProxy } from '@nestjs/microservices';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { firstValueFrom, timeout } from 'rxjs';
import { Server, Socket } from 'socket.io';
import { CallAuthService } from './auth/call-auth.service';

// ─── Types ────────────────────────────────────────────────────────────────────

interface CallRecord {
  roomId:      string;
  callerId:    string;
  receiverIds: string[];
  callType:    'audio' | 'video';
  startedAt?:  Date;
  isGroupCall: boolean;
}

declare module 'socket.io' {
  interface SocketData {
    userId: string;
    roles:  string[];
  }
}

const MS_TIMEOUT      = 5_000;
const RING_TIMEOUT_MS = 30_000;

@WebSocketGateway({
  namespace: '/call',
  cors: { origin: '*', credentials: true },
})
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(CallGateway.name);

  @WebSocketServer()
  server: Server;

  private readonly rooms        = new Map<string, CallRecord>();
  private readonly userSockets  = new Map<string, string>();
  private readonly activeCalls  = new Map<string, Set<string>>();
  private readonly ringingUsers = new Set<string>();
  private readonly callTimeouts = new Map<string, NodeJS.Timeout>();

  constructor(
    @Inject('CALL_SERVICE')
    private readonly callClient: ClientProxy,
    private readonly callAuthService: CallAuthService,
    // ★ NO jwtService here — JWT validation is done inside CallAuthService
  ) {}

  // ── Connection / Auth ──────────────────────────────────────────────────────

  async handleConnection(socket: Socket) {
    this.logger.log(
      `[connect:attempt] socket=${socket.id}\n` +
      `  auth keys : ${JSON.stringify(Object.keys(socket.handshake.auth ?? {}))}\n` +
      `  has auth.token : ${!!(socket.handshake.auth as Record<string, unknown>)?.token}\n` +
      `  auth.token preview: "${String((socket.handshake.auth as Record<string, unknown>)?.token ?? '').slice(0, 60)}"`,
    );

    try {
      const user = await this.callAuthService.validateSocket(socket);

      socket.data = {
        userId: String(user.sub),
        roles:  user.roles ?? [],
      };

      await socket.join(socket.data.userId);
      this.userSockets.set(socket.data.userId, socket.id);

      this.logger.log(`[connect:ok] userId=${socket.data.userId} socket=${socket.id}`);
    } catch (err) {
      this.logger.error(
        `[connect:fail] socket=${socket.id} — ${err instanceof Error ? err.message : String(err)}`,
      );
      socket.emit('exception', {
        code:    4001,
        message: 'Authentication failed. Please log in again.',
      });
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: Socket) {
    const userId = socket.data?.userId;

    if (userId && this.userSockets.get(userId) === socket.id) {
      this.userSockets.delete(userId);
    }

    this.logger.log(`[disconnect] socket=${socket.id} userId=${userId ?? '(unauthenticated)'}`);
    if (!userId) return;

    for (const [roomId, record] of this.rooms.entries()) {
      const isParticipant =
        record.callerId === userId || record.receiverIds.includes(userId);
      if (!isParticipant) continue;

      const durationSeconds = record.startedAt
        ? Math.floor((Date.now() - record.startedAt.getTime()) / 1000)
        : 0;

      this.server.to(roomId).emit('call:ended', {
        durationSeconds,
        reason: 'peer_disconnected',
      });

      this.clearRoomState(roomId, record);
      this.rooms.delete(roomId);
      this.persistCallEnd(roomId, userId).catch(() => {});
    }

    this.ringingUsers.delete(userId);
    this.cleanupActivePeers(userId);
  }

  // ── user:register (no-op — kept for backwards compatibility) ───────────────

  @SubscribeMessage('user:register')
  handleRegister(@ConnectedSocket() socket: Socket) {
    this.logger.log(`[register:noop] userId=${socket.data?.userId} socket=${socket.id}`);
    return { ok: true };
  }

  // ── call:join-room ─────────────────────────────────────────────────────────

  @SubscribeMessage('call:join-room')
  async handleJoinRoom(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() callerSocket: Socket,
  ) {
    const callerId = callerSocket.data?.userId;
    if (!callerId) {
      callerSocket.emit('exception', { message: 'Not authenticated.' });
      return { error: 'not_authenticated' };
    }

    let record: CallRecord;

    if (this.rooms.has(data.roomId)) {
      record = this.rooms.get(data.roomId)!;
    } else {
      try {
        const callData = await firstValueFrom<{
          callId:       string;
          roomId:       string;
          callerId:     string | number;
          receiverId:   string | number;
          receiverIds?: Array<string | number>;
          callType:     'audio' | 'video';
          isGroupCall?: boolean;
        }>(
          this.callClient
            .send({ cmd: 'get_call_by_room' }, { roomId: data.roomId })
            .pipe(timeout(MS_TIMEOUT)),
        );

        const receiverIds = callData.receiverIds?.length
          ? callData.receiverIds.map(String)
          : [String(callData.receiverId)];

        record = {
          roomId:      data.roomId,
          callerId:    String(callData.callerId),
          receiverIds,
          callType:    callData.callType ?? 'audio',
          isGroupCall: callData.isGroupCall ?? receiverIds.length > 1,
        };
        this.rooms.set(data.roomId, record);
      } catch (err) {
        this.logger.error(`get_call_by_room failed: ${err}`);
        callerSocket.emit('exception', { message: 'Call not found. Please try again.' });
        return { error: 'call_not_found' };
      }
    }

    if (record.callerId !== callerId) {
      this.logger.warn(
        `[join-room] SECURITY: caller=${callerId} tried to join room owned by ${record.callerId}`,
      );
      callerSocket.emit('exception', { message: 'You are not the caller for this room.' });
      return { error: 'unauthorized' };
    }

    await callerSocket.join(data.roomId);
    this.logger.log(`[join-room] caller=${callerId} joined room=${data.roomId}`);

    for (const receiverId of record.receiverIds) {
      if (this.hasActiveCall(receiverId) || this.ringingUsers.has(receiverId)) {
        this.server.to(callerId).emit('call:user-busy', { targetUserId: receiverId });
        continue;
      }

      this.ringingUsers.add(receiverId);

      this.server.to(receiverId).emit('call:incoming', {
        roomId:      data.roomId,
        fromUserId:  record.callerId,
        callType:    record.callType,
        isGroupCall: record.isGroupCall,
        createdAt:   new Date().toISOString(),
      });

      this.logger.log(`[join-room] call:incoming → receiverId=${receiverId}`);

      const timeoutKey = this.ringKey(data.roomId, receiverId);
      const t = setTimeout(() => {
        void (async () => {
          if (!this.ringingUsers.has(receiverId)) return;
          this.ringingUsers.delete(receiverId);
          this.callTimeouts.delete(timeoutKey);

          this.server.to(callerId).emit('call:no-answer', { targetUserId: receiverId });
          this.server.to(receiverId).emit('call:missed', {
            roomId:     data.roomId,
            fromUserId: record.callerId,
            callType:   record.callType,
          });

          this.persistMissedCall(data.roomId, receiverId).catch(() => {});
        })();
      }, RING_TIMEOUT_MS);

      this.callTimeouts.set(timeoutKey, t);
    }

    return { ok: true };
  }

  // ── call:rejoin ────────────────────────────────────────────────────────────

  @SubscribeMessage('call:rejoin')
  async handleRejoin(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data?.userId;
    if (!userId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);
    if (!record) return { error: 'room_not_found' };

    const isParticipant =
      record.callerId === userId || record.receiverIds.includes(userId);
    if (!isParticipant) {
      socket.emit('exception', { message: 'Not a participant of this call.' });
      return { error: 'unauthorized' };
    }

    this.userSockets.set(userId, socket.id);
    await socket.join(data.roomId);
    this.logger.log(`[rejoin] userId=${userId} socket=${socket.id} → room=${data.roomId}`);
    return { ok: true };
  }

  // ── call:respond ───────────────────────────────────────────────────────────

  @SubscribeMessage('call:respond')
  async handleRespond(
    @MessageBody() data: { roomId: string; accepted: boolean },
    @ConnectedSocket() receiverSocket: Socket,
  ) {
    const receiverId = receiverSocket.data?.userId;
    if (!receiverId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);
    if (!record) {
      receiverSocket.emit('exception', { message: 'Call room not found.' });
      return { error: 'room_not_found' };
    }

    if (!record.receiverIds.includes(receiverId)) {
      receiverSocket.emit('exception', { message: 'You are not a participant of this call.' });
      return { error: 'unauthorized' };
    }

    this.clearCallTimeout(this.ringKey(data.roomId, receiverId));
    this.ringingUsers.delete(receiverId);

    if (!data.accepted) {
      this.server.to(record.callerId).emit('call:rejected', {
        roomId:   data.roomId,
        byUserId: receiverId,
      });
      if (!record.isGroupCall) this.rooms.delete(data.roomId);

      this.callClient
        .send({ cmd: 'reject_call_by_room' }, { roomId: data.roomId, userId: receiverId })
        .pipe(timeout(MS_TIMEOUT))
        .subscribe({ error: (e) => this.logger.warn(`reject_call_by_room: ${e}`) });

      return { ok: true };
    }

    await receiverSocket.join(data.roomId);

    this.addActivePeer(receiverId, record.callerId);
    this.addActivePeer(record.callerId, receiverId);

    this.callClient
      .send({ cmd: 'accept_call_by_room' }, { roomId: data.roomId, userId: receiverId })
      .pipe(timeout(MS_TIMEOUT))
      .subscribe({ error: (e) => this.logger.warn(`accept_call_by_room: ${e}`) });

    this.server.to(record.callerId).emit('call:accepted', {
      roomId:   data.roomId,
      byUserId: receiverId,
    });

    this.logger.log(`[respond] room=${data.roomId} accepted by receiverId=${receiverId}`);
    return { ok: true };
  }

  // ── call:cancel ────────────────────────────────────────────────────────────

  @SubscribeMessage('call:cancel')
  async handleCancelCall(
    @MessageBody() data: { roomId: string; targetUserId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const callerId = socket.data?.userId;
    if (!callerId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);
    if (!record) return { error: 'room_not_found' };

    if (record.callerId !== callerId) {
      socket.emit('exception', { message: 'Only the caller can cancel.' });
      return { error: 'unauthorized' };
    }

    const targets = data.targetUserId ? [data.targetUserId] : record.receiverIds;

    for (const receiverId of targets) {
      if (!this.ringingUsers.has(receiverId)) continue;
      this.clearCallTimeout(this.ringKey(data.roomId, receiverId));
      this.ringingUsers.delete(receiverId);
      this.server.to(receiverId).emit('call:cancelled', { byUserId: callerId });
    }

    if (!data.targetUserId) {
      this.rooms.delete(data.roomId);
      this.persistCallEnd(data.roomId, callerId).catch(() => {});
    }

    return { ok: true };
  }

  // ── call:offer ─────────────────────────────────────────────────────────────

  @SubscribeMessage('call:offer')
  handleOffer(
    @MessageBody() data: { roomId: string; toUserId: string; sdp: RTCSessionDescriptionInit },
    @ConnectedSocket() callerSocket: Socket,
  ) {
    const fromUserId = callerSocket.data?.userId;
    if (!fromUserId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);
    if (record) {
      const isParticipant =
        record.callerId === fromUserId || record.receiverIds.includes(fromUserId);
      if (!isParticipant) {
        callerSocket.emit('exception', { message: 'Not a participant of this call.' });
        return { error: 'unauthorized' };
      }
      if (!record.startedAt) record.startedAt = new Date();
    }

    this.sendToUser(String(data.toUserId), 'call:offer', {
      roomId: data.roomId, fromUserId, sdp: data.sdp,
    });

    this.logger.log(`[offer] room=${data.roomId} from=${fromUserId} to=${data.toUserId}`);
    return { ok: true };
  }

  // ── call:answer ────────────────────────────────────────────────────────────

  @SubscribeMessage('call:answer')
  handleAnswer(
    @MessageBody() data: { roomId: string; toUserId: string; sdp: RTCSessionDescriptionInit },
    @ConnectedSocket() receiverSocket: Socket,
  ) {
    const fromUserId = receiverSocket.data?.userId;
    if (!fromUserId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);
    if (record) {
      const isParticipant =
        record.callerId === fromUserId || record.receiverIds.includes(fromUserId);
      if (!isParticipant) {
        receiverSocket.emit('exception', { message: 'Not a participant of this call.' });
        return { error: 'unauthorized' };
      }
    }

    this.sendToUser(String(data.toUserId), 'call:answer', {
      sdp: data.sdp, fromUserId,
    });

    this.logger.log(`[answer] room=${data.roomId} from=${fromUserId} to=${data.toUserId}`);
    return { ok: true };
  }

  // ── call:ice-candidate ─────────────────────────────────────────────────────

  @SubscribeMessage('call:ice-candidate')
  handleIceCandidate(
    @MessageBody() data: { roomId: string; toUserId: string; candidate: RTCIceCandidateInit },
    @ConnectedSocket() socket: Socket,
  ) {
    const fromUserId = socket.data?.userId;
    if (!fromUserId) return;

    const record = this.rooms.get(data.roomId);
    if (record) {
      const isParticipant =
        record.callerId === fromUserId || record.receiverIds.includes(fromUserId);
      if (!isParticipant) return;
    }

    this.sendToUser(String(data.toUserId), 'call:ice-candidate', {
      candidate: data.candidate,
    });
  }

  // ── call:end ───────────────────────────────────────────────────────────────

  @SubscribeMessage('call:end')
  async handleEndCall(
    @MessageBody() data: { roomId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data?.userId;
    if (!userId) return { error: 'not_authenticated' };

    const record = this.rooms.get(data.roomId);

    if (record && record.callerId !== userId && !record.receiverIds.includes(userId)) {
      socket.emit('exception', { message: 'You are not a participant of this call.' });
      return { error: 'unauthorized' };
    }

    const durationSeconds = record?.startedAt
      ? Math.floor((Date.now() - record.startedAt.getTime()) / 1000)
      : 0;

    this.server.to(data.roomId).emit('call:ended', { durationSeconds });

    if (record) this.clearRoomState(data.roomId, record);
    this.rooms.delete(data.roomId);
    this.persistCallEnd(data.roomId, userId).catch(() => {});

    this.logger.log(`[end] room=${data.roomId} by=${userId} duration=${durationSeconds}s`);
    return { ok: true };
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private sendToUser(userId: string, event: string, payload: unknown): void {
    const socketId = this.userSockets.get(userId);
    if (socketId) {
      this.server.to(socketId).emit(event, payload);
    } else {
      this.server.to(userId).emit(event, payload);
      this.logger.warn(`[sendToUser] no live socket for userId=${userId}, using personal room`);
    }
  }

  private ringKey(roomId: string, receiverId: string) {
    return `${roomId}:${receiverId}`;
  }

  private hasActiveCall(userId: string) {
    return (this.activeCalls.get(userId)?.size ?? 0) > 0;
  }

  private addActivePeer(userId: string, peerId: string) {
    const s = this.activeCalls.get(userId) ?? new Set<string>();
    s.add(peerId);
    this.activeCalls.set(userId, s);
  }

  private removeActivePeer(userId: string, peerId: string) {
    const s = this.activeCalls.get(userId);
    if (!s) return;
    s.delete(peerId);
    if (s.size === 0) this.activeCalls.delete(userId);
    else this.activeCalls.set(userId, s);
  }

  private clearCallTimeout(key: string) {
    const t = this.callTimeouts.get(key);
    if (t) { clearTimeout(t); this.callTimeouts.delete(key); }
  }

  private clearRoomState(roomId: string, record: CallRecord) {
    for (const rid of record.receiverIds) {
      this.clearCallTimeout(this.ringKey(roomId, rid));
      this.ringingUsers.delete(rid);
      this.removeActivePeer(rid, record.callerId);
      this.removeActivePeer(record.callerId, rid);
    }
  }

  private cleanupActivePeers(userId: string) {
    const peers = this.activeCalls.get(userId);
    if (!peers) return;
    for (const p of peers) this.removeActivePeer(p, userId);
    this.activeCalls.delete(userId);
  }

  private async persistCallEnd(roomId: string, userId: string) {
    try {
      await firstValueFrom(
        this.callClient
          .send({ cmd: 'end_call_by_room' }, { roomId, userId })
          .pipe(timeout(MS_TIMEOUT)),
      );
    } catch (e) {
      this.logger.warn(`persistCallEnd: ${e}`);
    }
  }

  private async persistMissedCall(roomId: string, userId: string) {
    try {
      await firstValueFrom(
        this.callClient
          .send({ cmd: 'miss_call_by_room' }, { roomId, userId })
          .pipe(timeout(MS_TIMEOUT)),
      );
    } catch (e) {
      this.logger.warn(`persistMissedCall: ${e}`);
    }
  }
}