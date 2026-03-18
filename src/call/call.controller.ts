import { Controller } from '@nestjs/common';
import { MessagePattern, Payload } from '@nestjs/microservices';
import { CallService } from './call.service';
import { CreateCallDto } from './dto/create-call.dto';

@Controller()
export class CallController {
  constructor(private readonly callService: CallService) {}

  @MessagePattern({ cmd: 'start_call' })
  handleStartCall(@Payload() data: CreateCallDto) {
    return this.callService.createCall(data);
  }

  @MessagePattern({ cmd: 'get_call_by_room' })
  handleGetCallByRoom(@Payload() data: { roomId: string }) {
    return this.callService.getCallByRoom(data.roomId);
  }

  @MessagePattern({ cmd: 'accept_call_by_room' })
  handleAcceptByRoom(@Payload() data: { roomId: string; userId: string }) {
    return this.callService.acceptCallByRoom(data.roomId, data.userId);
  }

  @MessagePattern({ cmd: 'reject_call_by_room' })
  handleRejectByRoom(@Payload() data: { roomId: string; userId: string }) {
    return this.callService.rejectCallByRoom(data.roomId, data.userId);
  }

  @MessagePattern({ cmd: 'end_call_by_room' })
  handleEndByRoom(@Payload() data: { roomId: string; userId: string }) {
    return this.callService.endCallByRoom(data.roomId, data.userId);
  }

  @MessagePattern({ cmd: 'accept_call' })
  handleAcceptCall(@Payload() data: { callId: string; userId: string }) {
    return this.callService.acceptCall(data.callId, data.userId);
  }

  @MessagePattern({ cmd: 'reject_call' })
  handleRejectCall(
    @Payload() data: { callId: string; userId: string; reason?: string },
  ) {
    return this.callService.rejectCall(data.callId, data.userId);
  }

  @MessagePattern({ cmd: 'cancel_call' })
  handleCancelCall(@Payload() data: { callId: string; userId: string }) {
    return this.callService.cancelCall(data.callId, data.userId);
  }

  @MessagePattern({ cmd: 'end_call' })
  handleEndCall(
    @Payload() data: { callId: string; userId: string; reason?: string },
  ) {
    return this.callService.endCall(data.callId, data.userId);
  }

  @MessagePattern({ cmd: 'get_call_history' })
  handleGetHistory(
    @Payload() data: { userId: string; cursor?: string; limit?: number },
  ) {
    return this.callService.getCallHistory(data);
  }

  @MessagePattern({ cmd: 'get_missed_calls' })
  handleGetMissed(@Payload() data: { userId: string }) {
    return this.callService.getMissedCalls(data.userId);
  }

  @MessagePattern({ cmd: 'miss_call_by_room' })
  handleMissByRoom(@Payload() data: { roomId: string; userId: string }) {
    return this.callService.missCallByRoom(data.roomId, data.userId);
  }
}