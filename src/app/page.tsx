'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect, useRef } from 'react'
import { SLOTS, getStatus, getUserId, type Reading, type Medication } from '@/lib/supabase'
import { BarChart, Bar, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ── Singleton Supabase client ──────────────────────────────────────────────
let _db: SupabaseClient | null = null
function getDB(): SupabaseClient {
  if (!_db) {
    _db = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      { auth: { persistSession: false } }
    )
  }
  return _db
}

// ── Types ──────────────────────────────────────────────────────────────────
type MedWithDosage = Medication & { dosage?: string }

// ── Helpers ───────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
const fmtMonth = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })

// ── Notification helpers ───────────────────────────────────────────────────
async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  const result = await Notification.requestPermission()
  return result === 'granted'
}

function scheduleNotification(title: string, body: string, delayMs: number) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return
  setTimeout(() => {
    new Notification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: 'glucose-reminder',
    })
  }, delayMs)
}

function schedulePostMealReminder(slot: number, recordedAt: Date) {
  // 2 hours after recording, remind to check again
  const nextSlotNames: Record<number, string> = {
    0: 'After breakfast (2h)',
    2: 'After lunch (2h)',
    3: 'Before dinner',
    4: 'Bedtime check',
  }
  const nextSlot = nextSlotNames[slot]
  if (!nextSlot) return
  const twoHours = 2 * 60 * 60 * 1000
  const reminderTime = new Date(recordedAt.getTime() + twoHours)
  const delay = reminderTime.getTime() - Date.now()
  if (delay <= 0) return
  const timeStr = reminderTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  scheduleNotification(
    '🩸 Time to check your glucose',
    `It's time for your ${nextSlot} reading. Check now and record in Ahadu Glucose.`,
    delay
  )
  console.log(`Reminder scheduled for ${timeStr} — ${nextSlot}`)
}

function scheduleMedReminder(medName: string, dosage: string, timeStr: string) {
  const [hours, minutes] = timeStr.split(':').map(Number)
  const now = new Date()
  const reminderTime = new Date()
  reminderTime.setHours(hours, minutes, 0, 0)
  if (reminderTime <= now) reminderTime.setDate(reminderTime.getDate() + 1)
  const delay = reminderTime.getTime() - now.getTime()
  scheduleNotification(
    '💊 Medication Reminder',
    `Time to take ${medName}${dosage ? ` — ${dosage}` : ''}`,
    delay
  )
}

// ── Status components ─────────────────────────────────────────────────────
function StatusPill({ value, slot }: { value: number | null; slot: number }) {
  if (value === null) return <span className="pill pill-miss">—</span>
  const s = getStatus(value, slot)
  return <span className={`pill pill-${s === 'normal' ? 'ok' : s === 'high' ? 'high' : 'low'}`}>{value}</span>
}

function StatusBadge({ value, slot }: { value: number | null; slot: number }) {
  if (value === null) return <span className="pill pill-miss">Missing</span>
  const s = getStatus(value, slot)
  const t = SLOTS[slot].target
  if (s === 'normal') return <span className="pill pill-ok">✓ In range</span>
  if (s === 'high') return <span className="pill pill-high">↑ High +{value - t.max}</span>
  return <span className="pill pill-low">↓ Low</span>
}

async function fetchAIAdvice(readings: Reading[], question?: string): Promise<string> {
  const summary = readings.slice(-15).map(r =>
    `${r.date} ${SLOTS[r.slot].name}: ${r.value} mg/dL (${getStatus(r.value, r.slot)})`
  ).join(', ')
  const prompt = question ?? (readings.length
    ? `My recent glucose readings: ${summary}. Analyze and give specific practical advice.`
    : 'I am diabetic just starting to track glucose. Give me tips to get started.')
  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  })
  const data = await res.json()
  return data.advice || 'Could not get AI response.'
}

// ── Main App ──────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<'home' | 'record' | 'reports' | 'remind' | 'tips'>('home')
  const [readings, setReadings] = useState<Reading[]>([])
  const [medications, setMedications] = useState<MedWithDosage[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [notifPerm, setNotifPerm] = useState<'granted' | 'denied' | 'default' | 'unsupported'>('default')

  // record form
  const [rVal, setRVal] = useState('')
  const [rSlot, setRSlot] = useState(0)
  const [rDate, setRDate] = useState(todayStr())
  const [rNote, setRNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState('')

  // reports
  const [reportTab, setReportTab] = useState<'daily' | 'weekly' | 'monthly'>('daily')
  const [viewDay, setViewDay] = useState(todayStr())
  const [viewWeekOff, setViewWeekOff] = useState(0)
  const [viewMonthOff, setViewMonthOff] = useState(0)

  // AI
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askAns, setAskAns] = useState('')
  const [askLoading, setAskLoading] = useState(false)

  // medication form
  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medTime, setMedTime] = useState('08:00')
  const [medFreq, setMedFreq] = useState('daily')
  const [savingMed, setSavingMed] = useState(false)

  useEffect(() => {
    const uid = getUserId()
    setUserId(uid)
    loadData(uid)
    // Check notification permission
    if (!('Notification' in window)) {
      setNotifPerm('unsupported')
    } else {
      setNotifPerm(Notification.permission as 'granted' | 'denied' | 'default')
    }
  }, [])

  const loadData = async (uid: string) => {
    setLoading(true)
    try {
      const db = getDB()
      const [{ data: r, error: re }, { data: m, error: me }] = await Promise.all([
        db.from('readings').select('*').eq('user_id', uid).order('date', { ascending: false }).order('slot'),
        db.from('medications').select('*').eq('user_id', uid).order('created_at')
      ])
      if (re) console.error('Readings error:', re.message)
      if (me) console.error('Medications error:', me.message)
      setReadings(r || [])
      setMedications(m || [])
    } catch (e) {
      console.error('Load error:', e)
    }
    setLoading(false)
  }

  const requestNotif = async () => {
    const granted = await requestNotificationPermission()
    setNotifPerm(granted ? 'granted' : 'denied')
    if (granted) {
      scheduleNotification('✅ Notifications enabled!', 'Ahadu Glucose will now remind you to check your glucose and take medications.', 1000)
    }
  }

  const saveReading = async () => {
    const v = parseInt(rVal)
    if (!v || v < 20 || v > 600) return alert('Please enter a valid glucose value (20–600 mg/dL)')
    setSaving(true)
    setSaveMsg('')
    try {
      const db = getDB()
      const { error } = await db.from('readings').insert({
        user_id: userId,
        date: rDate,
        slot: rSlot,
        value: v,
        note: rNote || null
      })
      if (error) {
        console.error('Save error:', error)
        setSaveMsg('❌ Error saving: ' + error.message)
      } else {
        setSaveMsg('✅ Saved successfully!')
        setRVal('')
        setRNote('')
        await loadData(userId)
        // Schedule 2-hour post-meal reminder
        if (notifPerm === 'granted') {
          schedulePostMealReminder(rSlot, new Date())
        }
        triggerAI([...readings, { user_id: userId, date: rDate, slot: rSlot, value: v }])
        setTimeout(() => { setSaveMsg(''); setTab('home') }, 1500)
      }
    } catch (e) {
      setSaveMsg('❌ Connection error. Check internet.')
      console.error(e)
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

  const saveMed = async () => {
    if (!medName.trim()) return alert('Please enter medication name')
    setSavingMed(true)
    const db = getDB()
    const { error } = await db.from('medications').insert({
      user_id: userId,
      name: medName,
      dosage: medDosage || null,
      time: medTime,
      enabled: true,
      frequency: medFreq,
    })
    if (!error) {
      await loadData(userId)
      // Schedule daily reminder
      if (notifPerm === 'granted') {
        scheduleMedReminder(medName, medDosage, medTime)
      }
      setMedName(''); setMedDosage(''); setMedTime('08:00')
    }
    setSavingMed(false)
  }

  const toggleMed = async (id: string, enabled: boolean) => {
    const db = getDB()
    await db.from('medications').update({ enabled: !enabled }).eq('id', id)
    await loadData(userId)
  }

  const deleteMed = async (id: string) => {
    const db = getDB()
    await db.from('medications').delete().eq('id', id)
    await loadData(userId)
  }

  // ── Derived data ─────────────────────────────────────────────────────────
  const todayReadings = readings.filter(r => r.date === todayStr())
  const lastReading = readings[0] ?? null
  const todayAvg = todayReadings.length ? Math.round(todayReadings.reduce((a, r) => a + r.value, 0) / todayReadings.length) : null

  const chartData = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const dk = d.toISOString().slice(0, 10)
    const dayR = readings.filter(r => r.date === dk)
    const avg = dayR.length ? Math.round(dayR.reduce((a, r) => a + r.value, 0) / dayR.length) : null
    return { day: d.toLocaleDateString(undefined, { weekday: 'short' }), avg }
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
  const monthPct = monthReadings.length ? Math.round(monthReadings.filter(r => getStatus(r.value, r.slot) === 'normal').length / monthReadings.length * 100) : null
  const monthHigh = monthReadings.filter(r => getStatus(r.value, r.slot) === 'high').length
  const hba1c = monthAvg ? ((monthAvg + 46.7) / 28.7).toFixed(1) : null

  const mDays = Array.from({ length: new Date(mYear, mMonth + 1, 0).getDate() }, (_, i) => new Date(mYear, mMonth, i + 1).toISOString().slice(0, 10))
  const mWeeks: string[][] = []; let cur: string[] = []
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

  const S = (label: string, val: string | number, color = '#1a1a1a', sub = '') => (
    <div style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 22, fontWeight: 700, color }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: '#888' }}>{sub}</div>}
    </div>
  )

  const ChevBtn = ({ onClick, children }: { onClick: () => void; children: string }) => (
    <button onClick={onClick} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14, cursor: 'pointer' }}>{children}</button>
  )

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
            <p style={{ fontSize: 11, opacity: .75, marginTop: 2 }}>GPT-4o · Supabase Cloud</p>
          </div>
          <div style={{ background: 'rgba(255,255,255,.2)', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
            {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          </div>
        </div>
      </div>

      {/* ── HOME ── */}
      {tab === 'home' && (
        <div style={{ padding: '16px 14px' }}>
          {/* Notification banner */}
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <div style={{ background: '#FFF8E1', border: '1.5px solid #FFC107', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#7d4e00' }}>Enable reminders</div>
                <div style={{ fontSize: 11, color: '#7d4e00' }}>Get notified to check glucose & take medication</div>
              </div>
              <button onClick={requestNotif} style={{ background: '#FFC107', border: 'none', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Allow</button>
            </div>
          )}

          {lastReading && lastReading.value >= 250 && (
            <div style={{ background: '#fff3f3', border: '1.5px solid #E24B4A', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#c0392b', fontWeight: 500 }}>⚠️ {lastReading.value} mg/dL is very high. Drink water, avoid food, contact your doctor.</p>
            </div>
          )}
          {lastReading && lastReading.value < 70 && (
            <div style={{ background: '#fffbf0', border: '1.5px solid #BA7517', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}>
              <p style={{ fontSize: 13, color: '#7d4e00', fontWeight: 500 }}>⚠️ {lastReading.value} mg/dL is low. Eat something sweet immediately.</p>
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
            {S("Today's average", todayAvg ?? '--', '#1D9E75', 'mg/dL')}
            {S("Today's readings", todayReadings.length, '#1a1a1a', 'of 5 slots')}
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
              {aiLoading
                ? <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>GPT-4o is analyzing your readings...</p>
                : aiText
                  ? <><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>GPT-4o Advice</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{aiText}</p></>
                  : <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>Add your first reading — AI will analyze and advise you.</p>}
            </div>
            <button className="btn-dark" style={{ marginTop: 10 }} onClick={askGPT} disabled={aiLoading}>{aiLoading ? 'Thinking...' : 'Ask AI for Advice Now'}</button>
          </div>
        </div>
      )}

      {/* ── RECORD ── */}
      {tab === 'record' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Record Blood Glucose</p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Blood glucose (mg/dL)</label>
              <input type="number" className="form-input" value={rVal} onChange={e => setRVal(e.target.value)} placeholder="e.g. 118" inputMode="numeric" style={{ fontSize: 24, fontWeight: 700, textAlign: 'center', padding: '14px' }} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Meal slot</label>
                <select className="form-input" value={rSlot} onChange={e => setRSlot(+e.target.value)}>
                  {SLOTS.map((s, i) => <option key={i} value={i}>{s.name}</option>)}
                </select>
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
            {saveMsg && <div style={{ padding: '10px 14px', borderRadius: 10, background: saveMsg.includes('✅') ? '#E1F5EE' : '#fff3f3', color: saveMsg.includes('✅') ? '#085041' : '#c0392b', fontSize: 13, fontWeight: 500, marginBottom: 10, textAlign: 'center' }}>{saveMsg}</div>}
            <button className="btn-primary" onClick={saveReading} disabled={saving}>{saving ? 'Saving to cloud...' : '💾 Save Reading'}</button>
            {notifPerm === 'granted' && <p style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 8 }}>🔔 You&apos;ll be reminded to check again in 2 hours</p>}
          </div>

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Today&apos;s Log</p>
            {todayReadings.length === 0
              ? <p style={{ color: '#888', fontSize: 14, textAlign: 'center', padding: '20px 0' }}>No readings today</p>
              : todayReadings.map((r, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: idx < todayReadings.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ width: 12, height: 12, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 17, fontWeight: 600 }}>{r.value} mg/dL</div>
                    <div style={{ fontSize: 12, color: '#888' }}>{SLOTS[r.slot].name}{r.note ? ` · ${r.note}` : ''}</div>
                  </div>
                  <StatusBadge value={r.value} slot={r.slot} />
                </div>
              ))
            }
          </div>

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Recent History</p>
            {readings.length === 0
              ? <p style={{ color: '#888', fontSize: 13, textAlign: 'center', padding: '16px 0' }}>No readings yet</p>
              : readings.slice(0, 20).map((r, idx) => (
                <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: idx < 19 ? '1px solid #f0f0f0' : 'none' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{r.value} mg/dL</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{r.date} · {SLOTS[r.slot].name}</div>
                  </div>
                  <StatusBadge value={r.value} slot={r.slot} />
                </div>
              ))
            }
          </div>
        </div>
      )}

      {/* ── REPORTS ── */}
      {tab === 'reports' && (
        <div style={{ padding: '16px 14px' }}>
          <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', padding: '12px 14px', borderRadius: '0 12px 12px 0', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#085041', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.4px' }}>Your Targets (Hospital Form)</p>
            {[['Before breakfast', '80–130'], ['After breakfast 2h', '80–180'], ['After lunch 2h', '80–180'], ['Before dinner', '80–180'], ['After dinner 2h', '80–180']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '3px 0' }}>
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
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Daily Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() - 1); setViewDay(d.toISOString().slice(0, 10)) }}>‹</ChevBtn>
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 90, textAlign: 'center' }}>{fmtDate(viewDay)}</span>
                  <ChevBtn onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() + 1); setViewDay(d.toISOString().slice(0, 10)) }}>›</ChevBtn>
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left' }}>Slot</th><th>Target</th><th>Reading</th><th>Status</th></tr></thead>
                  <tbody>{dailyData.map((d, i) => (<tr key={i}><td className="td-left">{d.slot.name}</td><td style={{ fontSize: 11, color: '#888' }}>{d.slot.target.min}–{d.slot.target.max}</td><td><StatusPill value={d.value} slot={d.i} /></td><td><StatusBadge value={d.value} slot={d.i} /></td></tr>))}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {S('Day average', dailyAvg ? dailyAvg + ' mg/dL' : '--', '#1D9E75')}
              {S('In range', dailyVals.length ? `${dailyInRange}/${dailyVals.length}` : '--')}
              {S('High', dailyHigh, dailyHigh ? '#E24B4A' : '#1a1a1a')}
              {S('Low', dailyLow, dailyLow ? '#BA7517' : '#1a1a1a')}
            </div>
          </>)}

          {reportTab === 'weekly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Weekly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => setViewWeekOff(v => v - 1)}>‹</ChevBtn>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 100, textAlign: 'center' }}>{weekLabel}</span>
                  <ChevBtn onClick={() => setViewWeekOff(v => v + 1)}>›</ChevBtn>
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
              {S('Week avg', weekAvg ? weekAvg + ' mg/dL' : '--', '#1D9E75')}
              {S('In range', weekPct !== null ? weekPct + '%' : '--')}
              {S('High', weekHigh, weekHigh ? '#E24B4A' : '#1a1a1a')}
              {S('Total', weekReadings.length)}
            </div>
          </>)}

          {reportTab === 'monthly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Monthly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => setViewMonthOff(v => v - 1)}>‹</ChevBtn>
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 80, textAlign: 'center' }}>{fmtMonth(mYear, mMonth)}</span>
                  <ChevBtn onClick={() => setViewMonthOff(v => v + 1)}>›</ChevBtn>
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
              {S('Month avg', monthAvg ? monthAvg + ' mg/dL' : '--', '#1D9E75')}
              {S('In range', monthPct !== null ? monthPct + '%' : '--')}
              {S('High', monthHigh, monthHigh ? '#E24B4A' : '#1a1a1a')}
              {S('Total', monthReadings.length)}
            </div>
            {hba1c && <div className="card" style={{ marginBottom: 12 }}><p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 8 }}>Estimated HbA1c</p><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span>Based on {monthReadings.length} readings</span><span className={`pill ${parseFloat(hba1c) < 7 ? 'pill-ok' : parseFloat(hba1c) < 9 ? 'pill-miss' : 'pill-high'}`} style={{ fontSize: 15 }}>~{hba1c}%</span></div><p style={{ fontSize: 12, color: '#888', marginTop: 6 }}>Target: below 7.0% — show to your doctor</p></div>}
            <div className="card"><p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>Per-Meal Performance</p>
              <div style={{ overflowX: 'auto' }}><table><thead><tr><th style={{ textAlign: 'left' }}>Slot</th><th>Target</th><th>Avg</th><th>In Range</th><th>Result</th></tr></thead>
                <tbody>{mealPerf.map(mp => (<tr key={mp.i}><td className="td-left">{mp.s.short}</td><td style={{ fontSize: 11 }}>{mp.s.target.min}–{mp.s.target.max}</td><td>{mp.mavg ?? '—'}</td><td>{mp.mpct !== null ? `${mp.mpct}%` : '—'}</td><td><span className={`pill ${mp.result === 'Good' ? 'pill-ok' : mp.result === 'Fair' ? 'pill-miss' : mp.result === 'Poor' ? 'pill-high' : 'pill-miss'}`}>{mp.result}</span></td></tr>))}</tbody>
              </table></div>
            </div>
          </>)}
        </div>
      )}

      {/* ── REMINDERS ── */}
      {tab === 'remind' && (
        <div style={{ padding: '16px 14px' }}>

          {/* Notification permission */}
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🔔 Notification Permission</p>
            {notifPerm === 'granted'
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#E1F5EE', borderRadius: 10 }}><span style={{ fontSize: 20 }}>✅</span><div><div style={{ fontSize: 13, fontWeight: 600, color: '#085041' }}>Notifications enabled</div><div style={{ fontSize: 11, color: '#0F6E56' }}>You will receive glucose & medication reminders</div></div></div>
              : notifPerm === 'denied'
                ? <div style={{ padding: '10px 14px', background: '#fff3f3', borderRadius: 10 }}><p style={{ fontSize: 13, color: '#c0392b' }}>❌ Notifications blocked. Go to browser settings → allow notifications for this site.</p></div>
                : <div>
                  <p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>Allow notifications to get reminders to check glucose after meals and take your medications on time.</p>
                  <button className="btn-primary" onClick={requestNotif}>🔔 Allow Notifications</button>
                </div>
            }
          </div>

          {/* Add medication */}
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>💊 Add Medication</p>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Medication name</label>
              <input type="text" className="form-input" value={medName} onChange={e => setMedName(e.target.value)} placeholder="e.g. Metformin" />
            </div>
            <div style={{ marginBottom: 10 }}>
              <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Dosage</label>
              <input type="text" className="form-input" value={medDosage} onChange={e => setMedDosage(e.target.value)} placeholder="e.g. 500mg, 1 tablet, 2 units" />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Time</label>
                <input type="time" className="form-input" value={medTime} onChange={e => setMedTime(e.target.value)} />
              </div>
              <div>
                <label style={{ fontSize: 13, fontWeight: 500, color: '#666', display: 'block', marginBottom: 6 }}>Frequency</label>
                <select className="form-input" value={medFreq} onChange={e => setMedFreq(e.target.value)}>
                  <option value="daily">Every day</option>
                  <option value="morning">Morning only</option>
                  <option value="evening">Evening only</option>
                  <option value="twice">Twice daily</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
            <button className="btn-primary" onClick={saveMed} disabled={savingMed}>{savingMed ? 'Saving...' : '+ Add Medication'}</button>
          </div>

          {/* Medication list */}
          {medications.length > 0 && (
            <div className="card">
              <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>My Medications</p>
              {medications.map((m, idx) => (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 0', borderBottom: idx < medications.length - 1 ? '1px solid #f0f0f0' : 'none' }}>
                  <span style={{ fontSize: 22 }}>💊</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 15, fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: 12, color: '#666' }}>
                      {(m as MedWithDosage).dosage && <span style={{ background: '#E1F5EE', color: '#085041', padding: '1px 7px', borderRadius: 8, marginRight: 6, fontWeight: 500 }}>{(m as MedWithDosage).dosage}</span>}
                      {m.time} · {(m as any).frequency || 'daily'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <div onClick={() => m.id && toggleMed(m.id, m.enabled)} style={{ width: 46, height: 27, background: m.enabled ? '#1D9E75' : '#ccc', borderRadius: 14, cursor: 'pointer', position: 'relative', flexShrink: 0 }}>
                      <div style={{ position: 'absolute', width: 23, height: 23, background: 'white', borderRadius: '50%', top: 2, left: m.enabled ? 21 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)' }} />
                    </div>
                    <button onClick={() => m.id && deleteMed(m.id)} style={{ background: '#fff3f3', border: 'none', borderRadius: 8, padding: '4px 10px', fontSize: 12, color: '#c0392b', cursor: 'pointer' }}>✕</button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Smart glucose reminders info */}
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>⏰ Smart Glucose Reminders</p>
            <div style={{ background: '#f5f9f7', borderRadius: 10, padding: 12 }}>
              <p style={{ fontSize: 13, color: '#333', lineHeight: 1.6 }}>When you record a reading, the app automatically schedules a reminder for your next check:</p>
              <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[['Before breakfast', '→ After breakfast (2h)'], ['After lunch (2h)', '→ Before dinner'], ['Before dinner', '→ After dinner (2h)'], ['After dinner', '→ Bedtime check']].map(([from, to]) => (
                  <div key={from} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
                    <span style={{ color: '#1D9E75', fontWeight: 600, minWidth: 120 }}>{from}</span>
                    <span style={{ color: '#888' }}>{to}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TIPS ── */}
      {tab === 'tips' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>🤖 Ask GPT-4o Anything</p>
            <input type="text" className="form-input" value={askQ} onChange={e => setAskQ(e.target.value)} placeholder="e.g. Can I eat injera for dinner?" style={{ marginBottom: 10 }} onKeyDown={e => e.key === 'Enter' && askQuestion()} />
            <button className="btn-primary" onClick={askQuestion} disabled={askLoading}>{askLoading ? 'Thinking...' : 'Ask GPT-4o'}</button>
            {askAns && <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', borderRadius: '0 12px 12px 0', padding: 14, marginTop: 12 }}><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>GPT-4o Answer</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{askAns}</p></div>}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Diabetes Tips for Ethiopia</p>
            {[['🍞', 'Injera & glucose', 'Pair injera with protein like lentils, tibs, or shiro to slow sugar absorption.'],
              ['🚶', 'Walk after meals', 'A 15–30 min walk after eating lowers blood glucose by 20–40 mg/dL.'],
              ['💧', 'Drink water', 'Drink 6–8 glasses daily. Avoid sweet tea and fruit juice.'],
              ['😴', 'Sleep & stress', 'Poor sleep raises glucose. Aim for 7–8 hours.'],
              ['🚨', 'Emergency', 'Hospital if above 300 or below 60 mg/dL, or if confused/very weak.'],
            ].map(([icon, title, text]) => (
              <div key={title as string} style={{ background: title === 'Emergency' ? '#fff3f3' : '#f5f9f7', borderRadius: 12, padding: '12px 14px', marginBottom: 10 }}>
                <p style={{ fontSize: 13, fontWeight: 700, color: title === 'Emergency' ? '#c0392b' : '#085041', marginBottom: 4 }}>{icon} {title}</p>
                <p style={{ fontSize: 13, lineHeight: 1.5 }}>{text as string}</p>
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
