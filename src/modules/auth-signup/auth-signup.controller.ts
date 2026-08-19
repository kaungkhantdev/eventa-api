import { Body, Controller, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/decorators/public.decorator';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import { ApiData } from '../../common/http/api-data.decorator';
import { RegisterDto } from './dto/register.dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { VerifyEmailResponseDto } from './dto/verify-email-response.dto';
import { SignupService } from './auth-signup.service';

/** Organizer sign-up and email confirmation (US-ACC-01). */
@ApiTags('auth')
@Controller()
export class AuthSignupController {
  constructor(private readonly signup: SignupService) {}

  @Public()
  @Post('auth/register')
  @HttpCode(HttpStatus.ACCEPTED)
  @ResponseMessage('Check your inbox to confirm your email.')
  @ApiData(RegisterResponseDto, HttpStatus.ACCEPTED)
  register(@Body() dto: RegisterDto): Promise<RegisterResponseDto> {
    return this.signup.register({
      name: dto.name,
      email: dto.email,
      password: dto.password,
      organizationName: dto.organizationName,
      persona: dto.persona,
    });
  }

  @Public()
  @Post('auth/verify-email')
  @HttpCode(HttpStatus.OK)
  @ResponseMessage('Email confirmed.')
  @ApiData(VerifyEmailResponseDto)
  verifyEmail(@Body() dto: VerifyEmailDto): Promise<VerifyEmailResponseDto> {
    return this.signup.verifyEmail(dto.token);
  }
}
