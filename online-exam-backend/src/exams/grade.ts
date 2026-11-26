import { SupabaseClient } from '@supabase/supabase-js';
import { InternalServerErrorException } from '@nestjs/common';

export async function gradingWeights(db: SupabaseClient, exam: string) {
  const archive = await db
    .from('exam_delivery')
    .select('mc_weight,essay_weight')
    .eq('exam_id', exam)
    .maybeSingle();
  if (archive.error)
    throw new InternalServerErrorException(archive.error.message);
  if (archive.data?.mc_weight != null) return archive.data;
  const current = await db
    .from('exams')
    .select('multiple_choice_weight,essay_weight')
    .eq('id', exam)
    .single();
  if (current.error)
    throw new InternalServerErrorException(current.error.message);
  return {
    mc_weight: current.data.multiple_choice_weight,
    essay_weight: current.data.essay_weight,
  };
}

export function grade(
  questions: any[],
  answers: any[],
  weights: { mc_weight: number; essay_weight: number },
  preserveTeacherMarks = false,
) {
  const byId = new Map(answers.map((a) => [String(a.question_id), a]));
  let correct = 0,
    mc = 0,
    essays = 0,
    essayTotal = 0,
    pending = false;
  const scoredAnswers = questions.map((q) => {
    const entry = byId.get(String(q.id));
    const answer = String(entry?.answer ?? '');
    const normalized = answer.trim().toLowerCase();
    if (q.type === 'multiple_choice') {
      const is_correct =
        Boolean(normalized) &&
        (preserveTeacherMarks && typeof entry?.is_correct === 'boolean'
          ? entry.is_correct
          : normalized ===
            String(q.answer ?? '')
              .trim()
              .toLowerCase());
      mc++;
      if (is_correct) correct++;
      return { question_id: q.id, answer, is_correct };
    }
    essays++;
    const score = normalized ? entry?.essay_score : 0;
    if (
      typeof score !== 'number' ||
      score < 0 ||
      score > 100 ||
      !Number.isFinite(score)
    )
      pending = true;
    else essayTotal += score;
    return {
      question_id: q.id,
      answer,
      is_correct: null,
      essay_score: score ?? null,
    };
  });
  const pg = mc ? (correct * 100) / mc : 0;
  const es = essays ? essayTotal / essays : 0;
  const total =
    mc && essays
      ? (pg * weights.mc_weight + es * weights.essay_weight) / 100
      : mc
        ? pg
        : es;
  return {
    scoredAnswers,
    totalScore: pending || !questions.length ? null : Math.round(total),
  };
}
