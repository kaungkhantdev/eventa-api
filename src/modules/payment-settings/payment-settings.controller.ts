import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { DomainException } from '../../common/errors/domain.exception';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { ApiData, ApiList } from '../../common/http/api-data.decorator';
import { paymentMethodEnum } from '../../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { ConnectPaymentDto } from './dto/connect-payment.dto';
import { PaymentSettingsResponseDto } from './dto/payment-settings-response.dto';
import { SetPaymentMethodDto } from './dto/set-payment-method.dto';
import { UpdatePaymentPreferencesDto } from './dto/update-payment-preferences.dto';
import {
  PaymentMethodsService,
  type PaymentMethodView,
} from './payment-methods.service';
import { PaymentSettingsService } from './payment-settings.service';
import type { PaymentMethod } from './payment-settings.types';
import type { VerifyResult } from './ports/payment-provider.port';

/**
 * Settings → Payments (US-SET-08/09/10). Connecting or disconnecting the account
 * needs `setIntegrations`; preferences and method toggles need `setSettings` —
 * both Admin-only in the default roles, and enforced server-side.
 */
@ApiTags('payment-settings')
@ApiBearerAuth()
@ApiForbiddenResponse({ description: 'Requires Admin', type: ApiErrorDto })
@UseGuards(PermissionsGuard)
@Controller('payment-settings')
export class PaymentSettingsController {
  constructor(
    private readonly settings: PaymentSettingsService,
    private readonly methods: PaymentMethodsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Payment settings retrieved.')
  @ApiData(PaymentSettingsResponseDto)
  get(@CurrentAuth() auth: AuthContext): Promise<PaymentSettingsResponseDto> {
    return this.settings.get(auth.organizationId);
  }

  @Post('connect')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payment account connected.')
  @ApiData(PaymentSettingsResponseDto)
  connect(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: ConnectPaymentDto,
  ): Promise<PaymentSettingsResponseDto> {
    return this.settings.connect(auth.organizationId, dto);
  }

  @Post('test')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Connection tested.')
  test(@CurrentAuth() auth: AuthContext): Promise<VerifyResult> {
    return this.settings.testConnection(auth.organizationId);
  }

  @Post('disconnect')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payment account disconnected.')
  @ApiData(PaymentSettingsResponseDto)
  disconnect(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PaymentSettingsResponseDto> {
    return this.settings.disconnect(auth.organizationId);
  }

  @Patch()
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Payment preferences updated.')
  @ApiData(PaymentSettingsResponseDto)
  updatePreferences(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: UpdatePaymentPreferencesDto,
  ): Promise<PaymentSettingsResponseDto> {
    return this.settings.updatePreferences(auth.organizationId, dto);
  }

  @Get('methods')
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Payment methods retrieved.')
  @ApiList(Object)
  listMethods(@CurrentAuth() auth: AuthContext): Promise<PaymentMethodView[]> {
    return this.methods.list(auth.organizationId);
  }

  @Patch('methods/:method')
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Payment method updated.')
  @ApiList(Object)
  setMethod(
    @CurrentAuth() auth: AuthContext,
    @Param('method') method: string,
    @Body() dto: SetPaymentMethodDto,
  ): Promise<PaymentMethodView[]> {
    return this.methods.setEnabled(
      auth.organizationId,
      assertKnownMethod(method),
      dto.enabled,
    );
  }
}

/** Path params are strings; narrow to the schema enum or 404. */
function assertKnownMethod(value: string): PaymentMethod {
  const known = paymentMethodEnum.enumValues.find((m) => m === value);
  if (!known) {
    throw DomainException.notFound(`Unknown payment method "${value}".`);
  }
  return known;
}
