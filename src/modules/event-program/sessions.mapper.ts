import { SessionResponseDto } from './dto/session-response.dto';
import type { SessionRow, SessionSpeakerRef } from './sessions.types';

/** Map a `sessions` row (+ its speaker links + an optional warning) to the DTO. */
export function toSessionResponse(
  s: SessionRow,
  speakers: SessionSpeakerRef[],
  warning: string | null,
): SessionResponseDto {
  return {
    id: s.id,
    eventId: s.eventId,
    day: s.day,
    startTime: s.startTime,
    endTime: s.endTime,
    title: s.title,
    type: s.type,
    room: s.room,
    color: s.color,
    sortOrder: s.sortOrder,
    speakers,
    warning,
    createdAt: s.createdAt.toISOString(),
    version: s.version,
  };
}
