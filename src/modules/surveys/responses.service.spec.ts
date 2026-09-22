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
      reachFor: jest.fn().mockResolvedValue({ asked: 4, answered: 1 }),
    } as unknown as jest.Mocked<SurveyResponsesRepository>;
    const users = {} as unknown as UsersRepository;
    const clock: Clock = { now: () => NOW };
    service = new SurveyResponsesService(repo, users, clock);
  });

  it('adds who was asked and how many of them answered to the rating summary', async () => {
    await expect(service.summary(auth, 'e1')).resolves.toEqual({
      responses: 2,
      average: 4.5,
      distribution: { 1: 0, 2: 0, 3: 0, 4: 1, 5: 1 },
      asked: 4,
      completionRate: 25,
    });
  });

  it('reads both halves for the same workspace and the same event', async () => {
    // An average for one event over a completion for all of them would be two
    // figures on one screen that describe different things.
    await service.summary(auth, 'e1');
    expect(repo.ratingsFor).toHaveBeenCalledWith(1, 'e1');
    expect(repo.reachFor).toHaveBeenCalledWith(1, 'e1');
  });

  it('reports no completion rate, not 0%, when the thank-you reached nobody', async () => {
    repo.reachFor.mockResolvedValue({ asked: 0, answered: 0 });
    const summary = await service.summary(auth, 'e1');
    expect(summary.asked).toBe(0);
    expect(summary.completionRate).toBeNull();
  });
});
