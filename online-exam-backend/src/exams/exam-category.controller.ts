import { Body, Controller, Get, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ExamCategoryService } from './exam-category.service';

@Controller('exam-categories')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExamCategoryController {
  constructor(private readonly categories: ExamCategoryService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GURU)
  list() {
    return this.categories.list();
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body('name') name: unknown, @Req() req: any) {
    return this.categories.create(name, req.user.sub);
  }

  @Put(':id')
  @Roles(Role.ADMIN)
  rename(@Param('id') id: string, @Body('name') name: unknown, @Req() req: any) {
    return this.categories.rename(id, name, req.user.sub);
  }
}
