import { useEffect, useMemo, useRef, useState } from 'react';
import { ClipboardList, Trophy, BookOpenCheck, Play, Timer } from 'lucide-react';
import { useStudentApplication } from '../../hooks/useSchool';
import { useToast } from '../../context/ToastContext';
import { PageHeader, Card, Spinner, EmptyState, Badge, Button } from '../../components/ui';
import { Modal } from '../../components/ui-extras';
import { fetchPublishedAssessments } from '../../lib/queries';
import { supabase } from '../../lib/supabase';
import { termLabel } from '../../lib/format';

export default function StudentAssessments() {
  const { application, loading } = useStudentApplication();
  const toast = useToast();

  const [assessments, setAssessments] = useState([]);
  const [summaries, setSummaries] = useState({});
  const [active, setActive] = useState(null); // attempt being taken
  const [answers, setAnswers] = useState({});
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const [remaining, setRemaining] = useState(0);
  const [startingId, setStartingId] = useState(null);
  const [result, setResult] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!application) return;
    let cancelled = false;
    (async () => {
      try {
        const [list, summaryRes] = await Promise.all([
          fetchPublishedAssessments(application.school_id, application.class_applying),
          supabase.rpc('get_my_assessment_summaries'),
        ]);
        if (cancelled) return;
        setAssessments(list);
        const byAssessment = {};
        (summaryRes.data || []).forEach((s) => {
          byAssessment[s.assessment_id] = s;
        });
        setSummaries(byAssessment);
      } catch (err) {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [application]);

  // Countdown while an attempt is in progress
  useEffect(() => {
    if (!active) return undefined;
    setRemaining(active.durationMinutes * 60);
    const timer = setInterval(() => {
      setRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          submitNow();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.attemptId]);

  const startAttempt = async (assessment) => {
    setStartingId(assessment.id);
    try {
      const { data, error } = await supabase.rpc('start_assessment_attempt', {
        p_assessment_id: assessment.id,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      if (data?.status === 'completed') {
        toast.info('Already completed', `You scored ${data.score}/${data.total_marks} (${data.score_percentage}%).`);
        refreshSummaries();
        return;
      }
      setAnswers({});
      setActive({
        attemptId: data.attempt_id,
        title: data.title || assessment.title,
        durationMinutes: Number(data.duration_minutes || 30),
        totalMarks: data.total_marks,
        passPercentage: data.pass_percentage,
        questions: data.questions || [],
      });
    } catch (err) {
      toast.error('Could not start assessment', err.message);
    } finally {
      setStartingId(null);
    }
  };

  const refreshSummaries = async () => {
    const { data } = await supabase.rpc('get_my_assessment_summaries');
    const byAssessment = {};
    (data || []).forEach((s) => {
      byAssessment[s.assessment_id] = s;
    });
    setSummaries(byAssessment);
  };

  const submitNow = async () => {
    if (!active || submitting) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.rpc('submit_assessment_attempt', {
        p_attempt_id: active.attemptId,
        p_answers: answersRef.current,
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      setResult(data);
      setActive(null);
      refreshSummaries();
    } catch (err) {
      toast.error('Could not submit', err.message);
    } finally {
      setSubmitting(false);
    }
  };

  const answeredCount = useMemo(() => Object.keys(answers).filter((k) => answers[k]).length, [answers]);

  if (loading) return <Spinner label="Loading assessments..." />;
  if (!application) return <EmptyState title="No student record" />;

  if (active) {
    const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
    const ss = String(remaining % 60).padStart(2, '0');
    return (
      <div>
        <PageHeader
          title={active.title}
          subtitle={`Answer all questions and submit. ${active.totalMarks ?? active.questions.length} questions.`}
          icon={BookOpenCheck}
          actions={
            <span className="inline-flex items-center gap-2 rounded-xl bg-brand-50 px-3 py-2 text-sm font-bold text-brand-700">
              <Timer className="h-4 w-4" aria-hidden="true" />
              {mm}:{ss}
            </span>
          }
        />
        <div className="space-y-4">
          {active.questions.map((q, qIndex) => (
            <Card key={q.id} className="p-5">
              <p className="text-sm font-bold text-slate-800">
                {qIndex + 1}. {q.question_text}
              </p>
              <div className="mt-3 space-y-2">
                {q.options.map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt.key }))}
                    className={`flex w-full items-center gap-3 rounded-xl border px-4 py-2.5 text-left text-sm transition-colors ${
                      answers[q.id] === opt.key
                        ? 'border-brand-400 bg-brand-50 text-brand-800 ring-2 ring-brand-100'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-brand-300'
                    }`}
                  >
                    <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-bold ${answers[q.id] === opt.key ? 'bg-brand-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                      {opt.key}
                    </span>
                    {opt.text}
                  </button>
                ))}
              </div>
            </Card>
          ))}
        </div>
        <div className="mt-6 flex items-center justify-between gap-3">
          <p className="text-sm text-slate-500">
            {answeredCount} of {active.questions.length} answered
          </p>
          <Button onClick={submitNow} loading={submitting} disabled={!answeredCount}>
            Submit assessment
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My Assessments" subtitle="Published class assessments and your completed scores." icon={ClipboardList} />

      {assessments.length ? (
        <div className="space-y-4">
          {assessments.map((assessment) => {
            const summary = summaries[assessment.id];
            const done = summary?.is_submitted || summary?.status === 'submitted' || summary?.status === 'passed' || summary?.status === 'failed';
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
                      {assessment.description ? <p className="mt-1 text-sm text-slate-500">{assessment.description}</p> : null}
                    </div>
                  </div>
                  {done ? (
                    <Badge tone="green">
                      <Trophy className="h-3.5 w-3.5" aria-hidden="true" />
                      Score: {summary?.score ?? '-'} / {summary?.total_marks ?? '-'} ({summary?.score_percentage ?? 0}%)
                    </Badge>
                  ) : summary ? (
                    <Badge tone="amber">In progress</Badge>
                  ) : (
                    <Badge tone="slate">Not attempted</Badge>
                  )}
                </div>
                <div className="mt-4 flex items-center justify-between border-t border-slate-50 pt-4">
                  <p className="text-xs text-slate-400">
                    {assessment.question_count} questions · {assessment.duration_minutes} min · Pass {assessment.pass_percentage ?? 50}%
                  </p>
                  <Button size="sm" onClick={() => startAttempt(assessment)} loading={startingId === assessment.id} disabled={startingId !== null}>
                    <Play className="h-3.5 w-3.5" aria-hidden="true" />
                    {done ? 'View score' : summary ? 'Continue' : 'Start'}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <EmptyState icon={ClipboardList} title="No assessments published" message="Your teachers have not published any assessments for your class yet." />
      )}

      <Modal open={!!result} onClose={() => setResult(null)} title="Assessment result" size="lg">
        {result ? (
          <div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center">
              <p className="text-4xl font-extrabold text-brand-700">{result.score_percentage ?? 0}%</p>
              <p className="mt-1 text-sm text-slate-500">
                You scored {result.score} out of {result.total_marks}
              </p>
              <div className="mt-3">
                <Badge tone={Number(result.score_percentage) >= Number(active?.passPercentage ?? 50) ? 'green' : 'red'}>
                  {Number(result.score_percentage) >= Number(active?.passPercentage ?? 50) ? 'PASSED' : 'FAILED'}
                </Badge>
              </div>
            </div>
            <div className="mt-5 max-h-[50vh] space-y-3 overflow-y-auto">
              {(result.review || []).map((r) => (
                <div key={r.id} className="rounded-xl border border-slate-100 p-4">
                  <p className="text-sm font-semibold text-slate-800">{r.question_text}</p>
                  <div className="mt-2 grid gap-1 text-xs text-slate-500 sm:grid-cols-2">
                    {(r.options || []).map((o) => (
                      <span key={o.key} className={r.chosen_key === o.key ? `font-bold ${r.correct ? 'text-emerald-600' : 'text-rose-600'}` : ''}>
                        {o.key}. {o.text}
                        {r.correct_text === o.text ? ' ✓' : ''}
                      </span>
                    ))}
                  </div>
                  {r.explanation ? <p className="mt-2 text-xs text-slate-400">Why: {r.explanation}</p> : null}
                  <p className={`mt-2 text-xs font-bold ${r.correct ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {r.correct ? 'Correct' : `You chose ${r.chosen_key || 'nothing'}`}
                  </p>
                </div>
              ))}
            </div>
            <div className="mt-5 flex justify-end">
              <Button variant="secondary" onClick={() => setResult(null)}>
                Close
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}