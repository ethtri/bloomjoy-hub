insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'sales-report-exports',
  'sales-report-exports',
  false,
  10485760,
  array[
    'application/pdf',
    'text/csv',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ]
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
