import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import type { EventsService } from '../events/events.service';
import type { SurveysRepository } from './surveys.repository';
import { SurveysService } from './surveys.service';

const auth = { organizationId: 7, userId: 'u-1' } as AuthContext;
const SURVEY = 12;

/** A survey as the repository reports it, with the version the editor loaded. */
const stored = (version: number) => ({
  id: SURVEY,
  eventId: 'evt-1',
  title: 'After the keynote',
  status: 'draft' as const,
  version,
  questions: [
    { id: 1, type: 'rating' as const, prompt: 'How was it?', options: [] },
  ],
  responseCount: null,
});

describe('SurveysService.update, when two organizers save the same survey', () => {
  let repo: jest.Mocked<SurveysRepository>;
  let service: SurveysService;

  beforeEach(() => {
    repo = {
      byId: jest.fn(() => Promise.resolve(stored(4))),
      update: jest.fn(() => Promise.resolve(true)),
    } as unknown as jest.Mocked<SurveysRepository>;
    service = new SurveysService(repo, {} as EventsService);
  });

  it('passes the version the editor loaded through to the write', async () => {
    await service.update(auth, SURVEY, {
      title: 'Edited',
      questions: stored(4).questions,
      version: 4,
    });

    expect(repo.update).toHaveBeenCalledWith(7, SURVEY, expect.anything(), 4);
  });

  /*
   * THE LOST UPDATE THIS EXISTS FOR, and why it was total rather than partial.
   *
   * `update` deleted every row in `survey_questions` for the survey and
   * re-inserted the submitted set. So two organizers editing one survey did not
   * merely overwrite a title: whoever saved second replaced the whole question
   * list with the one their browser had loaded, and the other's added question
   * was gone with no error, no conflict and nothing in the response to notice.
   *
   * A stale version must therefore be refused BEFORE the delete, not reported
   * after it.
   */
  it('refuses a save built on a version somebody else has moved past', async () => {
    repo.update.mockResolvedValue(false);

    const refused = (await service
      .update(auth, SURVEY, {
        title: 'Edited',
        questions: stored(4).questions,
        version: 4,
      })
      .catch((error: unknown) => error)) as DomainException;

    expect(refused).toBeInstanceOf(DomainException);
    expect(refused.getStatus()).toBe(409);
    // Plain `CONFLICT` with a reader-facing sentence, exactly as ticketing's
    // optimistic lock reports its own stale write — the remedy is "reload",
    // which the message already says, so a dedicated code would buy nothing.
    expect(refused.message).toMatch(/reload/i);
  });

  it('does not re-read and return the survey after refusing', async () => {
    repo.update.mockResolvedValue(false);
    await service
      .update(auth, SURVEY, { title: 'Edited', questions: [], version: 4 })
      .catch(() => undefined);

    // `byId` is called once for the pre-check and not again: returning the row
    // after a refused write would read as though the save had landed.
    expect(repo.byId).toHaveBeenCalledTimes(1);
  });
});
