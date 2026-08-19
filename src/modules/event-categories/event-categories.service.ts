import { Injectable } from '@nestjs/common';
import { DomainException } from '../../common/errors/domain.exception';
import { Paginated } from '../../common/http/paginated';
import { pickDefined } from '../../common/util/pick-defined';
import type { EventActor } from '../events/events.types';
import { CategoryResponseDto } from './dto/category-response.dto';
import { toCategoryResponse } from './event-categories.mapper';
import { EventCategoriesRepository } from './event-categories.repository';
import type {
  CategoryRow,
  CreateCategoryInput,
  ListCategoriesOptions,
  ListCategoriesQuery,
  NewCategoryValues,
  UpdateCategoryInput,
} from './event-categories.types';

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/** Fields a PATCH may set on a category. */
const UPDATABLE_KEYS: (keyof NewCategoryValues & keyof UpdateCategoryInput)[] =
  ['name', 'icon', 'color', 'description'];

/** Manage the workspace's event categories (Events & Program context). */
@Injectable()
export class EventCategoriesService {
  constructor(private readonly repo: EventCategoriesRepository) {}

  /** Create a category; the name must be unique in the workspace (else 409). */
  async createCategory(
    actor: EventActor,
    input: CreateCategoryInput,
  ): Promise<CategoryResponseDto> {
    const name = input.name.trim();
    await this.assertNameFree(actor.organizationId, name);
    const values: NewCategoryValues = {
      organizationId: actor.organizationId,
      name,
      icon: input.icon,
      color: input.color,
      description: input.description ?? null,
    };
    return toCategoryResponse(await this.repo.insert(values), 0);
  }

  /** The org's categories, searchable/sortable, each with its live event count. */
  async listCategories(
    actor: EventActor,
    query: ListCategoriesQuery,
  ): Promise<Paginated<CategoryResponseDto>> {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(
      MAX_LIMIT,
      Math.max(1, query.limit ?? DEFAULT_LIMIT),
    );
    const options: ListCategoriesOptions = {
      limit,
      offset: (page - 1) * limit,
      sort: query.sort ?? 'name',
      ...(query.q ? { q: query.q } : {}),
    };
    const { items, total } = await this.repo.list(
      actor.organizationId,
      options,
    );
    const dtos = items.map((c) => toCategoryResponse(c, c.eventCount));
    return Paginated.of(dtos, total, page, limit);
  }

  /** A single category with its live event count (404 if not in the org). */
  async getCategory(
    actor: EventActor,
    id: number,
  ): Promise<CategoryResponseDto> {
    const found = await this.repo.findWithCount(actor.organizationId, id);
    if (!found) throw this.notFound(id);
    return toCategoryResponse(found, found.eventCount);
  }

  /** Edit a category (optimistic-concurrency guarded); changes reflect everywhere. */
  async updateCategory(
    actor: EventActor,
    id: number,
    input: UpdateCategoryInput,
  ): Promise<CategoryResponseDto> {
    const category = await this.load(actor.organizationId, id);
    if (input.version !== undefined && input.version !== category.version) {
      throw this.stale();
    }
    if (input.name !== undefined) {
      await this.assertNameFree(actor.organizationId, input.name.trim(), id);
    }
    const updated = await this.repo.update(
      actor.organizationId,
      id,
      this.buildValues(input),
      category.version,
    );
    if (!updated) throw this.stale();
    const eventCount = await this.repo.countEvents(actor.organizationId, id);
    return toCategoryResponse(updated, eventCount);
  }

  /** Delete a category — blocked while any event still uses it (409 with count). */
  async deleteCategory(actor: EventActor, id: number): Promise<void> {
    await this.load(actor.organizationId, id);
    const inUse = await this.repo.countEvents(actor.organizationId, id);
    if (inUse > 0) {
      throw DomainException.conflict(
        `This category has ${inUse} events. Move them to another category before deleting.`,
      );
    }
    await this.repo.softDelete(actor.organizationId, id);
  }

  private buildValues(input: UpdateCategoryInput): Partial<NewCategoryValues> {
    const values = pickDefined(input, UPDATABLE_KEYS);
    if (values.name !== undefined) values.name = values.name.trim();
    return values;
  }

  private async assertNameFree(
    organizationId: number,
    name: string,
    excludeId?: number,
  ): Promise<void> {
    if (await this.repo.nameExists(organizationId, name, excludeId)) {
      throw DomainException.conflict(
        'A category with this name already exists in your workspace.',
      );
    }
  }

  private async load(organizationId: number, id: number): Promise<CategoryRow> {
    const category = await this.repo.findCategory(organizationId, id);
    if (!category) throw this.notFound(id);
    return category;
  }

  private notFound(id: number): DomainException {
    return DomainException.notFound(
      `Category ${id} not found in this workspace.`,
    );
  }

  private stale(): DomainException {
    return DomainException.conflict(
      'This category changed elsewhere. Reload and try again.',
    );
  }
}
