import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiForbiddenResponse, ApiTags } from '@nestjs/swagger';
import { ApiErrorDto } from '../../common/errors/error-envelope';
import { ApiData, ApiPage } from '../../common/http/api-data.decorator';
import { Paginated } from '../../common/http/paginated';
import { ResponseMessage } from '../../common/decorators/response-message.decorator';
import type { AuthContext } from '../auth/auth.types';
import { CurrentAuth } from '../../common/decorators/current-auth.decorator';
import {
  Permission,
  RequirePermissions,
} from '../../common/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { EventCategoriesService } from './event-categories.service';
import { CategoryResponseDto } from './dto/category-response.dto';
import { CreateCategoryDto } from './dto/create-category.dto';
import { ListCategoriesQueryDto } from './dto/list-categories.query.dto';
import { UpdateCategoryDto } from './dto/update-category.dto';

@ApiTags('categories')
@ApiBearerAuth()
@ApiForbiddenResponse({
  description: 'Admin persona or setSettings permission missing',
  type: ApiErrorDto,
})
@UseGuards(AdminGuard, PermissionsGuard)
@Controller('categories')
export class EventCategoriesController {
  constructor(private readonly categories: EventCategoriesService) {}

  @Post()
  @RequirePermissions(Permission.setSettings)
  @HttpCode(HttpStatus.CREATED)
  @ResponseMessage('Category created.')
  @ApiData(CategoryResponseDto, HttpStatus.CREATED)
  create(
    @CurrentAuth() auth: AuthContext,
    @Body() dto: CreateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categories.createCategory(actorOf(auth), dto);
  }

  @Get()
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Categories retrieved.')
  @ApiPage(CategoryResponseDto)
  list(
    @CurrentAuth() auth: AuthContext,
    @Query() query: ListCategoriesQueryDto,
  ): Promise<Paginated<CategoryResponseDto>> {
    return this.categories.listCategories(actorOf(auth), query);
  }

  @Get(':id')
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Category retrieved.')
  @ApiData(CategoryResponseDto)
  get(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<CategoryResponseDto> {
    return this.categories.getCategory(actorOf(auth), id);
  }

  @Patch(':id')
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Category updated.')
  @ApiData(CategoryResponseDto)
  update(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateCategoryDto,
  ): Promise<CategoryResponseDto> {
    return this.categories.updateCategory(actorOf(auth), id, dto);
  }

  @Delete(':id')
  @RequirePermissions(Permission.setSettings)
  @ResponseMessage('Category deleted.')
  remove(
    @CurrentAuth() auth: AuthContext,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<void> {
    return this.categories.deleteCategory(actorOf(auth), id);
  }
}

/** The authenticated principal slice the categories service needs. */
function actorOf(auth: AuthContext) {
  return { organizationId: auth.organizationId, userId: auth.userId };
}
