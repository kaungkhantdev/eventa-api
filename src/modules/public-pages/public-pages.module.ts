import { Module } from '@nestjs/common';
import { PublicPagesController } from './public-pages.controller';
import { PublicPagesRepository } from './public-pages.repository';
import { PublicPagesService } from './public-pages.service';

/**
 * The anonymous public event page (US-PAGE-01…08) — the surface a shared link,
 * a search result or the Discover listing lands on. Read-only; it starts
 * registration but never books, holds seats or exposes attendee data.
 */
@Module({
  controllers: [PublicPagesController],
  providers: [PublicPagesService, PublicPagesRepository],
  exports: [PublicPagesService],
})
export class PublicPagesModule {}
