import type { EventResponseDto } from '../events/dto/event-response.dto';
import type { EventsService } from '../events/events.service';
import type { SessionsService } from '../event-program/sessions.service';
import type { SpeakersService } from '../event-program/speakers.service';
import type { EventSeatingService } from '../event-seating/event-seating.service';
import type { TicketingService } from '../ticketing/ticketing.service';
import { EventDuplicationService } from './event-duplication.service';

const actor = { organizationId: 1, userId: 'u1' };
const copy = { id: 'new1', name: 'Gala (Copy)' } as unknown as EventResponseDto;

describe('EventDuplicationService', () => {
  let events: jest.Mocked<Pick<EventsService, 'duplicateBasics'>>;
  let tickets: jest.Mocked<Pick<TicketingService, 'cloneForEvent'>>;
  let speakers: jest.Mocked<Pick<SpeakersService, 'cloneForEvent'>>;
  let sessions: jest.Mocked<Pick<SessionsService, 'cloneForEvent'>>;
  let seating: jest.Mocked<Pick<EventSeatingService, 'cloneForEvent'>>;
  let service: EventDuplicationService;
  const speakerMap = new Map([['s1', 'ns1']]);

  beforeEach(() => {
    events = { duplicateBasics: jest.fn().mockResolvedValue(copy) };
    tickets = { cloneForEvent: jest.fn().mockResolvedValue(undefined) };
    speakers = { cloneForEvent: jest.fn().mockResolvedValue(speakerMap) };
    sessions = { cloneForEvent: jest.fn().mockResolvedValue(undefined) };
    seating = { cloneForEvent: jest.fn().mockResolvedValue(undefined) };
    service = new EventDuplicationService(
      events as unknown as EventsService,
      tickets as unknown as TicketingService,
      speakers as unknown as SpeakersService,
      sessions as unknown as SessionsService,
      seating as unknown as EventSeatingService,
    );
  });

  it('drafts the copy, then clones tickets, speakers, agenda, and seating onto it', async () => {
    const res = await service.duplicate(actor, 'src1');
    expect(events.duplicateBasics).toHaveBeenCalledWith(actor, 'src1');
    expect(tickets.cloneForEvent).toHaveBeenCalledWith(actor, 'src1', 'new1');
    expect(speakers.cloneForEvent).toHaveBeenCalledWith(actor, 'src1', 'new1');
    // The agenda copy is re-linked using the speaker id-map from the speaker copy.
    expect(sessions.cloneForEvent).toHaveBeenCalledWith(
      actor,
      'src1',
      'new1',
      speakerMap,
    );
    expect(seating.cloneForEvent).toHaveBeenCalledWith(actor, 'src1', 'new1');
    expect(res).toBe(copy);
  });

  it('clones no content when the source event cannot be drafted (404 bubbles up)', async () => {
    events.duplicateBasics.mockRejectedValue(new Error('not found'));
    await expect(service.duplicate(actor, 'missing')).rejects.toThrow();
    expect(tickets.cloneForEvent).not.toHaveBeenCalled();
    expect(speakers.cloneForEvent).not.toHaveBeenCalled();
  });
});
