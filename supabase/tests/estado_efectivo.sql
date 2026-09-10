-- Run ONLY in an isolated local PostgreSQL/PGlite fixture database.
do $$
declare
  v record;
  actual integer;
  actual_state text;
begin
  for v in select * from (values
    ('case 1', date '2026-09-07', date '2026-09-07', 30, 0, 1, 'ATRASADO'),
    ('case 2', date '2026-09-07', date '2026-09-07', 30, 1, 1, 'AL DIA'),
    ('case 3', date '2026-09-07', date '2026-09-07', 30, 2, 1, 'ADELANTADO'),
    ('case 4 Friday', date '2026-09-11', date '2026-09-11', 30, 1, 1, 'AL DIA'),
    ('case 4 Saturday', date '2026-09-11', date '2026-09-12', 30, 2, 2, 'AL DIA'),
    ('case 4 Sunday', date '2026-09-11', date '2026-09-13', 30, 2, 2, 'AL DIA'),
    ('case 4 Monday', date '2026-09-11', date '2026-09-14', 30, 2, 3, 'ATRASADO'),
    ('case 5', date '2026-09-11', date '2026-09-10', 30, 0, 0, 'AL DIA'),
    ('case 6', date '2026-09-07', date '2027-09-07', 3, 2, 3, 'ATRASADO'),
    ('case 7', date '2026-09-07', date '2026-09-29', 30, 17, 20, 'ATRASADO'),
    ('case 8', date '2026-09-07', date '2026-09-29', 30, 20, 20, 'AL DIA'),
    ('case 9', date '2026-09-07', date '2026-09-29', 30, 23, 20, 'ADELANTADO'),
    ('case 10 equal', date '2026-09-07', date '2026-09-07', 30, 30, 1, 'CANCELADO'),
    ('case 10 excess', date '2026-09-07', date '2026-09-07', 30, 31, 1, 'CANCELADO')
  ) as cases(label, start_date, today, total, paid, expected_due, expected_state)
  loop
    actual := public.hugella_cuotas_exigibles(v.start_date, v.total, v.today);
    actual_state := public.hugella_estado_credito(v.total, v.paid::bigint, actual);
    if actual is distinct from v.expected_due or actual_state is distinct from v.expected_state then
      raise exception '%: got % / %, expected % / %', v.label, actual, actual_state, v.expected_due, v.expected_state;
    end if;
  end loop;

  -- Independent day-by-day oracle, including leap year and year boundaries.
  if exists (
    select 1 from generate_series(0, 370) as starts(i)
    cross join generate_series(-2, 70) as ends(j)
    where extract(isodow from (date '2023-12-01' + i)) <> 7
    and public.hugella_cuotas_exigibles(date '2023-12-01' + i, 30, date '2023-12-01' + i + j)
      <> least(30, (select count(*)::integer from generate_series(0, j) as days(k)
        where extract(isodow from (date '2023-12-01' + i + k)) <> 7))
  ) then raise exception 'Calendar property test failed'; end if;

  if public.hugella_fecha_comercial() <> (statement_timestamp() at time zone 'America/Argentina/Mendoza')::date then
    raise exception 'Commercial timezone mismatch';
  end if;
  if (timestamptz '2026-09-10 01:30:00+00' at time zone 'America/Argentina/Mendoza')::date <> date '2026-09-09' then
    raise exception 'UTC boundary mismatch';
  end if;
end;
$$;
