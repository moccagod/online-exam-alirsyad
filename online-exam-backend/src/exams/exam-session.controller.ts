import {
  Controller,
  Post, Body,
  Param,
  BadRequestException,
  UseGuards,
  Req
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ExamSessionService } from './exam-session.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/enums/role.enum';

@Controller('exam-sessions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.SISWA)
export class ExamSessionController {
  constructor(private readonly examSessionService: ExamSessionService) {}

  /**
   * Memulai sesi ujian (dibuat 1x per siswa per ujian)
   */
  @Post(':examId/prepare')
  prepare(@Param('examId') id: string, @Body('token') token: string, @Req() req: any) {
    return this.examSessionService.prepare(id, req.user.sub, token, false);
  }

  @Post(':examId/start')
  start(@Param('examId') id: string, @Body('token') token: string, @Req() req: any) {
    return this.examSessionService.prepare(id, req.user.sub, token, true);
  }

  @Post(':sessionId/:action')
  attempt(@Param('sessionId') id: string, @Param('action') action: string, @Body() body: any, @Req() req: any) {
    if (!['draft','violation','review'].includes(action)) throw new BadRequestException();
    return this.examSessionService.attempt(id, req.user.sub, action, body);
  }

}
