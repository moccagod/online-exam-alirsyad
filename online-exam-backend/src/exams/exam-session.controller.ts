import {
  Controller,
  Post, Body,
  Param,
  UploadedFile,
  BadRequestException,
  UseGuards,
  UseInterceptors,
  Req
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { ExamSessionService } from './exam-session.service';
import { Roles } from '../common/decorators/roles.decorator';
import { RolesGuard } from '../common/guards/roles.guard';
import { Role } from '../common/enums/role.enum';
import type { Request } from 'express';

const maxVideoUploadBytes =
  Number(process.env.MAX_EXAM_VIDEO_UPLOAD_MB || 45) * 1024 * 1024;

@Controller('exam-sessions')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.SISWA)
export class ExamSessionController {
  constructor(private readonly examSessionService: ExamSessionService) {}

  /**
   * Upload video ke Supabase Storage
   */
  @Post(':sessionId/upload-video')
  @UseInterceptors(FileInterceptor('file', {
    limits: {
      fileSize: maxVideoUploadBytes,
      files: 1,
    },
  }))
  async uploadVideo(
    @Param('sessionId') sessionId: string,
    @UploadedFile() file: Express.Multer.File,
    @Req() req: Request
  ) {
    if (!file) {
      throw new BadRequestException('File rekaman tidak ditemukan');
    }

    const user = (req as any).user;
    if (!user?.sub) {
      throw new BadRequestException('User tidak terautentikasi');
    }

    return this.examSessionService.uploadVideo(sessionId, file, user);
  }

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
