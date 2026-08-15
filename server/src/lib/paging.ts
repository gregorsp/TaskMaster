export interface PageRequest {
  page: number;
  pageSize: number;
}

export interface PageResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export function parsePageQuery(query: Record<string, unknown>): PageRequest {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = query.pageSize === "all"
    ? 1_000_000
    : Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}

export function paginate<T>(items: T[], total: number, req: PageRequest): PageResponse<T> {
  return {
    items,
    total,
    page: req.page,
    pageSize: req.pageSize,
    totalPages: Math.ceil(total / req.pageSize),
  };
}
