import { Controller, Post, Body, Get, Query } from '@nestjs/common';
import { ChatService } from './chat.service';
import { SendMessageDto } from './dto/send-message.dto';
import { MessagePattern, Payload } from '@nestjs/microservices';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @MessagePattern({ cmd: 'send_message' })
  async handleSendMessage(@Payload() payload: { senderId: string; receiverId: string; message: string }) {
    return this.chatService.sendMessage(payload);
  }

  @MessagePattern({ cmd: 'get_messages' })
  async getMessages(
    @Payload() payload: { senderId: string; receiverId: string },
  ) {
    return this.chatService.getMessages(payload.senderId, payload.receiverId);
  }
}
