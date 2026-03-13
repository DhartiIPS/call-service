import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { v4 as uuidv4 } from 'uuid';
import { Call } from './entity/call.entity';
import { CreateCallDto } from './dto/create-call.dto';
import { CallStatus } from './enums/call-status';

@Injectable()
export class CallService {
  constructor(
    @InjectRepository(Call)
    private readonly callRepo: Repository<Call>,
  ) {}

  async createCall(data: CreateCallDto) {
    if (data.callerId === data.receiverId) {
      throw new BadRequestException('Cannot call yourself');
    }

    const roomId = `call_${uuidv4()}`;

    const call = this.callRepo.create({
      callerId: data.callerId,
      receiverId: data.receiverId,
      callType: data.callType,
      roomId,
      status: CallStatus.INITIATED,
    });

    await this.callRepo.save(call);
    return { callId: call.id, roomId, receiverId: call.receiverId };
  }
  
  async getCallByRoom(roomId: string) {
    const call = await this.callRepo.findOne({ where: { roomId } });
    if (!call) throw new NotFoundException(`No call found for room: ${roomId}`);

    return {
      callId:     call.id,
      roomId:     call.roomId,
      callerId:   call.callerId,
      receiverId: call.receiverId,
      callType:   call.callType,
      status:     call.status,
      createdAt:  call.createdAt,
    };
  }

  async acceptCallByRoom(roomId: string, userId: string): Promise<Call> {
    const call = await this.findByRoom(roomId);
    this.assertReceiver(call, userId, 'accept');
    this.assertStatus(call, [CallStatus.INITIATED], 'accept');

    call.status    = CallStatus.ACCEPTED;
    call.startedAt = new Date();
    return this.callRepo.save(call);
  }

  async acceptCall(callId: string, userId: string): Promise<Call> {
    const call = await this.findById(callId);
    this.assertReceiver(call, userId, 'accept');
    this.assertStatus(call, [CallStatus.INITIATED], 'accept');

    call.status    = CallStatus.ACCEPTED;
    call.startedAt = new Date();
    return this.callRepo.save(call);
  }

  async rejectCallByRoom(roomId: string, userId: string): Promise<Call> {
    const call = await this.findByRoom(roomId);
    this.assertReceiver(call, userId, 'reject');
    this.assertStatus(call, [CallStatus.INITIATED], 'reject');

    call.status  = CallStatus.REJECTED;
    call.endedAt = new Date();
    call.duration = 0;
    return this.callRepo.save(call);
  }

  async rejectCall(callId: string, userId: string): Promise<Call> {
    const call = await this.findById(callId);
    this.assertReceiver(call, userId, 'reject');
    this.assertStatus(call, [CallStatus.INITIATED], 'reject');

    call.status  = CallStatus.REJECTED;
    call.endedAt = new Date();
    call.duration = 0;
    return this.callRepo.save(call);
  }

  async endCallByRoom(roomId: string, userId: string): Promise<Call> {
    const call = await this.findByRoom(roomId);
    this.assertParticipant(call, userId);

    if (
      call.status !== CallStatus.ACCEPTED &&
      call.status !== CallStatus.INITIATED
    ) {
      return call;
    }

    return this.applyEnd(call);
  }

  async endCall(callId: string, userId: string): Promise<Call> {
    const call = await this.findById(callId);
    this.assertParticipant(call, userId);
    this.assertStatus(call, [CallStatus.ACCEPTED, CallStatus.INITIATED], 'end');

    return this.applyEnd(call);
  }

  async cancelCall(callId: string, userId: string): Promise<Call> {
    const call = await this.findById(callId);

    if (call.callerId !== userId) {
      throw new ForbiddenException('Only the caller can cancel this call');
    }
    this.assertStatus(call, [CallStatus.INITIATED], 'cancel');

    call.status   = CallStatus.CANCELLED;
    call.endedAt  = new Date();
    call.duration = 0;
    return this.callRepo.save(call);
  }

  async getCallHistory(params: {
    userId: string;
    cursor?: string;
    limit?: number;
  }) {
    const limit = Math.min(params.limit ?? 20, 100);

    const qb = this.callRepo
      .createQueryBuilder('call')
      .where('(call.callerId = :uid OR call.receiverId = :uid)', {
        uid: params.userId,
      })
      .orderBy('call.createdAt', 'DESC')
      .take(limit + 1);

    if (params.cursor) {
      const anchor = await this.callRepo.findOne({
        where: { id: params.cursor },
      });
      if (anchor) {
        qb.andWhere('call.createdAt < :cursorDate', {
          cursorDate: anchor.createdAt,
        });
      }
    }

    const rows    = await qb.getMany();
    const hasMore = rows.length > limit;
    const items   = hasMore ? rows.slice(0, limit) : rows;

    return {
      items,
      nextCursor: hasMore ? (items[items.length - 1]?.id ?? null) : null,
      hasMore,
    };
  }

  async getMissedCalls(userId: string): Promise<Call[]> {
    return this.callRepo.find({
      where: { receiverId: userId, status: CallStatus.MISSED },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }


  private async findByRoom(roomId: string): Promise<Call> {
    const call = await this.callRepo.findOne({ where: { roomId } });
    if (!call) throw new NotFoundException(`Call not found for room: ${roomId}`);
    return call;
  }

  private async findById(callId: string): Promise<Call> {
    const call = await this.callRepo.findOne({ where: { id: callId } });
    if (!call) throw new NotFoundException(`Call not found: ${callId}`);
    return call;
  }

  private assertReceiver(call: Call, userId: string, action: string) {
    if (call.receiverId !== userId) {
      throw new ForbiddenException(`Only the receiver can ${action} this call`);
    }
  }

  private assertParticipant(call: Call, userId: string) {
    if (call.callerId !== userId && call.receiverId !== userId) {
      throw new ForbiddenException('Not a participant of this call');
    }
  }

  private assertStatus(call: Call, allowed: CallStatus[], action: string) {
    if (!allowed.includes(call.status)) {
      throw new BadRequestException(
        `Cannot ${action} a call with status: ${call.status}`,
      );
    }
  }

  private applyEnd(call: Call): Promise<Call> {
    const endedAt   = new Date();
    call.status     = CallStatus.ENDED;
    call.endedAt    = endedAt;
    call.duration   = call.startedAt
      ? Math.floor((endedAt.getTime() - call.startedAt.getTime()) / 1000)
      : 0;
    return this.callRepo.save(call);
  }

  async missCallByRoom(roomId: string, userId: string): Promise<Call> {
  const call = await this.findByRoom(roomId);
  // Only mark missed if still ringing — idempotent otherwise
  if (call.status !== CallStatus.INITIATED) return call;

  call.status  = CallStatus.MISSED;
  call.endedAt = new Date();
  call.duration = 0;
  return this.callRepo.save(call);
}
}