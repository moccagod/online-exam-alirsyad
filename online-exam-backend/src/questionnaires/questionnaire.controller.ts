import {
  Controller, UseInterceptors, UploadedFile,
  Get,
  Post,
  Put,
  Delete,
  Param,
  Body,
  BadRequestException,
  Query,
  InternalServerErrorException,
  UseGuards,
  Req,
  Res,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Role } from 'src/common/enums/role.enum';
import { RolesGuard } from 'src/common/guards/roles.guard';
import { QuestionnaireService } from './questionnaire.service';
import { Questionnaire } from './entities/questionnaire.entity';
import { CreateQuestionnaireDto } from './dto/create-questionnaire.dto';
import { UpdateQuestionnaireDto } from './dto/update-questionnaire.dto';
import type { Response } from 'express';

@Controller('exams/:examId/questionnaires')
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles(Role.ADMIN, Role.GURU)
export class QuestionnaireController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  @Get('packages')
  packages(@Param('examId') id: string, @Req() req: any) {
    return this.questionnaireService.packages(id,req.user);
  }

  @Post('package')
  link(@Param('examId') id: string, @Body('source') source: string, @Req() req: any) {
    return this.questionnaireService.link(id,source,req.user);
  }

  @Post('import')
  @UseInterceptors(FileInterceptor('file',{limits:{fileSize:20*1024*1024}}))
  import(@Param('examId') id: string, @UploadedFile() file: Express.Multer.File, @Query('save') save: string, @Req() req: any) {
    if (!file?.originalname.toLowerCase().endsWith('.xlsx')) throw new BadRequestException('Pilih berkas .xlsx');
    return this.questionnaireService.importWorkbook(id,req.user,file.buffer,save==='1');
  }

  /** -------------------------
   * CREATE QUESTION
   * ------------------------- */
  @Post()
  async create(
    @Param('examId') examId: string,
    @Body() dto: CreateQuestionnaireDto,
    @Req() req: any,
  ): Promise<Questionnaire> {
    const userId = req.user?.sub;

    if (!dto.question || !dto.type) {
      throw new BadRequestException('Missing required fields: question, type');
    }

    return this.questionnaireService.create({
      ...dto,
      exam_id: examId,
      created_by: userId,
    }, req.user);
  }

  /** -------------------------
   * GET ALL WITH PAGINATION
   * ------------------------- */
  @Get()
  async getAll(
    @Param('examId') examId: string,
    @Query('search') search = '',
    @Query('sort') sort = 'created_at',
    @Query('order') order: 'asc' | 'desc' = 'asc',
    @Query('page') page = '1',
    @Query('limit') limit = '10',
    @Req() req: any,
  ) {
    try {
      return await this.questionnaireService.getDataWithPagination(
        examId,
        search,
        sort,
        order,
        Number(page),
        Number(limit),
        req.user,
      );
    } catch (error) {
      throw new InternalServerErrorException(error.message);
    }
  }

  /** -------------------------
   * GET SINGLE QUESTION
   * ------------------------- */
  @Get(':id')
  async findOne(@Param('id') id: string, @Req() req: any) {
    return this.questionnaireService.findById(id, req.user);
  }

  /** -------------------------
   * UPDATE QUESTION
   * ------------------------- */
  @Put(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateQuestionnaireDto,
    @Req() req: any,
  ) {
    const userId = req.user?.sub;

    return this.questionnaireService.update(id, {
      ...dto,
      updated_by: userId,
    }, req.user);
  }

  /** -------------------------
   * SOFT DELETE QUESTION
   * ------------------------- */
  @Delete(':id')
  async softDelete(@Param('id') id: string, @Req() req: any) {
    const userId = req.user?.sub;

    return this.questionnaireService.softDelete(id, userId, req.user);
  }
}

@Controller('question-images')
@UseGuards(AuthGuard('jwt'))
export class QuestionImageController {
  constructor(private readonly questionnaireService: QuestionnaireService) {}

  @Get(':questionId/:name')
  async read(@Param('questionId') questionId: string, @Param('name') name: string, @Req() req: any, @Res() response: Response) {
    const image = await this.questionnaireService.readImportedImage(questionId,name,req.user);
    response.setHeader('Content-Type',image.contentType);
    response.setHeader('Cache-Control','private, max-age=300');
    response.send(image.buffer);
  }
}
