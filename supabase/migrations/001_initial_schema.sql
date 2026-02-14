-- 001_initial_schema.sql — Fu Fortune Gacha schema

-- Profiles (extends Supabase auth.users)
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  draws_remaining int default 15,
  total_draws int default 0,
  pity_counter int default 0,
  login_streak int default 0,
  last_login_date date,
  last_share_time timestamptz,
  referral_code text unique,
  referred_by uuid references profiles(id),
  referral_count int default 0,
  ad_draws_today int default 0,
  ad_draws_date date,
  created_at timestamptz default now()
);

-- Collections (characters collected by users)
create table collections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  character text not null,
  rarity int not null,
  category_name text not null,
  count int default 1,
  max_stars int not null,
  first_drawn_at timestamptz default now(),
  unique(user_id, character)
);

-- Transactions (draw grants from all sources)
create table transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,
  type text not null, -- 'stripe', 'ad_reward', 'share', 'daily_login', 'referral', 'welcome'
  draws_granted int not null,
  stripe_session_id text,
  created_at timestamptz default now()
);

-- Gifts (duplicate character sharing with expiry)
create table gifts (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references profiles(id) on delete cascade,
  character text not null,
  rarity int not null,
  category_name text not null,
  token text unique not null,
  claimed_by uuid references profiles(id),
  claimed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

-- Indexes
create index idx_collections_user on collections(user_id);
create index idx_transactions_user on transactions(user_id);
create index idx_gifts_token on gifts(token);
create index idx_gifts_sender on gifts(sender_id);
create index idx_profiles_referral_code on profiles(referral_code);

-- RLS Policies
alter table profiles enable row level security;
alter table collections enable row level security;
alter table transactions enable row level security;
alter table gifts enable row level security;

-- Profiles: users can read/update their own
create policy "Users can view own profile"
  on profiles for select using (auth.uid() = id);
create policy "Users can update own profile"
  on profiles for update using (auth.uid() = id);
create policy "Users can insert own profile"
  on profiles for insert with check (auth.uid() = id);

-- Collections: users can read/write their own
create policy "Users can view own collection"
  on collections for select using (auth.uid() = user_id);
create policy "Users can insert own collection"
  on collections for insert with check (auth.uid() = user_id);
create policy "Users can update own collection"
  on collections for update using (auth.uid() = user_id);

-- Transactions: users can read their own, insert their own
create policy "Users can view own transactions"
  on transactions for select using (auth.uid() = user_id);
create policy "Users can insert own transactions"
  on transactions for insert with check (auth.uid() = user_id);

-- Gifts: sender can create, anyone can view by token, claimer can update
create policy "Users can create gifts"
  on gifts for insert with check (auth.uid() = sender_id);
create policy "Anyone can view gifts by token"
  on gifts for select using (true);
create policy "Users can claim gifts"
  on gifts for update using (claimed_by is null);

-- Auto-create profile on signup
create or replace function handle_new_user()
returns trigger as $$
begin
  insert into profiles (id, email, display_name, referral_code)
  values (
    new.id,
    new.email,
    split_part(new.email, '@', 1),
    substr(gen_random_uuid()::text, 1, 8)
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
