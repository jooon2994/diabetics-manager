import { NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'

export async function GET() {
  const results: Record<string, string> = {}

  results.supabase_url = process.env.NEXT_PUBLIC_SUPABASE_URL ? '✅ Set' : '❌ MISSING'
  results.supabase_key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? '✅ Set' : '❌ MISSING'
  results.openai_key = process.env.OPENAI_API_KEY ? '✅ Set' : '❌ MISSING'

  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    const db = createClient(url, key)
    const { error } = await db.from('readings').select('count').limit(1)
    results.supabase_connection = error ? `❌ ${error.message}` : '✅ Connected'
  } catch (e) {
    results.supabase_connection = `❌ ${e}`
  }

  try {
    const res = await fetch('https://api.openai.com/v1/models', {
      headers: { 'Authorization': `Bearer ${process.env.OPENAI_API_KEY}` }
    })
    results.openai_connection = res.ok ? '✅ Connected' : `❌ Status ${res.status} - invalid or expired key`
  } catch (e) {
    results.openai_connection = `❌ ${e}`
  }

  return NextResponse.json(results, {
    headers: { 'Content-Type': 'application/json' }
  })
}
