import type { Clock } from '../../common/time/clock';
import type { UsersRepository } from '../users/users.repository';
import type { SurveyResponsesRepository } from './responses.repository';
import { SurveyResponsesService } from './responses.service';
import { organizerAuth } from '../../../test/support/auth-context';

const NOW = new Date('2026-09-22T09:00:00.000Z');
const auth = organizerAuth();

describe('SurveyResponsesService — the feedback summary (US-MSG-08)', () => {
  let repo: jest.Mocked<SurveyResponsesRepository>;
  let service: SurveyResponsesService;

  beforeEach(() => {
    repo = {
      ratingsFor: jest.fn().mockResolvedValue([5, 4]),
      npsScoresFor: jest.fn().mockResolvedValue([10, 9, 7, 3]),
      reachFor: jest.fn().mockResolvedValue({ asked: 4, answered: 1 }),
    } as unknown as jest.Mocked<SurveyResponsesRepository>;
    const users = {} as unknown as UsersRepository;
    const clock: Clock = { now: () => NOW };
    service = new SurveyResponsesService(repo, users, clock);
  });

  it('adds who was asked, how many of them answered, and the NPS to the rating summary', async () => {
    await expect(service.summary(auth, { eventId: 'e1' })).resolves.toEqual({
      responses: 2,
      average: 4.5,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
      asked: 4,
      completionRate: 25,
      nps: { answers: 4, promoters: 2, passives: 1, detractors: 1, score: 25 },
    });
  });

  it('reads every figure for the same workspace and the same scope', async () => {
    // An average for one event over a completion for all of them would be two
    // figures on one screen that describe different things.
    const scope = { eventId: 'e1', surveyId: 7 };
    await service.summary(auth, scope);
    expect(repo.ratingsFor).toHaveBeenCalledWith(1, scope);
    expect(repo.npsScoresFor).toHaveBeenCalledWith(1, scope);
    expect(repo.reachFor).toHaveBeenCalledWith(1, scope);
  });

  it('reports no NPS, not 0, when nobody answered a recommendation question', async () => {
    repo.npsScoresFor.mockResolvedValue([]);
    const summary = await service.summary(auth, {});
    expect(summary.nps.score).toBeNull();
    expect(summary.nps.answers).toBe(0);
  });

  it('reports no completion rate, not 0%, when the thank-you reached nobody', async () => {
    repo.reachFor.mockResolvedValue({ asked: 0, answered: 0 });
    const summary = await service.summary(auth, { eventId: 'e1' });
    expect(summary.asked).toBe(0);
    expect(summary.completionRate).toBeNull();
  });
});
