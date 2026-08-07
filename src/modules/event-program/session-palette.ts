import { sessionColorEnum, sessionTypeEnum } from '../../db/schema';

type SessionType = (typeof sessionTypeEnum.enumValues)[number];
type SessionColor = (typeof sessionColorEnum.enumValues)[number];

/**
 * The agenda block palette (US-PROG-01): one colour per session type, owned by
 * the server so two Keynotes can never come back different colours.
 *
 * This used to be a free, nullable field on each session, which meant the
 * "consistent colour" the story asks for was whatever the caller happened to
 * send — or nothing at all. `Record` rather than a partial map, so adding a
 * session type without a colour fails to compile instead of rendering blank.
 */
const PALETTE: Record<SessionType, SessionColor> = {
  Keynote: 'blue',
  Panel: 'green',
  Workshop: 'amber',
  Talk: 'rose',
  Break: 'slate',
};

export function colourForType(type: SessionType): SessionColor {
  return PALETTE[type];
}
