import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { CallStatus } from '../enums/call-status';
export enum CallType {
  AUDIO = 'audio',
  VIDEO = 'video',
}

@Entity('calls')
@Index(['callerId', 'createdAt'])
@Index(['receiverId', 'createdAt'])
export class Call {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'caller_id' })
  callerId: string;

  @Column({ name: 'receiver_id' })
  receiverId: string;

  @Column({ unique: true, name: 'room_id' })
  roomId: string;

  @Column({
    type: 'enum',
    enum: CallType,
    name: 'call_type',
  })
  callType: CallType;

  @Column({
    type: 'enum',
    enum: CallStatus,
    default: CallStatus.INITIATED,
  })
  status: CallStatus;

  /** Set when receiver accepts — used to compute duration */
  @Column({ type: 'timestamptz', nullable: true, name: 'started_at' })
  startedAt: Date | null;

  /** Set when either party ends/rejects the call */
  @Column({ type: 'timestamptz', nullable: true, name: 'ended_at' })
  endedAt: Date | null;

  /** Call length in seconds, computed on end */
  @Column({ nullable: true, type: 'int' })
  duration: number | null;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}