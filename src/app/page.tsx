'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { SLOTS, getStatus, getUserId, type Reading, type Medication } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts'
import { createClient } from '@supabase/supabase-js'

// Client created ONLY inside browser - never at build time
function getDB() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

const today = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
const fmtMonth = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

function StatusPill({ value, slot }: { value: number | null; slot: number }) {
  if (value === null) return <span className="pill pill-miss">—</span>
  const s = getStatus(value, slot)
  return <span className={`pill pill-${s === 'normal' ? 'ok' : s === 'high' ? 'high' : 'low'}`}>{value}</span>
}

function StatusBadge({ value, slot }: { value: number | null; slot: number }) {
  if (value === null) return <span className="pill pill-miss">Missing</span>
  const s = getStatus(value, slot)
  const t = SLOTS[slot].target
  if (s === 'normal') return <span className="pill pill-ok">In range</span>
  if (s === 'high') return <span className="pill pill-high">High +{value - t.max}</span>
  return <span className="pill pill-low">Low</span>
}

async function fetchAIAdvice(readings: Reading[], question?: string): Promise<string> {
  const summary = readings.slice(-15).map(r =>
    `${r.date} ${SLOTS[r.slot].name}: ${r.value} mg/dL (${getStatus(r.value, r.slot)})`
  ).join(', ')
  const prompt = question
    ? question
    : readings.length
      ? `My recent glucose readings: ${summary}. Please analyze and give me specific practical advice.`
      : 'I am a diabetic patient just starting to track my glucose. Give me tips to get started.'
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const data = await res.json()
  return data.advice || 'Could not get AI response.'
}

export default function App() {
  const [tab, setTab] = useState<'home' | 'record' | 'reports' | 'remind' | 'tips'>('home')
  const [readings, setReadings] = useState<Reading[]>([])
  const [medications, setMedications] = useState<Medication[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [rVal, setRVal] = useState('')
  const [rSlot, setRSlot] = useState(0)
  const [rDate, setRDate] = useState(today())
  const [rNote, setRNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [reportTab, setReportTab] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [viewDay, setViewDay] = useState(today())
  const [viewWeekOff, setViewWeekOff] = useState(0)
  const [viewMonthOff, setViewMonthOff] = useState(0)
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askAns, setAskAns] = useState('')
  const [askLoading, setAskLoading] = useState(false)
  const [medName, setMedName] = useState('')
  const [medTime, setMedTime] = useState('08:00')

  useEffect(() => {
    const uid = getUserId()
    setUserId(uid)
    loadData(uid)
  }, [])

  const loadData = async (uid: string) => {
    setLoading(true)
    try {
      const db = getDB()
      const { data: r } = await db.from('readings').select('*').eq('user_id', uid).order('date', { ascending: false }).order('slot')
      const { data: m } = await db.from('medications').select('*').eq('user_id', uid)
      setReadings(r || [])
      setMedications(m || [])
    } catch (e) {
      console.error(e)
    }
    setLoading(false)
  }

  const saveReading = async () => {
    const v = parseInt(rVal)
    if (!v || v < 20 || v > 600) return alert('Please enter a valid glucose value (20–600 mg/dL)')
    setSaving(true)
    const db = getDB()
    const { error } = await db.from('readings').insert({ user_id: userId, date: rDate, slot: rSlot, value: v, note: rNote || null })
    if (!error) {
      await loadData(userId)
      setRVal(''); setRNote('')
      setTab('home')
      triggerAI([...readings, { user_id: userId, date: rDate, slot: rSlot, value: v }])
    }
    setSaving(false)
  }

  const triggerAI = async (allReadings: Reading[]) => {
    setAiLoading(true)
    const txt = await fetchAIAdvice(allReadings)
    setAiText(txt)
    setAiLoading(false)
  }

  const askGPT = async () => {
    setAiLoading(true)
    const txt = await fetchAIAdvice(readings)
    setAiText(txt)
    setAiLoading(false)
  }

  const askQuestion = async () => {
    if (!askQ.trim()) return
    setAskLoading(true)
    const txt = await fetchAIAdvice(readings, askQ)
    setAskAns(txt)
    setAskLoading(false)
  }

  const addMed = async () => {
    if (!medName.trim()) return
    const db = getDB()
    await db.from('medications').insert({ user_id: userId, name: medName, time: medTime, enabled: true })
    await loadData(userId)
    setMedName('')
  }

  const toggleMed = async (id: string, enabled: boolean) => {
    const db = getDB()
    await db.from('medications').update({ enabled: !enabled }).eq('id', id)
    await loadData(userId)
  }

  const todayReadings = readings.filter(r => r.date === today())
  const lastReading = readings[0] ?? null
  const todayAvg = todayReadings.length ? Math.round(todayReadings.reduce((a, r) => a + r.value, 0) / todayReadings.length) : null

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const dk = d.toISOString().slice(0, 10)
    const dayR = readings.filter(r => r.date === dk)
    const avg = dayR.length ? Math.round(dayR.reduce((a, r) => a + r.value, 0) / dayR.length) : null
    return { day: d.toLocaleDateString(undefined, { weekday: 'short' }), avg, fill: avg ? (avg > 180 ? '#E24B4A' : avg < 70 ? '#BA7517' : '#1D9E75') : '#e0e0e0' }
  })

  const dailyData = SLOTS.map((s, i) => {
    const r = readings.find(r => r.date === viewDay && r.slot === i)
    return { slot: s, i, value: r?.value ?? null, note: r?.note ?? null }
  })
  const dailyVals = dailyData.filter(d => d.value !== null)
  const dailyAvg = dailyVals.length ? Math.round(dailyVals.reduce((a, d) => a + d.value!, 0) / dailyVals.length) : null
  const dailyInRange = dailyVals.filter(d => getStatus(d.value!, d.i) === 'normal').length
  const dailyHigh = dailyVals.filter(d => getStatus(d.value!, d.i) === 'high').length
  const dailyLow = dailyVals.filter(d => getStatus(d.value!, d.i) === 'low').length

  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i + viewWeekOff * 7)
    return d.toISOString().slice(0, 10)
  })
  const weekReadings = readings.filter(r => weekDays.includes(r.date))
  const weekAvg = weekReadings.length ? Math.round(weekReadings.reduce((a, r) => a + r.value, 0) / weekReadings.length) : null
  const weekInRange = weekReadings.filter(r => getStatus(r.value, r.slot) === 'normal').length
  const weekPct = weekReadings.length ? Math.round(weekInRange / weekReadings.length * 100) : null
  const weekHigh = weekReadings.filter(r => getStatus(r.value, r.slot) === 'high').length
  const weekLabel = `${new Date(weekDays[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(weekDays[6] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric' })}`

  const nowM = new Date(); nowM.setMonth(nowM.getMonth() + viewMonthOff)
  const mYear = nowM.getFullYear(); const mMonth = nowM.getMonth()
  const monthReadings = readings.filter(r => r.date.startsWith(`${mYear}-${String(mMonth + 1).padStart(2, '0')}`))
  const monthAvg = monthReadings.length ? Math.round(monthReadings.reduce((a, r) => a + r.value, 0) / monthReadings.length) : null
  const monthInRange = monthReadings.filter(r => getStatus(r.value, r.slot) === 'normal').length
  const monthPct = monthReadings.length ? Math.round(monthInRange / monthReadings.length * 100) : null
  const monthHigh = monthReadings.filter(r => getStatus(r.value, r.slot) === 'high').length
  const hba1c = monthAvg ? ((monthAvg + 46.7) / 28.7).toFixed(1) : null

  const mDays = Array.from({ length: new Date(mYear, mMonth + 1, 0).getDate() }, (_, i) => new Date(mYear, mMonth, i + 1).toISOString().slice(0, 10))
  const mWeeks: string[][] = []
  let cur: string[] = []
  mDays.forEach(d => { cur.push(d); if (new Date(d + 'T00:00:00').getDay() === 0) { mWeeks.push([...cur]); cur = [] } })
  if (cur.length) mWeeks.push(cur)

  const mealPerf = SLOTS.map((s, i) => {
    const mr = monthReadings.filter(r => r.slot === i)
    const mavg = mr.length ? Math.round(mr.reduce((a, r) => a + r.value, 0) / mr.length) : null
    const minR = mr.filter(r => getStatus(r.value, i) === 'normal').length
    const mpct = mr.length ? Math.round(minR / mr.length * 100) : null
    const result = mavg === null ? 'No data' : mpct! >= 80 ? 'Good' : mpct! >= 50 ? 'Fair' : 'Poor'
    return { s, i, mavg, mpct, result }
  })

  const lastStatus = lastReading ? getStatus(lastReading.value, lastReading.slot) : null
  const lastColor = lastStatus === 'high' ? '#E24B4A' : lastStatus === 'low' ? '#BA7517' : '#1D9E75'

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 48, height: 48, border: '4px solid #e0e0e0', borderTopColor: '#1D9E75', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: '#666', fontSize: 14 }}>Loading your data...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', paddingBottom: 80 }}>
      {/* HEADER */}
      <div style={{ background: '#085041', color: 'white', padding: '52px 18px 18px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ fontSize: 20, fontWeight: 700 }}>Ahadu Glucose</h1>
            <p style={{ fontSize: 11, opacity: .75, marginTop: 2 }}>Powered by GPT-4o · Supabase</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,.2)', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
            {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </div>
        </div>
      </div>

      {/* HOME */}
      {tab === 'home' && (
        <div style={{ padding: '16px 14px' }}>
          {lastReading && lastReading.value >= 250 && (
            <div style={{ background: '#fff3f3', border: '1.5px solid #E24B4A', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#c0392b', fontWeight: 500 }}>⚠️ Reading {lastReading.value} mg/dL is very high. Drink water, avoid food, contact your doctor.</p>
            </div>
          )}
          {lastReading && lastReading.value < 70 && (
            <div style={{ background: '#fffbf0', border: '1.5px solid #BA7517', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#7d4e00', fontWeight: 500 }}>⚠️ Reading {lastReading.value} mg/dL is low. Eat something sweet immediately.</p>
            </div>
          )}
          <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'left', marginBottom: 10 }}>Last Reading</p>
            <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1, color: lastColor, letterSpacing: -2 }}>{lastReading?.value ?? '--'}</div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>mg/dL</div>
            {lastReading && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><StatusBadge value={lastReading.value} slot={lastReading.slot} /></div>}
            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>{lastReading ? `${SLOTS[lastReading.slot].name} · ${lastReading.date}` : 'No readings yet — tap Record to start'}</div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
            <div style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 11, color: '#666' }}>Today&apos;s average</div><div style={{ fontSize: 26, fontWeight: 700, color: '#1D9E75' }}>{todayAvg ?? '--'}</div><div style={{ fontSize: 11, color: '#888' }}>mg/dL</div></div>
            <div style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 11, color: '#666' }}>Today&apos;s readings</div><div style={{ fontSize: 26, fontWeight: 700 }}>{todayReadings.length}</div><div style={{ fontSize: 11, color: '#888' }}>of 5 slots</div></div>
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>7-Day Trend</p>
            <ResponsiveContainer width="100%" height={100}>
              <BarChart data={chartData} margin={{ top: 4, right: 4, bottom: 0, left: -32 }}>
                <XAxis dataKey="day" tick={{ fontSize: 10, fill: '#888' }} axisLine={false} tickLine={false} />
                <YAxis tick={false} axisLine={false} tickLine={false} domain={[0, 300]} />
                <ReferenceLine y={180} stroke="#E24B4A" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={130} stroke="#BA7517" strokeDasharray="3 3" strokeWidth={1} />
                <Tooltip formatter={(v: number) => [`${v} mg/dL`, 'Avg']} contentStyle={{ fontSize: 12, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,0.15)' }} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]} fill="#1D9E75" label={{ position: 'top', fontSize: 9, fill: '#555', formatter: (v: number) => v || '' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🤖 GPT-4o AI Advisor</p>
            <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', borderRadius: '0 12px 12px 0', padding: 14, minHeight: 70 }}>
              {aiLoading ? <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>GPT-4o is analyzing your readings...</p>
                : aiText ? <><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>GPT-4o Advice</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{aiText}</p></>
                : <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>Add your first reading — AI will analyze and advise you instantly.</p>}
            </div>
            <button className="btn-dark" style={{ marginTop: 10 }} onClick={askGPT} disabled={aiLoading}>{aiLoading ? 'Thinking...' : 'Ask AI for Advice Now'}</button>
          </div>
        </div>
      )}

      {/* RECORD */}
      {tab === 'record' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Record Blood Glucose</p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Blood glucose (mg/dL)</label>
              <input type="number" className="form-input" value={rVal} onChange={e => setRVal(e.target.value)} placeholder="e.g. 118" min={20} max={600} inputMode="numeric" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Meal slot</label>
                <select className="form-input" value={rSlot} onChange={e => setRSlot(+e.target.value)}>{SLOTS.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select>
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Date</label>
                <input type="date" className="form-input" value={rDate} onChange={e => setRDate(e.target.value)} />
              </div>
            </div>
            <div style={{ marginBottom: 14 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Notes (food, activity, symptoms)</label>
              <input type="text" className="form-input" value={rNote} onChange={e => setRNote(e.target.value)} placeholder="e.g. had injera & tibs, walked 20 min" />
            </div>
            <button className="btn-primary" onClick={saveReading} disabled={saving}>{saving ? 'Saving...' : '💾 Save Reading'}</button>
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Today&apos;s Log</p>
            {todayReadings.length === 0 ? <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>No readings today</p>
              : todayReadings.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: idx < todayReadings.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 17, fontWeight: 600 }}>{r.value} mg/dL</div><div style={{ fontSize: 12, color: '#888' }}>{SLOTS[r.slot].name}{r.note ? ` · ${r.note}` : ''}</div></div>
                  <StatusBadge value={r.value} slot={r.slot} />
                </div>
              ))}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Recent History</p>
            {readings.slice(0, 20).map((r, idx) => (
              <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: idx < 19 ? '1px solid #f0f0f0' : 'none' }}>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 600 }}>{r.value} mg/dL</div><div style={{ fontSize: 11, color: '#888' }}>{r.date} · {SLOTS[r.slot].name}</div></div>
                <StatusBadge value={r.value} slot={r.slot} />
              </div>
            ))}
            {readings.length === 0 && <p style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No readings yet</p>}
          </div>
        </div>
      )}

      {/* REPORTS */}
      {tab === 'reports' && (
        <div style={{ padding: '16px 14px' }}>
          <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', padding: '12px 14px', borderRadius: '0 12px 12px 0', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#085041', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>Your Targets (Hospital Form)</p>
            {[['Before breakfast (fasting)', '80–130'], ['After breakfast 2h', '80–180'], ['After lunch 2h', '80–180'], ['Before dinner', '80–180'], ['After dinner 2h', '80–180']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '3px 0' }}>
                <span style={{ fontSize: 12, color: '#0F6E56' }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#085041', background: 'white', padding: '1px 8px', borderRadius: 8 }}>{v} mg/dL</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: 12, padding: 4, marginBottom: 14 }}>
            {(['daily', 'weekly', 'monthly'] as const).map(t => (
              <button key={t} onClick={() => setReportTab(t)} style={{ flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer', borderRadius: 10, background: reportTab === t ? 'white' : 'transparent', color: reportTab === t ? '#085041' : '#888', boxShadow: reportTab === t ? '0 1px 4px rgba(0,0,0,0.12)' : 'none', fontFamily: 'inherit' }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>

          {reportTab === 'daily' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px' }}>Daily Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() - 1); setViewDay(d.toISOString().slice(0, 10)) }} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>‹</button>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 90, textAlign: 'center' }}>{fmtDate(viewDay)}</span>
                  <button onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() + 1); setViewDay(d.toISOString().slice(0, 10)) }} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>›</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left' }}>Slot</th><th>Target</th><th>Reading</th><th>Status</th></tr></thead>
                  <tbody>{dailyData.map((d, i) => (<tr key={i}><td className="td-left">{d.slot.name}</td><td style={{ fontSize: 11, color: '#888' }}>{d.slot.target.min}–{d.slot.target.max}</td><td><StatusPill value={d.value} slot={d.i} /></td><td><StatusBadge value={d.value} slot={d.i} /></td></tr>))}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['Day average', dailyAvg ? dailyAvg + ' mg/dL' : '--', '#1D9E75'], ['In range', dailyVals.length ? `${dailyInRange}/${dailyVals.length}` : '--', '#1a1a1a'], ['High', String(dailyHigh), dailyHigh ? '#E24B4A' : '#1a1a1a'], ['Low', String(dailyLow), dailyLow ? '#BA7517' : '#1a1a1a']].map(([l, v, c]) => (
                <div key={l} style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 11, color: '#666' }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div></div>
              ))}
            </div>
          </>)}

          {reportTab === 'weekly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px' }}>Weekly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => setViewWeekOff(v => v - 1)} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>‹</button>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 100, textAlign: 'center' }}>{weekLabel}</span>
                  <button onClick={() => setViewWeekOff(v => v + 1)} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>›</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left', minWidth: 55 }}>Day</th>{SLOTS.map(s => <th key={s.short}>{s.short}<br /><small style={{ fontWeight: 400 }}>≤{s.target.max}</small></th>)}<th>Avg</th></tr></thead>
                  <tbody>{weekDays.map(dk => {
                    const dayR = readings.filter(r => r.date === dk)
                    const avg = dayR.length ? Math.round(dayR.reduce((a, r) => a + r.value, 0) / dayR.length) : null
                    return (<tr key={dk}><td className="td-left">{new Date(dk + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>{SLOTS.map((_, i) => { const r = dayR.find(r => r.slot === i); return <td key={i}><StatusPill value={r?.value ?? null} slot={i} /></td> })}<td><b>{avg ?? '—'}</b></td></tr>)
                  })}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[['Week avg', weekAvg ? weekAvg + ' mg/dL' : '--', '#1D9E75'], ['In range', weekPct !== null ? weekPct + '%' : '--', '#1a1a1a'], ['High', String(weekHigh), weekHigh ? '#E24B4A' : '#1a1a1a'], ['Total', String(weekReadings.length), '#1a1a1a']].map(([l, v, c]) => (
                <div key={l} style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 11, color: '#666' }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div></div>
              ))}
            </div>
          </>)}

          {reportTab === 'monthly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px' }}>Monthly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <button onClick={() => setViewMonthOff(v => v - 1)} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>‹</button>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 80, textAlign: 'center' }}>{fmtMonth(mYear, mMonth)}</span>
                  <button onClick={() => setViewMonthOff(v => v + 1)} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>›</button>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left' }}>Week</th><th>Avg</th><th>In Range</th><th>High</th><th>Low</th><th>Total</th></tr></thead>
                  <tbody>{mWeeks.map((wk, wi) => {
                    const wr = monthReadings.filter(r => wk.includes(r.date))
                    const wa = wr.length ? Math.round(wr.reduce((a, r) => a + r.value, 0) / wr.length) : null
                    const wir = wr.filter(r => getStatus(r.value, r.slot) === 'normal').length
                    const wp = wr.length ? Math.round(wir / wr.length * 100) : null
                    const wh = wr.filter(r => getStatus(r.value, r.slot) === 'high').length
                    const wl = wr.filter(r => getStatus(r.value, r.slot) === 'low').length
                    const ws = new Date(wk[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    const we = new Date(wk[wk.length - 1] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric' })
                    return (<tr key={wi}><td className="td-left">Wk{wi + 1} {ws}–{we}</td><td>{wa ?? '—'}</td><td>{wp !== null ? <span className={`pill ${wp >= 70 ? 'pill-ok' : wp >= 50 ? 'pill-miss' : 'pill-high'}`}>{wp}%</span> : '—'}</td><td>{wh ? <span className="pill pill-high">{wh}</span> : '0'}</td><td>{wl ? <span className="pill pill-low">{wl}</span> : '0'}</td><td>{wr.length}</td></tr>)
                  })}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              {[['Month avg', monthAvg ? monthAvg + ' mg/dL' : '--', '#1D9E75'], ['In range', monthPct !== null ? monthPct + '%' : '--', '#1a1a1a'], ['High', String(monthHigh), monthHigh ? '#E24B4A' : '#1a1a1a'], ['Total', String(monthReadings.length), '#1a1a1a']].map(([l, v, c]) => (
                <div key={l} style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}><div style={{ fontSize: 11, color: '#666' }}>{l}</div><div style={{ fontSize: 22, fontWeight: 700, color: c }}>{v}</div></div>
              ))}
            </div>
            {hba1c && (<div className="card" style={{ marginBottom: 12 }}><p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8 }}>Estimated HbA1c</p><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 14 }}>Based on {monthReadings.length} readings</span><span className={`pill ${parseFloat(hba1c) < 7 ? 'pill-ok' : parseFloat(hba1c) < 9 ? 'pill-miss' : 'pill-high'}`} style={{ fontSize: 15 }}>~{hba1c}%</span></div><p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Target: below 7.0% — show this to your doctor</p></div>)}
            <div className="card"><p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Per-Meal Performance</p>
              <div style={{ overflowX: 'auto' }}><table><thead><tr><th style={{ textAlign: 'left' }}>Slot</th><th>Target</th><th>Avg</th><th>In Range</th><th>Result</th></tr></thead>
                <tbody>{mealPerf.map(mp => (<tr key={mp.i}><td className="td-left">{mp.s.short}</td><td style={{ fontSize: 11 }}>{mp.s.target.min}–{mp.s.target.max}</td><td>{mp.mavg ?? '—'}</td><td>{mp.mpct !== null ? `${mp.mpct}%` : '—'}</td><td><span className={`pill ${mp.result === 'Good' ? 'pill-ok' : mp.result === 'Fair' ? 'pill-miss' : mp.result === 'Poor' ? 'pill-high' : 'pill-miss'}`}>{mp.result}</span></td></tr>))}</tbody>
              </table></div>
            </div>
          </>)}
        </div>
      )}

      {/* REMINDERS */}
      {tab === 'remind' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Medication Reminders</p>
            {[{ icon: '💊', name: 'Morning medication', time: '7:00 AM' }, { icon: '💉', name: 'Evening medication', time: '8:00 PM' }].map((m, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: '1px solid #f0f0f0' }}>
                <span style={{ fontSize: 22 }}>{m.icon}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 500 }}>{m.name}</div><div style={{ fontSize: 12, color: '#888' }}>{m.time}</div></div>
                <div style={{ width: 51, height: 31, background: '#1D9E75', borderRadius: 16, position: 'relative' }}><div style={{ position: 'absolute', width: 27, height: 27, background: 'white', borderRadius: '50%', top: 2, left: 22 }} /></div>
              </div>
            ))}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Glucose Check Reminders</p>
            {[['🩸', 'Fasting (before breakfast)', '6:30 AM', true], ['🩸', 'After breakfast (2h)', '9:00 AM', true], ['🩸', 'After lunch (2h)', '2:00 PM', true], ['🩸', 'Before dinner', '7:00 PM', true], ['🩸', 'After dinner (2h)', '9:30 PM', false]].map(([icon, name, time, on], i, arr) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: i < arr.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                <span style={{ fontSize: 22 }}>{icon as string}</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 500 }}>{name as string}</div><div style={{ fontSize: 12, color: '#888' }}>{time as string}</div></div>
                <div style={{ width: 51, height: 31, background: on ? '#1D9E75' : '#ccc', borderRadius: 16, position: 'relative' }}><div style={{ position: 'absolute', width: 27, height: 27, background: 'white', borderRadius: '50%', top: 2, left: on ? 22 : 2 }} /></div>
              </div>
            ))}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Add Custom Medication</p>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Medication name</label><input type="text" className="form-input" value={medName} onChange={e => setMedName(e.target.value)} placeholder="e.g. Metformin 500mg" /></div>
            <div style={{ marginBottom: 14 }}><label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Time</label><input type="time" className="form-input" value={medTime} onChange={e => setMedTime(e.target.value)} /></div>
            <button className="btn-primary" onClick={addMed}>Add Reminder</button>
            {medications.map(m => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderTop: '1px solid #f0f0f0', marginTop: 8 }}>
                <span style={{ fontSize: 22 }}>💊</span>
                <div style={{ flex: 1 }}><div style={{ fontSize: 15, fontWeight: 500 }}>{m.name}</div><div style={{ fontSize: 12, color: '#888' }}>{m.time} every day</div></div>
                <div onClick={() => m.id && toggleMed(m.id, m.enabled)} style={{ width: 51, height: 31, background: m.enabled ? '#1D9E75' : '#ccc', borderRadius: 16, cursor: 'pointer', position: 'relative' }}><div style={{ position: 'absolute', width: 27, height: 27, background: 'white', borderRadius: '50%', top: 2, left: m.enabled ? 22 : 2 }} /></div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* TIPS */}
      {tab === 'tips' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>🤖 Ask GPT-4o Anything</p>
            <input type="text" className="form-input" value={askQ} onChange={e => setAskQ(e.target.value)} placeholder="e.g. Can I eat injera for dinner?" style={{ marginBottom: 10 }} onKeyDown={e => e.key === 'Enter' && askQuestion()} />
            <button className="btn-primary" onClick={askQuestion} disabled={askLoading}>{askLoading ? 'Thinking...' : 'Ask GPT-4o'}</button>
            {askAns && <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', borderRadius: '0 12px 12px 0', padding: 14, marginTop: 12 }}><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>GPT-4o Answer</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{askAns}</p></div>}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Tips for Diabetes in Ethiopia</p>
            {[['🍞', 'Injera & glucose', 'Injera has a moderate glycemic index. Pair with protein like eggs, lentils, tibs or shiro to slow sugar absorption.'],
              ['🚶', 'Walk after meals', 'A 15–30 min walk after eating can lower blood glucose by 20–40 mg/dL.'],
              ['💧', 'Drink more water', 'Drink 6–8 glasses daily. Dehydration raises blood glucose. Avoid sweet tea and juice.'],
              ['😴', 'Sleep & stress', 'Poor sleep and stress raise blood glucose. Aim for 7–8 hours of sleep.'],
              ['🚨', 'Emergency', 'Go to hospital if glucose is above 300 or below 60 mg/dL, or if you feel confused or very weak.']
            ].map(([icon, title, text]) => (
              <div key={title} style={{ background: title === 'Emergency' ? '#fff3f3' : '#f5f9f7', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: title === 'Emergency' ? '#c0392b' : '#085041', marginBottom: 4 }}>{icon} {title}</p>
                <p style={{ fontSize: 13, lineHeight: 1.5 }}>{text}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 200 }}>
        <nav style={{ display: 'flex', background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderTop: '0.5px solid #e8e8e8', padding: '8px 0 20px' }}>
          {([['home', '🏠', 'Home'], ['record', '➕', 'Record'], ['reports', '📊', 'Reports'], ['remind', '🔔', 'Remind'], ['tips', '💡', 'Tips']] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3, border: 'none', background: 'none', cursor: 'pointer', padding: '4px 2px', color: tab === t ? '#085041' : '#888', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 22 }}>{icon}</span>
              <span style={{ fontSize: 10, fontWeight: tab === t ? 600 : 400 }}>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
