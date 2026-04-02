-- Run this in Supabase SQL Editor before launching the app
-- Dashboard → SQL Editor → New Query → Paste → Run

-- 1. Create the photos table
create table if not exists photos (
  id          uuid default gen_random_uuid() primary key,
  image_url   text not null,
  uploader_name text,
  caption     text,
  note        text,
  created_at  timestamptz default now()
);

-- 2. Enable Row Level Security (required)
alter table photos enable row level security;

-- 3. Allow anyone to read photos
create policy "public read"
  on photos for select
  using (true);

-- 4. Allow anyone to upload photos
create policy "public insert"
  on photos for insert
  with check (true);

-- Then in Storage (Dashboard → Storage):
-- • Create a new bucket called: memory-wall
-- • Set it to Public
-- • Under Policies, add:
--     - SELECT: true (public read)
--     - INSERT: true (public upload)
--     - UPDATE: true (admin edit)
--     - DELETE: true (admin delete)

-- 5. Allow public updates (for admin edits)
create policy "public update"
  on photos for update
  using (true)
  with check (true);

-- 6. Allow public deletes (for admin deletes)
create policy "public delete"
  on photos for delete
  using (true);
