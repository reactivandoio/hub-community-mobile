export interface EventSummary {
  id: string;
  documentId: string;
  slug: string;
  title: string;
  start_date: string;
  location?: { title?: string | null; city?: string | null } | null;
  communities?: { id: string }[] | null;
}

export interface RequestLoginCodeResponse {
  requestLoginCode: { sent: boolean; resendIn: number };
}

export interface VerifyLoginCodeResponse {
  verifyLoginCode: {
    id?: string | null;
    token?: string | null;
    email?: string | null;
    username?: string | null;
    name?: string | null;
  };
}

export interface EventsResponse {
  events: { data: EventSummary[] } | null;
}

export interface EventBatch {
  id: string;
  batch_number: number;
  value?: number | null;
  enabled?: boolean | null;
}

export interface EventProduct {
  id: string;
  name: string;
  enabled?: boolean | null;
  batches?: EventBatch[] | null;
}

export interface EventBatchesResponse {
  eventBySlugOrId: { id: string; title: string; products?: EventProduct[] | null } | null;
}
