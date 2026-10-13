import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Format currency
export const fmtRs = (n) =>
  'Rs. ' + Math.round(n || 0).toLocaleString('en-LK');

// Format date
export const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-LK', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
