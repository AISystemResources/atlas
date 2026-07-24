/**
 * Legacy alias for /api/v1/backtest-ticket/[id]/distillation (Sprint 062).
 * Sprint 053e shipped this under the "insight" name; renamed to
 * "distillation" because that's what the strategy author (Edmund) called the
 * process, and it distinguishes from the per-day Reflection on the Insights
 * page.
 *
 * Kept as a 308 (preserves POST + body) so any in-flight MCP scripts or
 * external automation keep working through the rename.
 */

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;
  const target = new URL(req.url);
  target.pathname = target.pathname.replace(/\/insight\/?$/, "/distillation");
  return Response.redirect(target.toString(), 308);
}
