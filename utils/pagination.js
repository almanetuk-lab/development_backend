/**
 * Builds the `pagination` block of a paginated API envelope.
 *
 * totalPages floors at 1 so an empty result set still reports "page 1 of 1"
 * rather than "page 1 of 0", which reads as a bug in the UI.
 */
export const buildPagination = ({ page, limit, totalCount }) => {
  const totalPages = Math.max(1, Math.ceil(totalCount / limit));
  return {
    currentPage: page,
    totalPages,
    totalCount,
    limit,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * The standard envelope for list endpoints: { data, pagination, filters }.
 */
export const buildListEnvelope = ({ rows, page, limit, totalCount, filters }) => ({
  data: rows,
  pagination: buildPagination({ page, limit, totalCount }),
  filters,
});
