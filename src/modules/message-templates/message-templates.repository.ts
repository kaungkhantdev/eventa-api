import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { messageTemplates } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { MessageTemplateDefinition } from './message-template-catalog';
import type { Wording } from './wording-rules';

export type MessageTemplateRow = typeof messageTemplates.$inferSelect;

/**
 * A workspace's deviations from the message catalog.
 *
 * Only rows a workspace has actually touched exist here, so most workspaces
 * have none — the catalog supplies the rest. The insert carries the catalog's
 * wording because `title` is NOT NULL and a row has to start somewhere;
 * US-MSG-02 is what will let an organizer change it.
 */
@Injectable()
export class MessageTemplatesRepository {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  list(organizationId: number): Promise<MessageTemplateRow[]> {
    return withTenant(this.db, organizationId, (tx) =>
      tx
        .select()
        .from(messageTemplates)
        .where(eq(messageTemplates.organizationId, organizationId)),
    );
  }

  /**
   * Save the organizer's own wording (US-MSG-02).
   *
   * Blank is stored as NULL, not as an empty string: the worker treats an
   * absent value as "use Eventa's own copy", and an empty string would send a
   * message with no subject rather than falling back.
   */
  async setWording(
    organizationId: number,
    definition: MessageTemplateDefinition,
    wording: Wording,
  ): Promise<void> {
    const columns = {
      emailSubjectEn: blankToNull(wording.en.subject),
      emailBodyEn: blankToNull(wording.en.body),
      emailSubjectTh: blankToNull(wording.th.subject),
      emailBodyTh: blankToNull(wording.th.body),
    };
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(messageTemplates)
        .values({
          organizationId,
          slug: definition.slug,
          title: definition.title,
          description: definition.description,
          channels: definition.channels,
          // The column defaults to on, so a first save of wording for a
          // message that is off by default would otherwise switch it on —
          // preparing the reminder's text would start mailing attendees.
          // Only on INSERT: once a row exists, the switch is the organizer's
          // and rewording must never move it.
          active: definition.defaultActive,
          ...columns,
        })
        .onConflictDoUpdate({
          target: [messageTemplates.organizationId, messageTemplates.slug],
          set: { ...columns, updatedAt: new Date() },
        });
    });
  }

  async setActive(
    organizationId: number,
    definition: MessageTemplateDefinition,
    active: boolean,
  ): Promise<void> {
    await withTenant(this.db, organizationId, async (tx) => {
      await tx
        .insert(messageTemplates)
        .values({
          organizationId,
          slug: definition.slug,
          title: definition.title,
          description: definition.description,
          channels: definition.channels,
          active,
        })
        .onConflictDoUpdate({
          target: [messageTemplates.organizationId, messageTemplates.slug],
          set: { active, updatedAt: new Date() },
        });
    });
  }
}

function blankToNull(value: string): string | null {
  return value.trim() || null;
}
