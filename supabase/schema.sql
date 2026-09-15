-- BrowserFF metadata-only persistence (no media blobs).
-- Apply in the Supabase SQL editor. Service-role keys must never reach the browser.
create table if not exists projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  filename text not null,
  duration double precision,
  container text,
  media_metadata jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
alter table projects enable row level security;
drop policy if exists "own projects" on projects;
create policy "own projects" on projects for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table if not exists analysis_history (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  operation text not null,
  input_size bigint,
  output_size bigint,
  metadata jsonb,
  created_at timestamptz default now()
);
alter table analysis_history enable row level security;
drop policy if exists "own analysis" on analysis_history;
create policy "own analysis" on analysis_history for all using (
  exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
);

create table if not exists operations (
  id uuid primary key default gen_random_uuid(),
  project_id uuid references projects(id) on delete cascade,
  operation_type text not null,
  configuration jsonb not null,
  status text not null default 'done',
  created_at timestamptz default now()
);
alter table operations enable row level security;
drop policy if exists "own operations" on operations;
create policy "own operations" on operations for all using (
  exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
) with check (
  exists (select 1 from projects p where p.id = project_id and p.user_id = auth.uid())
);
