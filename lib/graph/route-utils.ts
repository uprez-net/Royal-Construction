export function requireAdminToken(
  request: Request,
  adminToken: string | undefined,
): Response | null {
  if (!adminToken) {
    return null;
  }

  const provided = request.headers.get('x-graph-admin-token');
  console.log('Admin token provided:', provided);
  if (!provided || provided !== adminToken) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  return null;
}

export function jsonError(message: string, status = 500): Response {
  return Response.json({ error: message }, { status });
}
