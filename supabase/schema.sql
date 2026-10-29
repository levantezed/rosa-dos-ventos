-- Rode este script inteiro no Supabase: SQL Editor > New query > Run

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  content text not null,
  image_url text,
  keywords text[] not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);

-- Segurança: ativa RLS. Visitantes (anon) só podem LER.
alter table public.posts enable row level security;

drop policy if exists "Leitura pública" on public.posts;
create policy "Leitura pública"
  on public.posts for select
  to anon, authenticated
  using (true);

-- Não há políticas de insert/update/delete: somente o backend,
-- com a service_role key, consegue modificar as publicações.

-- Bucket público para as imagens (leitura pública; escrita só pelo backend)
insert into storage.buckets (id, name, public)
values ('post-images', 'post-images', true)
on conflict (id) do update set public = true;
