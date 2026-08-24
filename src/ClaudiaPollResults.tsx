import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { ClaudiaPoll, ClaudiaPollResultRow } from './types';

/**
 * ClaudiaPollResults — aggregate counts per option (and average rating for rating questions),
 * via the real claudia_poll_results RPC, which is itself gated by the same visibility check
 * ClaudiaPollView uses -- a caller not allowed to see results yet simply gets an empty set,
 * proven correct at the database level before this component was written.
 */
export interface ClaudiaPollResultsCopy {
  loading: string;
  restricted: string;
  averageLabel: string;
  responsesLabel: (n: number) => string;
}
const DEFAULT_COPY: ClaudiaPollResultsCopy = {
  loading: 'Loading\u2026',
  restricted: "Results aren't available to you yet.",
  averageLabel: 'Average',
  responsesLabel: (n) => `${n} ${n === 1 ? 'response' : 'responses'}`,
};

export interface ClaudiaPollResultsProps {
  supabase: SupabaseClient;
  pollId: string;
  copy?: Partial<ClaudiaPollResultsCopy>;
}

export default function ClaudiaPollResults({ supabase, pollId, copy: copyProp }: ClaudiaPollResultsProps) {
  const copy = { ...DEFAULT_COPY, ...copyProp };
  const [poll, setPoll] = useState<ClaudiaPoll | null>(null);
  const [rows, setRows] = useState<ClaudiaPollResultRow[] | null>(null);

  useEffect(() => {
    (async () => {
      const { data: pollRow } = await supabase.from('claudia_polls').select('*').eq('id', pollId).single();
      const { data: questions } = await supabase.from('claudia_poll_questions').select('*, options:claudia_poll_options(*)').eq('poll_id', pollId).order('display_order');
      if (pollRow) setPoll({ ...pollRow, questions: (questions ?? []).map((q: any) => ({ ...q, options: (q.options ?? []).sort((a: any, b: any) => a.display_order - b.display_order) })) });
      const { data } = await supabase.rpc('claudia_poll_results', { p_poll_id: pollId });
      setRows(data ?? []);
    })();
  }, [supabase, pollId]);

  if (poll === null || rows === null) return <p className="dim">{copy.loading}</p>;
  if (rows.length === 0 && poll.questions.some((q) => q.question_type !== 'text')) {
    return <p className="dim">{copy.restricted}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h2 style={{ margin: 0 }}>{poll.title} \u2014 Results</h2>
      {poll.questions.map((q) => {
        const questionRows = rows.filter((r) => r.question_id === q.id);
        const total = questionRows.reduce((sum, r) => sum + r.response_count, 0);
        return (
          <div key={q.id} className="card" style={{ padding: 16 }}>
            <p style={{ margin: 0, fontWeight: 600, fontSize: '.9rem' }}>{q.question_text}</p>

            {q.question_type === 'rating' ? (
              <p style={{ margin: '10px 0 0' }}>
                {copy.averageLabel}: <strong style={{ fontSize: '1.3rem' }}>{questionRows[0]?.avg_rating?.toFixed(1) ?? '\u2014'}</strong>/10
                <span className="dim" style={{ marginLeft: 8, fontSize: '.8rem' }}>{copy.responsesLabel(total)}</span>
              </p>
            ) : q.question_type === 'text' ? (
              <p className="dim" style={{ fontSize: '.82rem', marginTop: 8 }}>{copy.responsesLabel(total)}</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                {q.options.map((o) => {
                  const count = questionRows.find((r) => r.option_id === o.id)?.response_count ?? 0;
                  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
                  return (
                    <div key={o.id}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.85rem' }}>
                        <span>{o.option_text}</span><span className="dim">{count} \u00b7 {pct}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--claudia-kernel-surface, #f0f0f0)', marginTop: 3 }}>
                        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 3, background: 'var(--claudia-kernel-brand, #333)' }} />
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
