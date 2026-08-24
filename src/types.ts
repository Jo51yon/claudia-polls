export type ClaudiaPollQuestionType = 'single_choice' | 'multiple_choice' | 'text' | 'rating';
export type ClaudiaPollResultsVisibility = 'public' | 'after_vote' | 'after_close' | 'admin_only';

export interface ClaudiaPollOption {
  id: string;
  option_text: string;
  display_order: number;
}
export interface ClaudiaPollQuestion {
  id: string;
  question_text: string;
  question_type: ClaudiaPollQuestionType;
  display_order: number;
  is_required: boolean;
  options: ClaudiaPollOption[];
}
export interface ClaudiaPoll {
  id: string;
  title: string;
  description: string | null;
  status: 'draft' | 'active' | 'closed';
  start_date: string | null;
  end_date: string | null;
  allow_multiple_responses: boolean;
  is_anonymous: boolean;
  results_visibility: ClaudiaPollResultsVisibility;
  questions: ClaudiaPollQuestion[];
}
export interface ClaudiaPollResultRow {
  question_id: string;
  option_id: string | null;
  response_count: number;
  avg_rating: number | null;
}
