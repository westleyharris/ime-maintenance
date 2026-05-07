import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://gszfyelaezdftlwtzrjw.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_B1h3pMZLeNQxw6YsDt76Yg_yCrSfJUP';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
