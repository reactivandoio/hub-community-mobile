export interface EventSummary {
  id: string;
  documentId: string;
  slug: string;
  title: string;
  start_date: string;
  location?: { title?: string | null; city?: string | null } | null;
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
