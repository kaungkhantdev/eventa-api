import { Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipResponseEnvelope } from '../../common/decorators/skip-envelope.decorator';
import type { Env } from '../../config/env.validation';
import { CalendarConnectFlowService } from './calendar-connect-flow.service';
import { settingsReturnUrl } from './calendar-return-url';
import { REDIRECT_HEADERS } from '../../common/constants/calendar-connection.constants';

/**
 * Where Google's consent screen sends the browser back (US-MTG-08).
 *
 * `@Public` because it is a top-level browser navigation: the console keeps
 * its token in localStorage, so no Bearer header arrives here. What
 * authenticates the request is the `state` — see `CalendarConnectFlowService`.
 *
 * The first `@Res()` redirect in this API, and on purpose: every other route
 * answers JSON to the console, but this one answers a browser that needs to
 * land back on Settings. The parameters are raw `unknown` rather than a DTO,
 * so the global ValidationPipe can never turn a malformed callback into a
 * JSON 400 page; whatever arrives, the answer is a 302 to Settings with one
 * of three words, built only from PUBLIC_WEB_URL — never from the query, the
 * state or the Referer. `code`, `state` and `error` stay masked in the
 * request log (not in `LOGGABLE_QUERY_VALUES`).
 */
@ApiTags('calendar-connection')
@Controller('public/calendar-connection')
export class CalendarOAuthCallbackController {
  private readonly publicWebUrl: string;

  constructor(
    private readonly flow: CalendarConnectFlowService,
    config: ConfigService<Env, true>,
  ) {
    this.publicWebUrl = config.getOrThrow('PUBLIC_WEB_URL', { infer: true });
  }

  @Public()
  @Get('google/callback')
  @SkipResponseEnvelope()
  @ApiExcludeEndpoint()
  async callback(
    @Query('code') code: unknown,
    @Query('state') state: unknown,
    @Query('error') error: unknown,
    @Res() res: Response,
  ): Promise<void> {
    const outcome = await this.flow.complete({ code, state, error });
    res
      .set(REDIRECT_HEADERS)
      .redirect(302, settingsReturnUrl(this.publicWebUrl, outcome));
  }
}
