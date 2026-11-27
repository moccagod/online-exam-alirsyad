import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { TeachingAssignmentService } from './teaching-assignment.service';

@Controller('teaching-assignments')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class TeachingAssignmentController {
  constructor(private readonly service: TeachingAssignmentService) {}

  @Get()
  @Roles(Role.ADMIN, Role.GURU)
  list(@Req() req: any) {
    return this.service.list(req.user);
  }

  @Post()
  @Roles(Role.ADMIN)
  create(@Body() body: any, @Req() req: any) {
    return this.service.create(body, req.user.sub);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  remove(@Param('id') id: string, @Req() req: any) {
    return this.service.remove(id, req.user.sub);
  }
}
