import { useEffect, useState } from 'react';
import { ClipboardList, Trophy, BookOpenCheck } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { PageHeader, Card, Spinner, EmptyState, Badge } from '../../components/ui';
import { fetchPublishedAssessments, fetchAssessmentAttempts } from '../../lib/queries';
import { formatDateTime, termLabel } from '../../lib/format';

export default function StudentAssessments() {
  const { application, loading } = useStudentApplication();
  const [assessments, setAssessments] = useState([]);
  const [attempts, setAttempts] = useState([]);

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    Promise.all([
      fetchPublishedAssessments(application.school_id, application.class_applying),
      fetchAssessmentAttempts(application.student_id),
    ])
      .then(([a, at]) => {
        if (cancelled) return;
        setAssessments(a);
        setAttempts(at);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [application]);

  if (loading) return <Spinner label="Loading assessments..." />;
  if (!application) return <EmptyState title="No student record" />;

  const attemptsByAssessment = new Map(attempts.map((at) => [at.assessment_id, at]));

  return (
    <div>
      <PageHeader title="My Assessments" subtitle="Published class assessments and your completed scores." icon={ClipboardList} />

      {assessments.length ? (
        <div className="space-y-4">
          {assessments.map((assessment) => {
            const attempt = attemptsByAssessment.get(assessment.id);
            return (
              <Card key={assessment.id} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex items-start gap-3">
                    <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
                      <BookOpenCheck className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{assessment.title}</p>
                      <p className="mt-0.5 text-xs text-slate-400">
                        {assessment.subject} · {assessment.class_name} · {termLabel(assessment.term || 'First')}
                      </p>
                      {assessment.description ? (
                        <p className="mt-1 text-sm text-slate-500">{assessment.description}</p>
                      ) : null}
                    </div>
                  </div>
                  {attempt ? (
                    <Badge tone="green">
                      <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                      Score: {attempt.score ?? attempt.total_score ?? attempt.marks ?? '-'}
                    </Badge>
                  ) : (
                    <Badge tone="slate">Not attempted</Badge>
                  )}
                </div>

                {attempt ? (
                  <div className="mt-4 grid grid-cols-2 gap-3 border-t border-slate-50 pt-4 sm:grid-cols-4">
                    <Metric label="Correct" value={attempt.correct_count ?? attempt.score ?? '-'} />
                    <Metric label="Total questions" value={attempt.total_questions ?? '-'} />
                    <Metric label="Started" value={formatDateTime(attempt.started_at)} />
                    <Metric label="Completed" value={attempt.completed_at ? formatDateTime(attempt.completed_at) : '-'} />
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={ClipboardList}
          title="No assessments published"
          message="Your teachers have not published any assessments for your class yet."
        />
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-0.5 text-sm font-bold text-slate-800">{value}</p>
    </div>
  );
}