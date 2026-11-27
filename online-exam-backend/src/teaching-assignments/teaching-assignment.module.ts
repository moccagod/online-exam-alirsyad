import { Module } from '@nestjs/common';
import { SupabaseModule } from 'src/supabase/supabase.module';
import { TeachingAssignmentController } from './teaching-assignment.controller';
import { TeachingAssignmentService } from './teaching-assignment.service';

@Module({
  imports: [SupabaseModule],
  providers: [TeachingAssignmentService],
  controllers: [TeachingAssignmentController],
  exports: [TeachingAssignmentService],
})
export class TeachingAssignmentModule {}
