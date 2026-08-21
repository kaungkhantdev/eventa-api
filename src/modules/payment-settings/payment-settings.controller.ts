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
import { paymentMethodEnum, paymentModeEnum } from '../../db/schema';
import type { AuthContext } from '../auth/auth.types';
import { PaymentSettingsResponseDto } from './dto/payment-settings-response.dto';
import { SaveKeysDto } from './dto/save-keys.dto';
import { SetPaymentMethodDto } from './dto/set-payment-method.dto';
import { UpdatePaymentPreferencesDto } from './dto/update-payment-preferences.dto';
import {
  PaymentMethodsService,
  type PaymentMethodView,
} from './payment-methods.service';
import {
  PaymentKeysService,
  type StoredKeysView,
} from './payment-keys.service';
import { PaymentSettingsService } from './payment-settings.service';
import type { PaymentMethod, PaymentMode } from './payment-settings.types';
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
    private readonly keys: PaymentKeysService,
    private readonly methods: PaymentMethodsService,
  ) {}

  @Get()
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Payment settings retrieved.')
  @ApiData(PaymentSettingsResponseDto)
  get(@CurrentAuth() auth: AuthContext): Promise<PaymentSettingsResponseDto> {
    return this.settings.get(auth.organizationId);
  }

  /**
   * Save this workspace's own Stripe keys. The secret is stored encrypted and
   * never comes back — the response carries a masked tail, which is all the
   * screen needs to say WHICH key is saved.
   */
  @Post('keys')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payment keys saved.')
  @ApiData(Object)
  saveKeys(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: SaveKeysDto,
  ): Promise<StoredKeysView> {
    return this.keys.saveKeys(auth.organizationId, dto);
  }

  /** What is stored for one mode — masked. Never the key itself. */
  @Get('keys/:mode')
  @RequirePermissions(Permission.setIntegrations)
  @ResponseMessage('Payment keys retrieved.')
  @ApiData(Object)
  storedKeys(
    @CurrentAuth() auth: AuthContext,
    @Param('mode') mode: string,
  ): Promise<StoredKeysView> {
    return this.keys.describe(auth.organizationId, assertKnownMode(mode));
  }

  @Post('test')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Connection tested.')
  test(@CurrentAuth() auth: AuthContext): Promise<VerifyResult> {
    return this.keys.testConnection(auth.organizationId);
  }

  @Post('disconnect')
  @RequirePermissions(Permission.setIntegrations)
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Payment account disconnected.')
  @ApiData(PaymentSettingsResponseDto)
  async disconnect(
    @CurrentAuth() auth: AuthContext,
  ): Promise<PaymentSettingsResponseDto> {
    await this.keys.disconnect(auth.organizationId);
    return this.settings.get(auth.organizationId);
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
function assertKnownMode(value: string): PaymentMode {
  const known = paymentModeEnum.enumValues.find((m) => m === value);
  if (!known) throw DomainException.notFound(`Unknown payment mode "${value}".`);
  return known;
}

/** Path params are strings; narrow to the schema enum or 404. */
function assertKnownMethod(value: string): PaymentMethod {
  const known = paymentMethodEnum.enumValues.find((m) => m === value);
  if (!known) {
    throw DomainException.notFound(`Unknown payment method "${value}".`);
  }
  return known;
}
