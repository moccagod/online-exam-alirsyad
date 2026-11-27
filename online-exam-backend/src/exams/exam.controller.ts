import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  BadRequestException,
  Req,
  UseGuards,
  Query,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { ExamService } from './exam.service';
import { ExamStudentsService } from './exam-student.service';

@Controller('exams')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ExamController {
  constructor(
    private readonly examService: ExamService,
    private readonly examStudentsService: ExamStudentsService,
  ) {}

  private normalizeExamDate(date: string | Date): string {
    const raw = String(date ?? '').trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return `${raw}T00:00:00`;
    return raw;
  }

  @Post()
  @Roles(Role.ADMIN, Role.GURU)
  async create(@Body() body: any, @Req() req: any) {
    const createdBy = req.user?.sub;

    if (!body.title || !body.date || !body.duration || !body.subject_id || !body.type) {
      throw new BadRequestException(
        'Missing required fields: title, date, duration, subject, or type',
      );
    }

    const formattedDate = this.normalizeExamDate(body.date);

    return this.examService.create({
      ...body,
      date: formattedDate,
      created_by: createdBy,
    }, req.user);
  }

  @Get()
  @Roles(Role.ADMIN, Role.GURU)
  async getAll(
    @Query('search') search = '',
    @Query('sort') sort = 'title',
    @Query('order') order: 'asc' | 'desc' = 'asc',
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('categoryId') categoryId = '',
    @Req() req: any,
  ) {
    return this.examService.getDataWithPagination(search, sort, order, Number(page), Number(limit), req.user, categoryId);
  }

  @Get('today')
  async getToday(
    @Req() req: any,
    @Query('search') search = '',
    @Query('sort') sort = 'title',
    @Query('order') order: 'asc' | 'desc' = 'asc',
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Query('debug') debug = '0',
  ) {
    const userlogin = req.user?.sub;
    return this.examService.getTodayExamsWithPagination(
      userlogin,
      search,
      sort,
      order,
      Number(page),
      Number(limit),
      debug === '1',
    );
  }

  @Get(':id/recalculate')
  @Roles(Role.ADMIN)
  preview(@Param('id') id: string,@Req() req:any) {
    return this.examService.recalculate(id,req.user.sub);
  }

  @Post(':id/recalculate')
  @Roles(Role.ADMIN)
  recalculate(@Param('id') id: string,@Body('changes') changes:any[],@Req() req:any) {
    if (!Array.isArray(changes)) throw new BadRequestException();
    return this.examService.recalculate(id,req.user.sub,changes);
  }

  @Get(':id/control')
  @Roles(Role.ADMIN, Role.GURU)
  async control(@Param('id') id: string, @Req() req: any) {
    await this.examService.assertCanAccessExam(id, req.user);
    return this.examService.control(id);
  }

  @Post(':id/teacher')
  @Roles(Role.ADMIN)
  teacher(@Param('id') id: string, @Body('teacher') teacher:string) {
    return this.examService.assignTeacher(id,teacher);
  }

  @Post(':id/control')
  @Roles(Role.ADMIN, Role.GURU)
  async schedule(@Param('id') id: string, @Body() body: any, @Req() req: any) {
    await this.examService.assertCanAccessExam(id, req.user);
    return this.examService.schedule(id, body);
  }

  @Post(':id/unlock')
  @Roles(Role.ADMIN, Role.GURU)
  async unlock(@Param('id') id: string, @Body('session') session: string, @Req() req: any) {
    await this.examService.assertCanAccessExam(id, req.user);
    return this.examService.unlock(id, session);
  }

  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    const data = await this.examService.findById(id, req.user);
    if (!data) throw new BadRequestException(`Exam ${id} not found`);
    return data;
  }

  @Get(':id/questions')
  @Roles(Role.ADMIN, Role.GURU)
  async getExamQuestions(@Param('id') examId: string, @Req() req: any) {
    return this.examService.getExamQuestions(examId, req.user);
  }

  @Put(':id')
  @Roles(Role.ADMIN, Role.GURU)
  async update(@Param('id') id: string, @Body() dto: any, @Req() req: any) {
    return this.examService.update(id, {
      ...dto,
      ...(dto.date ? { date: this.normalizeExamDate(dto.date) } : {}),
      updated_at: new Date(),
      updated_by: req.user?.sub,
    }, req.user);
  }

  @Delete(':id')
  @Roles(Role.ADMIN, Role.GURU)
  async softDelete(@Param('id') id: string, @Req() req: any) {
    return this.examService.softDelete(id, req.user?.sub, req.user);
  }

  @Get(':id/students')
  @Roles(Role.ADMIN, Role.GURU)
  async getStudents(@Param('id') examId: string, @Req() req: any, @Query('page') page?: string, @Query('limit') limit?: string) {
    await this.examService.assertCanAccessExam(examId, req.user);
    if (page === undefined) return this.examStudentsService.getExamStudents(examId);
    const pageNumber = Number(page);
    const pageLimit = limit === undefined ? 10 : Number(limit);
    if (!Number.isInteger(pageNumber) || pageNumber < 1 || !Number.isInteger(pageLimit) || pageLimit < 1 || pageLimit > 100) {
      throw new BadRequestException('Parameter halaman peserta tidak valid.');
    }
    return this.examStudentsService.getExamStudents(examId, pageNumber, pageLimit);
  }

  @Post(':id/students/sync')
  @Roles(Role.ADMIN)
  async syncStudents(@Param('id') examId: string, @Req() req: any) {
    await this.examService.assertCanAccessExam(examId, req.user);
    return this.examStudentsService.syncClassStudents(examId, req.user?.sub);
  }

  @Post(':id/students')
  @Roles(Role.ADMIN, Role.GURU)
  async assignStudents(@Param('id') examId: string, @Body('studentIds') studentIds: string[], @Req() req: any) {
    await this.examService.assertCanAccessExam(examId, req.user);
    const createdBy = req.user?.sub;
    return this.examStudentsService.assignStudents(examId, studentIds, createdBy);
  }
}
