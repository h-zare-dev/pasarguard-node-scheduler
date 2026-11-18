const allowedFields = new Set(['event', 'nodeId', 'actor', 'operation', 'status', 'expected', 'actual',
  'dryRun', 'durationMs', 'error', 'source', 'mode']);

export function log(level, fields) {
  const sanitized = {};
  for (const [key, value] of Object.entries(fields)) {
    if (allowedFields.has(key) && value !== undefined) sanitized[key] = value;
  }
  console.log(JSON.stringify({ at: new Date().toISOString(), level, ...sanitized }));
}
