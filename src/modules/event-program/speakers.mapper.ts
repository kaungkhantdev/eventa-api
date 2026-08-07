import { SpeakerResponseDto } from './dto/speaker-response.dto';
import type { SpeakerRow } from './speakers.types';

/**
 * Map a `speakers` row to its response DTO (edge boundary). `sessionCount`
 * defaults to 0 rather than being omitted: the directory always shows a number,
 * and a speaker booked into nothing is a real, displayable state.
 */
export function toSpeakerResponse(
  s: SpeakerRow,
  sessionCount = 0,
): SpeakerResponseDto {
  return {
    sessionCount,
    id: s.id,
    eventId: s.eventId,
    name: s.name,
    role: s.role,
    email: s.email,
    phone: s.phone,
    talkTitle: s.talkTitle,
    tag: s.tag,
    initials: s.initials,
    tone: s.tone,
    rating: s.rating,
    createdAt: s.createdAt.toISOString(),
    version: s.version,
  };
}
