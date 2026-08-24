import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClaudiaPoll, ClaudiaPollQuestion } from './types';

/**
 * ClaudiaPollView — the real voting UI: 4 question types, time/status gating, required-field
 * validation, results-visibility gating. Ported from SafeSpaces' real polls/poll_questions/
 * poll_options tables and its actual 453-line PollView.tsx (checked both before this).
 *
 * distribution_list_id/event_id/send_to_all (real SafeSpaces targeting mechanisms) and
 * result_image_url/result_article_id (real result-announcement features) are NOT ported --
 * named plainly.
 *
 * Schema proven correct with real tests before this UI was written, including the genuinely
 * tricky case: 'after_vote' results-visibility depends on whether THIS user has responded, not
 * just whether anyone has -- verified with three separate real sessions (before voting: hidden;
 * the same user after voting: visible; a different, non-voting user: still hidden), and a real
 * forge attempt on responses (a session claiming a different user's id) refused by RLS.
 */
export interface ClaudiaPollViewCopy {
  loading: string;
  notFound: string;
  progressLabel: string;
  requiredBadge: string;
  anonymousNote: string;
  submitButton: string;
  submitting: string;
  thankYou: string;
  thankYouBody: string;
  viewResultsButton: string;
  resultsRestricted: string;
  resultsAfterClose: string;
  closedHeading: string;
  closedBody: string;
  notStartedHeading: string;
  notStartedBody: string;
  startingSoonHeading: string;
  expiredHeading: string;
  expiredBody: string;
  ratingLow: string;
  ratingHigh: string;
  textPlaceholder: string;
}
const DEFAULT_COPY: ClaudiaPollViewCopy = {
  loading: 'Loading\u2026',
  notFound: 'Poll not found.',
  progressLabel: 'Progress',
  requiredBadge: 'Required',
  anonymousNote: 'Your responses are anonymous.',
  submitButton: 'Submit responses',
  submitting: 'Submitting\u2026',
  thankYou: 'Thank you!',
  thankYouBody: 'Your responses have been submitted.',
  viewResultsButton: 'View results',
  resultsRestricted: 'Results are restricted.',
  resultsAfterClose: 'Results will be available after the poll closes.',
  closedHeading: 'Poll closed',
  closedBody: 'This poll is no longer accepting responses.',
  notStartedHeading: 'Poll not started',
  notStartedBody: "This poll hasn't been launched yet.",
  startingSoonHeading: 'Poll starting soon',
  expiredHeading: 'Poll expired',
  expiredBody: 'The deadline for this poll has passed.',
  ratingLow: '1 \u2013 Low',
  ratingHigh: '10 \u2013 High',
  textPlaceholder: 'Enter your response\u2026',
};

interface Answer { optionId?: string; optionIds?: string[]; textResponse?: string; ratingValue?: number }

export interface ClaudiaPollViewProps {
  supabase: SupabaseClient;
  pollId: string;
  currentUserId: string;
  onViewResults?: () => void;
  copy?: Partial<ClaudiaPollViewCopy>;
}

export default function ClaudiaPollView({ supabase, pollId, currentUserId, onViewResults, copy: copyProp }: ClaudiaPollViewProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const [poll, setPoll] = useState<ClaudiaPoll | null>(null);
  const [hasCompleted, setHasCompleted] = useState(false);
  const [canViewResults, setCanViewResults] = useState(false);
  const [answers, setAnswers] = useState<Record<string, Answer>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data: pollRow } = await supabase.from('claudia_polls').select('*').eq('id', pollId).single();
      if (!pollRow) { setPoll(null); return; }
      const { data: questions } = await supabase.from('claudia_poll_questions').select('*, options:claudia_poll_options(*)').eq('poll_id', pollId).order('display_order');
      setPoll({ ...pollRow, questions: (questions ?? []).map((q: any) => ({ ...q, options: (q.options ?? []).sort((a: any, b: any) => a.display_order - b.display_order) })) });

      const { count } = await supabase.from('claudia_poll_responses').select('*', { count: 'exact', head: true }).eq('poll_id', pollId).eq('user_id', currentUserId);
      setHasCompleted((count ?? 0) > 0);

      const { data: canView } = await supabase.rpc('claudia_poll_can_view_results', { p_poll_id: pollId });
      setCanViewResults(Boolean(canView));
    })();
  }, [supabase, pollId, currentUserId]);

  if (poll === null) return <p className="dim">{copy.loading}</p>;

  function isActive(): boolean {
    if (!poll || poll.status !== 'active') return false;
    if (poll.end_date && new Date(poll.end_date) < new Date()) return false;
    if (poll.start_date && new Date(poll.start_date) > new Date()) return false;
    return true;
  }

  function validate(): boolean {
    if (!poll) return false;
    return poll.questions.every((q) => {
      if (!q.is_required) return true;
      const a = answers[q.id];
      if (!a) return false;
      if (q.question_type === 'single_choice') return Boolean(a.optionId);
      if (q.question_type === 'multiple_choice') return Boolean(a.optionIds?.length);
      if (q.question_type === 'text') return Boolean(a.textResponse?.trim());
      if (q.question_type === 'rating') return a.ratingValue !== undefined;
      return true;
    });
  }

  async function submit() {
    if (!poll || !validate()) return;
    setSubmitting(true); setError(null);
    const rows: { poll_id: string; question_id: string; user_id: string; option_id: string | null; text_response: string | null; rating_value: number | null }[] = poll.questions.flatMap((q) => {
      const a = answers[q.id];
      if (!a) return [];
      if (q.question_type === 'multiple_choice' && a.optionIds?.length) {
        return a.optionIds.map((optionId) => ({ poll_id: poll.id, question_id: q.id, user_id: currentUserId, option_id: optionId, text_response: null, rating_value: null }));
      }
      return [{
        poll_id: poll.id, question_id: q.id, user_id: currentUserId,
        option_id: a.optionId ?? null, text_response: a.textResponse ?? null, rating_value: a.ratingValue ?? null,
      }];
    });
    const { error: e } = await supabase.from('claudia_poll_responses').insert(rows);
    setSubmitting(false);
    if (e) { setError(e.message); return; }
    setSubmitted(true);
    const { data: canView } = await supabase.rpc('claudia_poll_can_view_results', { p_poll_id: pollId });
    setCanViewResults(Boolean(canView));
  }

  if (hasCompleted || submitted) {
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <h2>{copy.thankYou}</h2>
        <p className="dim">{copy.thankYouBody}</p>
        {canViewResults ? (
          <button type="button" className="btn" onClick={onViewResults}>{copy.viewResultsButton}</button>
        ) : (
          <p className="dim" style={{ fontSize: '.82rem' }}>
            {poll.results_visibility === 'after_close' ? copy.resultsAfterClose : copy.resultsRestricted}
          </p>
        )}
      </div>
    );
  }

  if (!isActive()) {
    const now = new Date();
    const notStarted = poll.status === 'draft';
    const startingSoon = poll.start_date && new Date(poll.start_date) > now;
    const closed = poll.status === 'closed';
    return (
      <div className="card" style={{ padding: 24, textAlign: 'center' }}>
        <h2>{closed ? copy.closedHeading : notStarted ? copy.notStartedHeading : startingSoon ? copy.startingSoonHeading : copy.expiredHeading}</h2>
        <p className="dim">{closed ? copy.closedBody : notStarted ? copy.notStartedBody : startingSoon ? poll.start_date : copy.expiredBody}</p>
        {closed && canViewResults && <button type="button" className="btn" onClick={onViewResults}>{copy.viewResultsButton}</button>}
      </div>
    );
  }

  const answeredCount = poll.questions.filter((q) => answers[q.id]).length;
  const progress = poll.questions.length ? Math.round((answeredCount / poll.questions.length) * 100) : 0;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card" style={{ padding: 16 }}>
        <h2 style={{ margin: 0 }}>{poll.title}</h2>
        {poll.description && <p className="dim" style={{ marginTop: 6 }}>{poll.description}</p>}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }}>
            <span>{copy.progressLabel}</span><span>{progress}%</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: 'var(--claudia-kernel-surface, #f0f0f0)', marginTop: 4 }}>
            <div style={{ height: '100%', width: `${progress}%`, borderRadius: 3, background: 'var(--claudia-kernel-brand, #333)' }} />
          </div>
        </div>
      </div>

      {error && <p className="err">{error}</p>}

      {poll.questions.map((q, i) => (
        <QuestionCard key={q.id} question={q} index={i} answer={answers[q.id]} copy={copy}
          onChange={(a) => setAnswers((prev) => ({ ...prev, [q.id]: a }))} />
      ))}

      <div className="card" style={{ padding: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        {poll.is_anonymous && <span className="dim" style={{ fontSize: '.82rem' }}>{copy.anonymousNote}</span>}
        <button type="button" className="btn" disabled={!validate() || submitting} onClick={submit}>
          {submitting ? copy.submitting : copy.submitButton}
        </button>
      </div>
    </div>
  );
}

function QuestionCard({ question, index, answer, onChange, copy }: {
  question: ClaudiaPollQuestion; index: number; answer?: Answer; onChange: (a: Answer) => void; copy: ClaudiaPollViewCopy;
}) {
  const rating = answer?.ratingValue ?? 5;
  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
        <p style={{ margin: 0, fontWeight: 600, fontSize: '.92rem' }}>
          <span className="dim">Q{index + 1}.</span> {question.question_text}
        </p>
        {question.is_required && <span className="dim" style={{ fontSize: '.72rem' }}>{copy.requiredBadge}</span>}
      </div>

      {question.question_type === 'single_choice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {question.options.map((o) => (
            <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.88rem' }}>
              <input type="radio" name={question.id} checked={answer?.optionId === o.id} onChange={() => onChange({ optionId: o.id })} />
              {o.option_text}
            </label>
          ))}
        </div>
      )}

      {question.question_type === 'multiple_choice' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {question.options.map((o) => {
            const checked = answer?.optionIds?.includes(o.id) ?? false;
            return (
              <label key={o.id} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '.88rem' }}>
                <input type="checkbox" checked={checked} onChange={() => {
                  const ids = answer?.optionIds ?? [];
                  onChange({ optionIds: checked ? ids.filter((id) => id !== o.id) : [...ids, o.id] });
                }} />
                {o.option_text}
              </label>
            );
          })}
        </div>
      )}

      {question.question_type === 'text' && (
        <textarea className="field" rows={3} placeholder={copy.textPlaceholder}
          value={answer?.textResponse ?? ''} onChange={(e) => onChange({ textResponse: e.target.value })} />
      )}

      {question.question_type === 'rating' && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem' }} className="dim">
            <span>{copy.ratingLow}</span><span>{copy.ratingHigh}</span>
          </div>
          <input type="range" min={1} max={10} step={1} value={rating}
            onChange={(e) => onChange({ ratingValue: Number(e.target.value) })} style={{ width: '100%' }} />
          <p style={{ textAlign: 'center', margin: 0 }}><strong style={{ fontSize: '1.4rem' }}>{rating}</strong><span className="dim">/10</span></p>
        </div>
      )}
    </div>
  );
}
