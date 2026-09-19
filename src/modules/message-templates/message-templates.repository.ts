import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../../db/drizzle.constants';
import { messageTemplates } from '../../db/schema';
import { withTenant } from '../../db/tenant';
import type { MessageTemplateDefinition } from './message-template-catalog';

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
