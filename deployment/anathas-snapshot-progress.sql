-- Suivi en lecture seule des captures Anathas et de leurs lots persistants.

SELECT
  r.snapshot_id,
  r.schedule_key,
  r.status,
  r.expected_country_count,
  r.captured_country_count,
  r.details_failed_count,
  COUNT(q.rank_order) AS queued_countries,
  COUNT(*) FILTER (WHERE q.status = 'completed') AS completed_in_queue,
  COUNT(*) FILTER (WHERE q.status = 'pending') AS pending_in_queue,
  COUNT(*) FILTER (WHERE q.status = 'failed') AS failed_in_queue,
  r.started_at,
  r.updated_at,
  r.retry_after,
  r.error_message
FROM public.anathas_snapshot_runs AS r
LEFT JOIN public.anathas_snapshot_country_queue AS q
  ON q.snapshot_id = r.snapshot_id
GROUP BY r.snapshot_id
ORDER BY r.snapshot_id DESC
LIMIT 10;
