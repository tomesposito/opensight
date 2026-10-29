/** The tested hosted-UI slice only; identifiers are literal and never URL-decoded. */
export function serverlessV1Methods(path: string): readonly string[] | undefined {
  const id = '[A-Za-z0-9_-]{1,512}';
  if (path === '/api/v1/analyses') return ['GET', 'POST'];
  if (new RegExp(`^/api/v1/analyses/${id}$`).test(path)) return ['GET', 'PUT', 'DELETE'];
  if (new RegExp(`^/api/v1/analyses/${id}/publish$`).test(path)) return ['POST'];
  if (new RegExp(`^/api/v1/analyses/${id}/sheets/${id}/layouts$`).test(path)
    || new RegExp(`^/api/v1/analyses/${id}/calculated-fields$`).test(path)) return ['PUT'];
  if (new RegExp(`^/api/v1/analyses/${id}/(?:sheets/${id}/visuals|filter-groups)$`).test(path)) return ['POST'];
  if (new RegExp(`^/api/v1/analyses/${id}/(?:sheets/${id}/visuals|filter-groups)/${id}$`).test(path)) return ['PUT', 'DELETE'];
  if (new RegExp(`^/api/v1/(?:analyses|dashboards)/${id}/shares/(?:user|group)/${id}$`).test(path)) return ['GET', 'PUT', 'DELETE'];
  if (path === '/api/v1/dashboards' || new RegExp(`^/api/v1/dashboards/${id}/versions$`).test(path)) return ['GET'];
  if (new RegExp(`^/api/v1/dashboards/${id}(?:/versions/[1-9][0-9]*)?$`).test(path)) return ['GET', 'DELETE'];
  if (new RegExp(`^/api/v1/dashboards/${id}/(?:exports|versions/[1-9][0-9]*/visuals/${id}/query)$`).test(path)) return ['POST'];
  return undefined;
}
