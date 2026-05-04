import { createClient, SupabaseClient } from '@supabase/supabase-js'

export type Reading = {
  id?: string
  user_id: string
  date: string
  slot: number
  value: number
  note?: string
  created_at?: string
}

export type Medication = {
  id?: string
  user_id: string
  name: string
  time: string
  enabled: boolean
}

export const SLOTS = [
  { name: 'Before breakfast', short: 'B.Bkfst', target: { min: 80, max: 130 } },
  { name: 'After breakfast (2h)', short: 'A.Bkfst', target: { min: 80, max: 180 } },
  { name: 'After lunch (2h)', short: 'A.Lunch', target: { min: 80, max: 180 } },
  { name: 'Before dinner', short: 'B.Dnnr', target: { min: 80, max: 180 } },
  { name: 'After dinner (2h)', short: 'A.Dnnr', target: { min: 80, max: 180 } },
]

export function getStatus(value: number, slot: number) {
  const t = SLOTS[slot].target
  if (value < t.min) return 'low'
  if (value > t.max) return 'high'
  return 'normal'
}

export function getUserId(): string {
  if (typeof window === 'undefined') return 'server'
  let uid = localStorage.getItem('ahadu_uid')
  if (!uid) {
    uid = 'user_' + Math.random().toString(36).slice(2, 10)
    localStorage.setItem('ahadu_uid', uid)
  }
  return uid
}

// Lazy client - only created on the browser, never at build time
let _client: SupabaseClient | null = null

export function getSupabase(): SupabaseClient {
  if (_client) return _client
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase env vars not configured')
  _client = createClient(url, key)
  return _client
}

// Keep named export for compatibility
export const supabase = {
  from: (table: string) => getSupabase().from(table)
}
