import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/time/clock';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import { UsersRepository } from '../users/users.repository';
import {
  assertAnswers,
  completionOf,
  summarise,
  type FeedbackSummary,
  type SubmittedAnswer,
} from './response-rules';
import {
  SurveyResponsesRepository,
  type LiveSurvey,
  type ResponseRow,
} from './responses.repository';

/** A personal list, not an export — one event's feedback is bounded. */
const MAX_RESPONSES = 500;

export interface MySurvey {
  survey: LiveSurvey | null;
  /** True once this person has answered; the form is not offered twice. */
  answered: boolean;
}

/**
 * Answering a survey, and what the answers add up to (US-MSG-08/10).
 *
 * Identity is the signed-in ACCOUNT, resolved server-side from the token —
 * never from a parameter. Two things follow from that and neither is optional:
 * only somebody with a confirmed registration for the event is offered the
 * survey, and each of them answers once. Without both, a rating is a number
 * anyone with the link can move.
 */
@Injectable()
export class SurveyResponsesService {
  constructor(
    private readonly repo: SurveyResponsesRepository,
    private readonly users: UsersRepository,
    private readonly clock: Clock,
  ) {}

  async mySurvey(auth: AuthContext, eventId: string): Promise<MySurvey> {
    const survey = await this.repo.liveSurveyFor(
      eventId,
      await this.requireEmail(auth.userId),
    );
    if (!survey) return { survey: null, answered: false };
    return {
      survey,
      answered: await this.repo.hasAnswered(survey.id, auth.userId),
    };
  }

  async submit(
    auth: AuthContext,
    eventId: string,
    answers: SubmittedAnswer[],
  ): Promise<void> {
    const { survey, answered } = await this.mySurvey(auth, eventId);
    if (!survey) {
      throw DomainException.notFound('There is no survey open for this event.');
    }
    // 409 rather than a silent overwrite: the first answer is the honest one,
    // and quietly replacing it would let somebody move an average at will.
    if (answered) {
      throw DomainException.conflict('You have already answered this survey.');
    }
    assertAnswers(survey.questions, answers);
    await this.repo.submit(survey, auth.userId, answers, this.clock.now());
  }

  /**
   * The ratings, and how many of those asked answered. The post-event
   * thank-you is what asks — it carries the survey link — so the people it
   * reached are the denominator.
   */
  async summary(auth: AuthContext, eventId?: string): Promise<FeedbackSummary> {
    const [ratings, reach] = await Promise.all([
      this.repo.ratingsFor(auth.organizationId, eventId),
      this.repo.reachFor(auth.organizationId, eventId),
    ]);
    return { ...summarise(ratings), ...completionOf(reach) };
  }

  countsByEvent(
    auth: AuthContext,
  ): Promise<{ eventId: string; responses: number }[]> {
    return this.repo.countsByEvent(auth.organizationId);
  }

  list(
    auth: AuthContext,
    eventId: string,
    rating?: number,
  ): Promise<ResponseRow[]> {
    return this.repo.list(auth.organizationId, eventId, {
      rating,
      limit: MAX_RESPONSES,
    });
  }

  private async requireEmail(userId: string): Promise<string> {
    const profile = await this.users.findProfile(userId);
    if (!profile) throw DomainException.notFound('Account not found.');
    return profile.user.email;
  }
}
