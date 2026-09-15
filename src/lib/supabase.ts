import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

export function supabaseConfigured(): boolean {
  return !!(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function getSupabase(): SupabaseClient | null {
  if (!supabaseConfigured()) return null;
  if (!client) {
    client = createClient(
      import.meta.env.VITE_SUPABASE_URL as string,
      import.meta.env.VITE_SUPABASE_ANON_KEY as string,
    );
  }
  return client;
}

export const SUPABASE_SCHEMA_SQL = `-- BrowserFF metadata-only persistence (no media blobs).
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
`;
