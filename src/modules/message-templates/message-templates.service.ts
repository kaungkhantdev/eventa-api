import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import type { AuthContext } from '../auth/auth.types';
import {
  MESSAGE_TEMPLATE_CATALOG,
  templateBySlug,
  type MessageChannel,
  type MessageTemplateDefinition,
  type TemplateDelivery,
} from './message-template-catalog';
import { MessageTemplatesRepository } from './message-templates.repository';

/** A message with this workspace's decision folded in. */
export interface MessageTemplateView {
  slug: string;
  title: string;
  description: string;
  channels: MessageChannel[];
  delivery: TemplateDelivery;
  expected: boolean;
  active: boolean;
}

/** No row stored means the message is on — see the catalog's note. */
const DEFAULT_ACTIVE = true;

/**
 * The automated messages a workspace sends, and the one thing an organizer can
 * change about them today: whether they send at all (US-MSG-01).
 *
 * Editing the wording is US-MSG-02 and is deliberately absent: eventa-worker
 * renders built-in EN/TH copy and never reads the wording columns, so an editor
 * here would save text that nothing would ever send.
 */
@Injectable()
export class MessageTemplatesService {
  constructor(private readonly repo: MessageTemplatesRepository) {}

  async list(auth: AuthContext): Promise<MessageTemplateView[]> {
    const rows = await this.repo.list(auth.organizationId);
    const stored = new Map(rows.map((row) => [row.slug, row]));
    // Driven by the CATALOG, not by the rows: a slug that has left the catalog
    // must not resurrect itself as a card nobody can explain.
    return MESSAGE_TEMPLATE_CATALOG.map((definition) => ({
      ...view(definition),
      active: stored.get(definition.slug)?.active ?? DEFAULT_ACTIVE,
    }));
  }

  async setActive(
    auth: AuthContext,
    slug: string,
    active: boolean,
  ): Promise<MessageTemplateView[]> {
    const definition = assertKnown(slug);
    assertSwitchable(definition);
    await this.repo.setActive(auth.organizationId, definition, active);
    return this.list(auth);
  }
}

function view(definition: MessageTemplateDefinition): MessageTemplateView {
  return {
    slug: definition.slug,
    title: definition.title,
    description: definition.description,
    channels: definition.channels,
    delivery: definition.delivery,
    expected: definition.expected,
    active: DEFAULT_ACTIVE,
  };
}

function assertKnown(slug: string): MessageTemplateDefinition {
  const definition = templateBySlug(slug);
  if (!definition) {
    throw DomainException.notFound(`“${slug}” is not an automated message.`);
  }
  return definition;
}

/**
 * A switch that moves and changes nothing is worse than no switch, so the one
 * case where it would change nothing is refused with the reason.
 */
function assertSwitchable(definition: MessageTemplateDefinition): void {
  if (definition.delivery === 'planned') {
    throw DomainException.validation(
      `“${definition.title}” isn’t being sent yet, so there is nothing to switch off.`,
    );
  }
}
