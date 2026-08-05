import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData } from '../../common/http/api-data.decorator';
import { MessageResponseDto } from '../../common/http/message-response.dto';
import type { AuthContext } from '../auth/auth.types';
import { AccountDeletionService } from './account-deletion.service';
import { DeleteAccountDto } from './dto/delete-account.dto';
import { DeletionWarningDto } from './dto/deletion-warning.dto';

/**
 * Settings → danger zone (US-DISC-14). Both routes act on the CALLER's own
 * account — the id comes from the token, never the path.
 */
@ApiTags('account')
@Controller('me/account')
export class AccountDeletionController {
  constructor(private readonly deletion: AccountDeletionService) {}

  @Get('deletion')
  @ApiBearerAuth()
  @ResponseMessage('Deletion warning retrieved.')
  @ApiData(DeletionWarningDto)
  warning(@CurrentAuth() auth: AuthContext): Promise<DeletionWarningDto> {
    return this.deletion.warning(auth);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ResponseMessage('Account deletion scheduled.')
  @ApiData(MessageResponseDto)
  @ApiForbiddenResponse({
    description: 'Identity re-verification failed — nothing was deleted',
    type: ApiErrorDto,
  })
  remove(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: DeleteAccountDto,
  ): Promise<MessageResponseDto> {
    return this.deletion.deleteAccount(auth, {
      password: dto.password,
      code: dto.code,
    });
  }
}
