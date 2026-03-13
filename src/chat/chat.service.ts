import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Chat } from './entity/chat.entity';
import Pusher from 'pusher';

@Injectable()
export class ChatService {
  private readonly pusher: Pusher;

  constructor(
    @InjectRepository(Chat)
    private readonly chatRepository: Repository<Chat>,
  ) {
    this.pusher = new Pusher({
      appId: process.env.PUSHER_APP_ID!,
      key: process.env.PUSHER_KEY!,
      secret: process.env.PUSHER_SECRET!,
      cluster: process.env.PUSHER_CLUSTER!,
      useTLS: true,
    });
  }

  async sendMessage(payload: { senderId: string; receiverId: string; message: string }) {
  const chat = this.chatRepository.create(payload);
  const savedChat = await this.chatRepository.save(chat);

  await this.pusher.trigger(
    `private-chat-${payload.receiverId}`,
    'new-message',
    savedChat,
  );

  return savedChat;
}


  async getMessages(senderId: string, receiverId: string) {
    return this.chatRepository.find({
      where: [
        { senderId, receiverId },
        { senderId: receiverId, receiverId: senderId }, // swap for conversation
      ],
      order: { createdAt: 'ASC' },
    });
  }
}
