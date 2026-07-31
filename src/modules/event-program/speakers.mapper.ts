import { SpeakerResponseDto } from './dto/speaker-response.dto';
import type { SpeakerRow } from './speakers.types';

/** Map a `speakers` row to its response DTO (edge boundary). */
export function toSpeakerResponse(s: SpeakerRow): SpeakerResponseDto {
  return {
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
