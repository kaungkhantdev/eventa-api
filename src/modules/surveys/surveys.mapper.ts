import type { SurveyDto } from './dto/survey.dto';
import type { SurveyWithQuestions } from './surveys.repository';

/** Row → wire. Ids are strings on the wire; bigints do not survive JSON. */
export function toSurvey(survey: SurveyWithQuestions): SurveyDto {
  return {
    id: String(survey.id),
    eventId: survey.eventId,
    title: survey.title,
    status: survey.status,
    createdAt: survey.createdAt.toISOString(),
    questions: survey.questions.map((question) => ({
      id: String(question.id),
      type: question.type,
      prompt: question.prompt,
      options: question.options,
    })),
  };
}
