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
