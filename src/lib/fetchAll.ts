// Page through a Supabase/PostgREST query that can return more than the
// server's default 1000-row cap. Pass a function that builds the query for a
// given range; it is called repeatedly until a short (or empty) page is returned.
//
//   const { rows, error } = await fetchAllRows<MyRow>((from, to) =>
//     supabase.from('t').select('*').range(from, to) as unknown as
//       PromiseLike<{ data: MyRow[] | null; error: unknown }>);

export async function fetchAllRows<T>(
  buildPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
  pageSize = 1000,
): Promise<{ rows: T[]; error: unknown }> {
  const rows: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) return { rows, error };
    if (!data || data.length === 0) break;
    rows.push(...data);
    if (data.length < pageSize) break;
  }
  return { rows, error: null };
}
