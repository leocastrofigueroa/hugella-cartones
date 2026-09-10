-- LOCAL REVIEW ONLY. Fail closed on unknown types/constraints. Atomic DO block.
-- Only the exact historical three-value CHECK is eligible for replacement.
do $$
declare
  v_column smallint;
  v_type oid;
  v_constraint record;
  v_count integer := 0;
  v_name text;
  v_expression text;
begin
  select attnum, atttypid into strict v_column, v_type
  from pg_attribute
  where attrelid = 'public.creditos'::regclass and attname = 'estado' and not attisdropped;
  if v_type not in ('text'::regtype, 'character varying'::regtype) then
    raise exception 'Review required: creditos.estado is not text/varchar';
  end if;

  for v_constraint in
    select conname, conkey, pg_get_expr(conbin, conrelid) as expression
    from pg_constraint
    where conrelid = 'public.creditos'::regclass and contype = 'c' and v_column = any(conkey)
  loop
    v_count := v_count + 1;
    -- Remove deparser casts/parentheses/spacing, not arbitrary SQL expressions.
    v_expression := replace(replace(v_constraint.expression, '::character varying', ''), '::text', '');
    v_expression := regexp_replace(v_expression, '[[:space:]()]', '', 'g');
    if cardinality(v_constraint.conkey) <> 1 or v_expression <>
      'estado=ANYARRAY[''ALDIA'',''ATRASADO'',''CANCELADO'']' then
      raise exception 'Review required: unrecognized estado CHECK %: %', v_constraint.conname, v_constraint.expression;
    end if;
    v_name := v_constraint.conname;
  end loop;

  if v_count > 1 then
    raise exception 'Review required: multiple estado CHECK constraints';
  end if;
  if v_count = 1 then
    execute format('alter table public.creditos drop constraint %I', v_name);
  else
    v_name := 'hugella_creditos_estado_check';
  end if;
  execute format(
    'alter table public.creditos add constraint %I check (estado in (''ADELANTADO'', ''AL DIA'', ''ATRASADO'', ''CANCELADO''))',
    v_name
  );
  -- Existing invalid rows cause rollback. No row, default, or NOT NULL is changed.
end;
$$;
