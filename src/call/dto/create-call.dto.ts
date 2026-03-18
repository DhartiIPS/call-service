import { IsString, IsEnum } from 'class-validator'
import { CallType } from '../entity/call.entity';

export class CreateCallDto {
  @IsString()
  callerId: string;

  @IsString()
  receiverId: string;

  @IsEnum(CallType)
  callType: CallType;
}
