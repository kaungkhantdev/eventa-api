import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import { EventsService } from '../events/events.service';
import {
  SurveysRepository,
  type SurveyWithQuestions,
} from './surveys.repository';
import {
  assertAnswerable,
  assertTransition,
  type DraftQuestion,
  type SurveyStatus,
} from './survey-rules';

export interface SurveyInput {
  title: string;
  questions: DraftQuestion[];
}

/** A save, carrying the version the editor loaded. */
export interface SurveyUpdate extends SurveyInput {
  version: number;
}

/** Marks a duplicate as the fresh draft it is, rather than a second original. */
const COPY_SUFFIX = ' (copy)';

/**
 * Authoring and managing feedback surveys (US-MSG-09).
 *
 * Only the authoring half. Attendees answer in the portal, and their responses
 * are US-MSG-08/10 — nothing here reads or invents one, which is why a survey
 * created by this service honestly reports no responses rather than a zero that
 * might mean "none yet" or "we do not know".
 */
@Injectable()
export class SurveysService {
  constructor(
    private readonly repo: SurveysRepository,
    private readonly events: EventsService,
  ) {}

  list(auth: AuthContext, eventId?: string): Promise<SurveyWithQuestions[]> {
    return this.repo.list(auth.organizationId, eventId);
  }

  async create(
    auth: AuthContext,
    eventId: string,
    input: SurveyInput,
  ): Promise<SurveyWithQuestions> {
    // 404s if the event is not this workspace's — a survey must not be able to
    // attach itself to somebody else's event.
    await this.events.getEvent(
      { organizationId: auth.organizationId, userId: auth.userId },
      eventId,
    );
    assertAnswerable(input);
    const id = await this.repo.create(auth.organizationId, {
      eventId,
      ...input,
    });
    return this.require(auth, id);
  }

  /**
   * Save a survey, refusing a save built on a version somebody has moved past.
   *
   * Authoring replaces the whole question set, so a lost update here is not a
   * clobbered title — it is a deleted question. Two organizers with the editor
   * open both submit the list their browser loaded, and without this the second
   * save silently wrote the first one's addition out of existence.
   *
   * The refusal says "reload", which is the whole remedy, so it is a plain
   * conflict rather than its own error code — the same way
   * `TicketingService.stale()` reports the identical situation.
   */
  async update(
    auth: AuthContext,
    surveyId: number,
    input: SurveyUpdate,
  ): Promise<SurveyWithQuestions> {
    await this.require(auth, surveyId);
    assertAnswerable(input);
    const saved = await this.repo.update(
      auth.organizationId,
      surveyId,
      input,
      input.version,
    );
    if (!saved) {
      throw DomainException.conflict(
        'This survey changed elsewhere. Reload and try again.',
      );
    }
    return this.require(auth, surveyId);
  }

  async setStatus(
    auth: AuthContext,
    surveyId: number,
    status: SurveyStatus,
  ): Promise<SurveyWithQuestions> {
    const survey = await this.require(auth, surveyId);
    assertTransition(survey.status, status);
    // Going live is the moment it reaches people, so it is checked again here
    // even though every save checks it: a survey saved before a rule existed
    // must not slip out under it.
    if (status === 'live') assertAnswerable(survey);
    await this.repo.setStatus(auth.organizationId, surveyId, status);
    return this.require(auth, surveyId);
  }

  /** A copy starts as a DRAFT with no responses, whatever the original is. */
  async duplicate(
    auth: AuthContext,
    surveyId: number,
  ): Promise<SurveyWithQuestions> {
    const survey = await this.require(auth, surveyId);
    const id = await this.repo.create(auth.organizationId, {
      eventId: survey.eventId,
      title: `${survey.title}${COPY_SUFFIX}`,
      questions: survey.questions,
    });
    return this.require(auth, id);
  }

  async remove(auth: AuthContext, surveyId: number): Promise<void> {
    await this.require(auth, surveyId);
    await this.repo.remove(auth.organizationId, surveyId);
  }

  private async require(
    auth: AuthContext,
    surveyId: number,
  ): Promise<SurveyWithQuestions> {
    const survey = await this.repo.byId(auth.organizationId, surveyId);
    if (!survey) throw DomainException.notFound('Survey not found.');
    return survey;
  }
}
