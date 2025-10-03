-- Run this once in Supabase SQL Editor to create the function
-- Then call it anytime with: SELECT * FROM get_rls_info();

CREATE OR REPLACE FUNCTION get_rls_info()
RETURNS TABLE (
  table_name text,
  policy_name text,
  operation text,
  using_expr text,
  with_check_expr text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    p.tablename::text,
    p.policyname::text,
    CASE
      WHEN p.cmd = '*' THEN 'ALL'
      ELSE p.cmd
    END::text,
    p.qual::text,
    p.with_check::text
  FROM pg_policies p
  WHERE p.schemaname = 'public'
  ORDER BY p.tablename, p.policyname;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
