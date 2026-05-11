'use client'
export const dynamic = 'force-dynamic'

import { useState, useEffect } from 'react'
import { SLOTS, getStatus, getUserId, type Reading, type Medication } from '@/lib/supabase'
import { BarChart, Bar, LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip, PieChart, Pie, Cell } from 'recharts'
import { createClient, SupabaseClient } from '@supabase/supabase-js'

// ── Singleton DB ───────────────────────────────────────────────────────────
let _db: SupabaseClient | null = null
function getDB(): SupabaseClient {
  if (!_db) _db = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } }
  )
  return _db
}

// ── Types ──────────────────────────────────────────────────────────────────
type Tab = 'home' | 'record' | 'reports' | 'analytics' | 'remind' | 'tips'
type MedFull = Medication & { dosage?: string; frequency?: string }
type DoseLog = { id?: string; user_id: string; medication_id: string; medication_name: string; dosage?: string; taken_at: string }

// ── Helpers ────────────────────────────────────────────────────────────────
const todayStr = () => new Date().toISOString().slice(0, 10)
const fmtDate = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
const fmtMonth = (y: number, m: number) => new Date(y, m, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
const C = (col: string, style?: React.CSSProperties, children?: React.ReactNode) => <div style={{ ...style }}>{children}</div>

// ── Notifications ──────────────────────────────────────────────────────────
async function requestNotifPerm() {
  if (!('Notification' in window)) return false
  if (Notification.permission === 'granted') return true
  return (await Notification.requestPermission()) === 'granted'
}
function notify(title: string, body: string, delayMs = 0) {
  if (typeof window === 'undefined' || !('Notification' in window) || Notification.permission !== 'granted') return
  setTimeout(() => new Notification(title, { body, icon: '/icon-192.png', tag: 'glucose' }), delayMs)
}
function schedulePostMeal(slot: number) {
  const map: Record<number, string> = { 0: 'After breakfast (2h)', 2: 'After lunch (2h)', 3: 'Before dinner', 4: 'Bedtime check' }
  const next = map[slot]; if (!next) return
  const t = new Date(Date.now() + 2 * 60 * 60 * 1000)
  const ts = t.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  notify('🩸 Time to check your glucose', `It's ${ts} — time for your ${next} reading.`, 2 * 60 * 60 * 1000)
}
function scheduleMedNotif(name: string, dosage: string, timeStr: string) {
  const [h, m] = timeStr.split(':').map(Number)
  const t = new Date(); t.setHours(h, m, 0, 0)
  if (t <= new Date()) t.setDate(t.getDate() + 1)
  notify(`💊 Take ${name}`, dosage ? `Dose: ${dosage}` : 'Time to take your medication', t.getTime() - Date.now())
}

// ── Report generator ───────────────────────────────────────────────────────
function buildReport(readings: Reading[], medications: MedFull[], period: string): string {
  const now = new Date()
  const dateStr = now.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })
  const avg = readings.length ? Math.round(readings.reduce((a, r) => a + r.value, 0) / readings.length) : 0
  const inRange = readings.filter(r => getStatus(r.value, r.slot) === 'normal').length
  const high = readings.filter(r => getStatus(r.value, r.slot) === 'high').length
  const low = readings.filter(r => getStatus(r.value, r.slot) === 'low').length
  const pct = readings.length ? Math.round(inRange / readings.length * 100) : 0
  const hba1c = avg ? ((avg + 46.7) / 28.7).toFixed(1) : 'N/A'
  const recent = readings.slice(0, 10).map(r => `  • ${r.date} ${SLOTS[r.slot].name}: ${r.value} mg/dL (${getStatus(r.value, r.slot)})`).join('\n')
  const meds = medications.map(m => `  • ${m.name}${m.dosage ? ' ' + m.dosage : ''} — ${m.time} ${m.frequency || 'daily'}`).join('\n')

  return `📊 BLOOD GLUCOSE REPORT — ${period.toUpperCase()}
Generated: ${dateStr}
Patient: John (Ahadu Market CEO, Addis Ababa)

━━━━━━━━━━━━━━━━━━━━━
📈 SUMMARY
━━━━━━━━━━━━━━━━━━━━━
Total readings: ${readings.length}
Average glucose: ${avg} mg/dL
In target range: ${pct}% (${inRange}/${readings.length})
High readings: ${high}
Low readings: ${low}
Est. HbA1c: ~${hba1c}%

🎯 TARGETS (Hospital Form)
Before breakfast: 80–130 mg/dL
After meals (2h): 80–180 mg/dL

━━━━━━━━━━━━━━━━━━━━━
📋 RECENT READINGS
━━━━━━━━━━━━━━━━━━━━━
${recent || '  No readings recorded'}

━━━━━━━━━━━━━━━━━━━━━
💊 CURRENT MEDICATIONS
━━━━━━━━━━━━━━━━━━━━━
${meds || '  No medications recorded'}

━━━━━━━━━━━━━━━━━━━━━
Sent via My Diabetes Manager App
https://diabetics-manager.vercel.app`
}

function sendWhatsApp(phone: string, message: string) {
  const clean = phone.replace(/\D/g, '')
  const url = `https://wa.me/${clean}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank')
}

function sendTelegram(username: string, message: string) {
  const clean = username.replace('@', '')
  const url = `https://t.me/${clean}?text=${encodeURIComponent(message)}`
  window.open(url, '_blank')
}

// ── Status pills ───────────────────────────────────────────────────────────
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

async function fetchAI(readings: Reading[], question?: string) {
  const summary = readings.slice(-15).map(r => `${r.date} ${SLOTS[r.slot].name}: ${r.value} mg/dL (${getStatus(r.value, r.slot)})`).join(', ')
  const prompt = question ?? (readings.length ? `My recent glucose: ${summary}. Give specific practical advice.` : 'I just started tracking diabetes. Give me tips.')
  const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
  return (await res.json()).advice || 'No response.'
}

// ── Main ───────────────────────────────────────────────────────────────────
export default function App() {
  const [tab, setTab] = useState<Tab>('home')
  const [readings, setReadings] = useState<Reading[]>([])
  const [medications, setMedications] = useState<MedFull[]>([])
  const [doseLogs, setDoseLogs] = useState<DoseLog[]>([])
  const [userId, setUserId] = useState('')
  const [loading, setLoading] = useState(true)
  const [notifPerm, setNotifPerm] = useState<string>('default')

  // record
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

  // doctor
  const [drName, setDrName] = useState('')
  const [drPhone, setDrPhone] = useState('')
  const [drTelegram, setDrTelegram] = useState('')
  const [reportPeriod, setReportPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly')
  const [showDrForm, setShowDrForm] = useState(false)

  // AI
  const [aiText, setAiText] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [askQ, setAskQ] = useState('')
  const [askAns, setAskAns] = useState('')
  const [askLoading, setAskLoading] = useState(false)

  // medication
  const [medName, setMedName] = useState('')
  const [medDosage, setMedDosage] = useState('')
  const [medTime, setMedTime] = useState('08:00')
  const [medFreq, setMedFreq] = useState('daily')
  const [savingMed, setSavingMed] = useState(false)

  useEffect(() => {
    const uid = getUserId(); setUserId(uid); loadData(uid)
    if (!('Notification' in window)) setNotifPerm('unsupported')
    else setNotifPerm(Notification.permission)
    // Load saved doctor info
    const saved = localStorage.getItem('dr_info')
    if (saved) { const d = JSON.parse(saved); setDrName(d.name||''); setDrPhone(d.phone||''); setDrTelegram(d.telegram||'') }
  }, [])

  const saveDrInfo = () => {
    localStorage.setItem('dr_info', JSON.stringify({ name: drName, phone: drPhone, telegram: drTelegram }))
    setShowDrForm(false)
  }

  const loadData = async (uid: string) => {
    setLoading(true)
    try {
      const db = getDB()
      const [{ data: r }, { data: m }, { data: d }] = await Promise.all([
        db.from('readings').select('*').eq('user_id', uid).order('date', { ascending: false }).order('slot'),
        db.from('medications').select('*').eq('user_id', uid).order('created_at'),
        db.from('dose_logs').select('*').eq('user_id', uid).order('taken_at', { ascending: false }).limit(50)
      ])
      setReadings(r || [])
      setMedications(m || [])
      setDoseLogs(d || [])
    } catch (e) { console.error(e) }
    setLoading(false)
  }

  const saveReading = async () => {
    const v = parseInt(rVal)
    if (!v || v < 20 || v > 600) return alert('Enter a valid value (20–600 mg/dL)')
    setSaving(true); setSaveMsg('')
    try {
      const { error } = await getDB().from('readings').insert({ user_id: userId, date: rDate, slot: rSlot, value: v, note: rNote || null })
      if (error) { setSaveMsg('❌ ' + error.message) }
      else {
        setSaveMsg('✅ Saved to cloud!')
        setRVal(''); setRNote('')
        await loadData(userId)
        if (notifPerm === 'granted') schedulePostMeal(rSlot)
        triggerAI([...readings, { user_id: userId, date: rDate, slot: rSlot, value: v }])
        setTimeout(() => { setSaveMsg(''); setTab('home') }, 1500)
      }
    } catch (e) { setSaveMsg('❌ Connection error') }
    setSaving(false)
  }

  const logDose = async (med: MedFull) => {
    const { error } = await getDB().from('dose_logs').insert({
      user_id: userId,
      medication_id: med.id || '',
      medication_name: med.name,
      dosage: med.dosage || null,
      taken_at: new Date().toISOString()
    })
    if (!error) { await loadData(userId); notify('✅ Dose logged', `${med.name}${med.dosage ? ' ' + med.dosage : ''} recorded at ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`) }
  }

  const saveMed = async () => {
    if (!medName.trim()) return alert('Enter medication name')
    setSavingMed(true)
    const { error } = await getDB().from('medications').insert({ user_id: userId, name: medName, dosage: medDosage || null, time: medTime, enabled: true, frequency: medFreq })
    if (!error) {
      await loadData(userId)
      if (notifPerm === 'granted') scheduleMedNotif(medName, medDosage, medTime)
      setMedName(''); setMedDosage(''); setMedTime('08:00')
    }
    setSavingMed(false)
  }

  const deleteMed = async (id: string) => {
    await getDB().from('medications').delete().eq('id', id)
    await loadData(userId)
  }

  const toggleMed = async (id: string, enabled: boolean) => {
    await getDB().from('medications').update({ enabled: !enabled }).eq('id', id)
    await loadData(userId)
  }

  const askQuestion = async () => {
    if (!askQ.trim()) return
    setAskLoading(true)
    const txt = await fetchAI(readings, askQ)
    setAskAns(txt)
    setAskLoading(false)
  }

  const triggerAI = async (r: Reading[]) => {
    setAiLoading(true)
    setAiText(await fetchAI(r))
    setAiLoading(false)
  }

  const sendReport = (via: 'whatsapp' | 'telegram') => {
    const now = new Date()
    let filtered = readings
    if (reportPeriod === 'daily') filtered = readings.filter(r => r.date === todayStr())
    else if (reportPeriod === 'weekly') {
      const week = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - i); return d.toISOString().slice(0, 10) })
      filtered = readings.filter(r => week.includes(r.date))
    } else {
      filtered = readings.filter(r => r.date.startsWith(now.toISOString().slice(0, 7)))
    }
    const msg = buildReport(filtered, medications, reportPeriod)
    if (via === 'whatsapp') sendWhatsApp(drPhone, msg)
    else sendTelegram(drTelegram, msg)
  }

  // ── Derived ───────────────────────────────────────────────────────────────
  const todayR = readings.filter(r => r.date === todayStr())
  const last = readings[0] ?? null
  const todayAvg = todayR.length ? Math.round(todayR.reduce((a, r) => a + r.value, 0) / todayR.length) : null
  const lastColor = last ? (getStatus(last.value, last.slot) === 'high' ? '#E24B4A' : getStatus(last.value, last.slot) === 'low' ? '#BA7517' : '#1D9E75') : '#1D9E75'

  const chart7 = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i))
    const dk = d.toISOString().slice(0, 10)
    const dr = readings.filter(r => r.date === dk)
    return { day: d.toLocaleDateString(undefined, { weekday: 'short' }), avg: dr.length ? Math.round(dr.reduce((a, r) => a + r.value, 0) / dr.length) : null }
  })

  // Analytics
  const allVals = readings.map(r => r.value)
  const anaAvg = allVals.length ? Math.round(allVals.reduce((a, b) => a + b, 0) / allVals.length) : 0
  const anaMax = allVals.length ? Math.max(...allVals) : 0
  const anaMin = allVals.length ? Math.min(...allVals) : 0
  const anaInRange = readings.filter(r => getStatus(r.value, r.slot) === 'normal').length
  const anaHigh = readings.filter(r => getStatus(r.value, r.slot) === 'high').length
  const anaLow = readings.filter(r => getStatus(r.value, r.slot) === 'low').length
  const anaPct = readings.length ? Math.round(anaInRange / readings.length * 100) : 0
  const hba1cAll = anaAvg ? ((anaAvg + 46.7) / 28.7).toFixed(1) : null

  const pieData = [
    { name: 'In range', value: anaInRange, color: '#1D9E75' },
    { name: 'High', value: anaHigh, color: '#E24B4A' },
    { name: 'Low', value: anaLow, color: '#BA7517' },
  ].filter(d => d.value > 0)

  const slotPerf = SLOTS.map((s, i) => {
    const sr = readings.filter(r => r.slot === i)
    const savg = sr.length ? Math.round(sr.reduce((a, r) => a + r.value, 0) / sr.length) : null
    const sinR = sr.filter(r => getStatus(r.value, i) === 'normal').length
    const spct = sr.length ? Math.round(sinR / sr.length * 100) : null
    return { s, i, savg, spct, count: sr.length }
  })

  // 30-day trend
  const trend30 = Array.from({ length: 30 }, (_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (29 - i))
    const dk = d.toISOString().slice(0, 10)
    const dr = readings.filter(r => r.date === dk)
    return { date: d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), avg: dr.length ? Math.round(dr.reduce((a, r) => a + r.value, 0) / dr.length) : null }
  }).filter(d => d.avg !== null)

  // Risk score
  const riskScore = Math.min(100, Math.round((anaHigh / Math.max(1, readings.length)) * 60 + (anaLow / Math.max(1, readings.length)) * 40 + (anaAvg > 200 ? 20 : anaAvg > 160 ? 10 : 0)))
  const riskLabel = riskScore < 20 ? 'Low Risk' : riskScore < 50 ? 'Moderate' : 'High Risk'
  const riskColor = riskScore < 20 ? '#1D9E75' : riskScore < 50 ? '#BA7517' : '#E24B4A'

  // Reports helpers
  const dailyData = SLOTS.map((s, i) => { const r = readings.find(r => r.date === viewDay && r.slot === i); return { slot: s, i, value: r?.value ?? null } })
  const dailyVals = dailyData.filter(d => d.value !== null)
  const dailyAvg = dailyVals.length ? Math.round(dailyVals.reduce((a, d) => a + d.value!, 0) / dailyVals.length) : null

  const weekDays = Array.from({ length: 7 }, (_, i) => { const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + i + viewWeekOff * 7); return d.toISOString().slice(0, 10) })
  const weekR = readings.filter(r => weekDays.includes(r.date))
  const weekAvg = weekR.length ? Math.round(weekR.reduce((a, r) => a + r.value, 0) / weekR.length) : null
  const weekPct = weekR.length ? Math.round(weekR.filter(r => getStatus(r.value, r.slot) === 'normal').length / weekR.length * 100) : null

  const nowM = new Date(); nowM.setMonth(nowM.getMonth() + viewMonthOff)
  const mY = nowM.getFullYear(); const mM = nowM.getMonth()
  const monthR = readings.filter(r => r.date.startsWith(`${mY}-${String(mM + 1).padStart(2, '0')}`))
  const monthAvg = monthR.length ? Math.round(monthR.reduce((a, r) => a + r.value, 0) / monthR.length) : null
  const monthPct = monthR.length ? Math.round(monthR.filter(r => getStatus(r.value, r.slot) === 'normal').length / monthR.length * 100) : null
  const mhba1c = monthAvg ? ((monthAvg + 46.7) / 28.7).toFixed(1) : null
  const mDays = Array.from({ length: new Date(mY, mM + 1, 0).getDate() }, (_, i) => new Date(mY, mM, i + 1).toISOString().slice(0, 10))
  const mWeeks: string[][] = []; let cur: string[] = []
  mDays.forEach(d => { cur.push(d); if (new Date(d + 'T00:00:00').getDay() === 0) { mWeeks.push([...cur]); cur = [] } }); if (cur.length) mWeeks.push(cur)

  const Btn = ({ children, onClick, disabled, style }: any) => (
    <button onClick={onClick} disabled={disabled} style={{ border: 'none', cursor: disabled ? 'not-allowed' : 'pointer', fontFamily: 'inherit', opacity: disabled ? 0.6 : 1, ...style }}>{children}</button>
  )
  const ChevBtn = ({ onClick, ch }: { onClick: () => void; ch: string }) => (
    <Btn onClick={onClick} style={{ border: '1.5px solid #e0e0e0', background: 'white', borderRadius: 8, padding: '4px 12px', fontSize: 14 }}>{ch}</Btn>
  )
  const StatCard = ({ label, val, color = '#1a1a1a', sub = '' }: any) => (
    <div style={{ background: '#f5f9f7', borderRadius: 12, padding: '12px 14px' }}>
      <div style={{ fontSize: 11, color: '#666' }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color }}>{val}</div>
      {sub && <div style={{ fontSize: 10, color: '#888' }}>{sub}</div>}
    </div>
  )

  if (loading) return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', flexDirection: 'column', gap: 16 }}>
      <div style={{ width: 48, height: 48, border: '4px solid #e0e0e0', borderTopColor: '#1D9E75', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
      <p style={{ color: '#666', fontSize: 14 }}>Loading My Diabetes Manager...</p>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </div>
  )

  return (
    <div style={{ maxWidth: 430, margin: '0 auto', paddingBottom: 80 }}>

      {/* HEADER */}
      <div style={{ background: 'linear-gradient(135deg, #085041, #1D9E75)', color: 'white', padding: '52px 18px 18px', position: 'sticky', top: 0, zIndex: 100 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <h1 style={{ fontSize: 19, fontWeight: 700, letterSpacing: -0.3 }}>My Diabetes Manager</h1>
            <p style={{ fontSize: 11, opacity: .8, marginTop: 2 }}>GPT-4o AI · Supabase Cloud · v2.0</p>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ background: 'rgba(255,255,255,.2)', padding: '4px 10px', borderRadius: 20, fontSize: 11, fontWeight: 500 }}>
              {new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
            </div>
          </div>
        </div>
      </div>

      {/* ── HOME ── */}
      {tab === 'home' && (
        <div style={{ padding: '16px 14px' }}>
          {notifPerm !== 'granted' && notifPerm !== 'unsupported' && (
            <div style={{ background: '#FFF8E1', border: '1.5px solid #FFC107', borderRadius: 12, padding: '12px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <div style={{ flex: 1 }}><div style={{ fontSize: 13, fontWeight: 600, color: '#7d4e00' }}>Enable reminders</div><div style={{ fontSize: 11, color: '#7d4e00' }}>Get notified for glucose checks & medications</div></div>
              <Btn onClick={async () => { const ok = await requestNotifPerm(); setNotifPerm(ok ? 'granted' : 'denied') }} style={{ background: '#FFC107', borderRadius: 8, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>Allow</Btn>
            </div>
          )}

          {last && last.value >= 250 && <div style={{ background: '#fff3f3', border: '1.5px solid #E24B4A', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}><p style={{ fontSize: 13, color: '#c0392b', fontWeight: 500 }}>⚠️ {last.value} mg/dL is very high! Drink water, contact your doctor.</p></div>}
          {last && last.value < 70 && <div style={{ background: '#fffbf0', border: '1.5px solid #BA7517', borderRadius: 12, padding: '12px 14px', marginBottom: 12 }}><p style={{ fontSize: 13, color: '#7d4e00', fontWeight: 500 }}>⚠️ {last.value} mg/dL is low! Eat something sweet immediately.</p></div>}

          <div className="card" style={{ textAlign: 'center', padding: '20px 16px' }}>
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', textAlign: 'left', marginBottom: 10 }}>Last Reading</p>
            <div style={{ fontSize: 72, fontWeight: 700, lineHeight: 1, color: lastColor, letterSpacing: -2 }}>{last?.value ?? '--'}</div>
            <div style={{ fontSize: 13, color: '#888', marginTop: 2 }}>mg/dL</div>
            {last && <div style={{ display: 'flex', justifyContent: 'center', marginTop: 8 }}><StatusBadge value={last.value} slot={last.slot} /></div>}
            <div style={{ fontSize: 12, color: '#888', marginTop: 8 }}>{last ? `${SLOTS[last.slot].name} · ${last.date}` : 'No readings yet — tap ➕ to start'}</div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginBottom: 12 }}>
            <StatCard label="Today avg" val={todayAvg ?? '--'} color="#1D9E75" sub="mg/dL" />
            <StatCard label="Today readings" val={todayR.length} sub="of 5 slots" />
            <StatCard label="Risk score" val={readings.length ? riskLabel.split(' ')[0] : '--'} color={riskColor} sub={readings.length ? riskScore + '/100' : ''} />
          </div>

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>7-Day Trend</p>
            <ResponsiveContainer width="100%" height={90}>
              <BarChart data={chart7} margin={{ top: 4, right: 4, bottom: 0, left: -32 }}>
                <XAxis dataKey="day" tick={{ fontSize: 9, fill: '#888' }} axisLine={false} tickLine={false} />
                <YAxis tick={false} axisLine={false} tickLine={false} domain={[0, 300]} />
                <ReferenceLine y={180} stroke="#E24B4A" strokeDasharray="3 3" strokeWidth={1} />
                <ReferenceLine y={130} stroke="#BA7517" strokeDasharray="3 3" strokeWidth={1} />
                <Tooltip formatter={(v: number) => [`${v} mg/dL`, 'Avg']} contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.15)' }} />
                <Bar dataKey="avg" radius={[4, 4, 0, 0]} fill="#1D9E75" label={{ position: 'top', fontSize: 8, fill: '#555', formatter: (v: number) => v || '' }} />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Today's medications */}
          {medications.filter(m => m.enabled).length > 0 && (
            <div className="card">
              <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Today&apos;s Medications</p>
              {medications.filter(m => m.enabled).map(m => {
                const todayDoses = doseLogs.filter(d => d.medication_id === m.id && d.taken_at.startsWith(todayStr()))
                const taken = todayDoses.length > 0
                return (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid #f5f5f5' }}>
                    <span style={{ fontSize: 20 }}>💊</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{(m as MedFull).dosage || ''} · {m.time}</div>
                    </div>
                    <Btn onClick={() => logDose(m)} style={{ background: taken ? '#E1F5EE' : '#085041', color: taken ? '#085041' : 'white', borderRadius: 10, padding: '6px 12px', fontSize: 12, fontWeight: 600 }}>
                      {taken ? '✓ Taken' : 'Log Dose'}
                    </Btn>
                  </div>
                )
              })}
            </div>
          )}

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🤖 GPT-4o AI Advisor</p>
            <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', borderRadius: '0 12px 12px 0', padding: 14, minHeight: 70 }}>
              {aiLoading ? <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>Analyzing your readings...</p>
                : aiText ? <><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>AI Advice</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{aiText}</p></>
                : <p style={{ color: '#666', fontSize: 13, fontStyle: 'italic' }}>Record your first reading — AI will advise you instantly.</p>}
            </div>
            <Btn onClick={() => triggerAI(readings)} disabled={aiLoading} style={{ width: '100%', padding: 13, background: '#085041', color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 600, marginTop: 10 }}>{aiLoading ? 'Thinking...' : 'Ask AI for Advice Now'}</Btn>
          </div>
        </div>
      )}

      {/* ── RECORD ── */}
      {tab === 'record' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>Record Blood Glucose</p>
            <input type="number" className="form-input" value={rVal} onChange={e => setRVal(e.target.value)} placeholder="Enter mg/dL" inputMode="numeric" style={{ fontSize: 32, fontWeight: 700, textAlign: 'center', padding: '16px', marginBottom: 12 }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: '#666', display: 'block', marginBottom: 5 }}>Meal slot</label>
                <select className="form-input" value={rSlot} onChange={e => setRSlot(+e.target.value)}>{SLOTS.map((s, i) => <option key={i} value={i}>{s.name}</option>)}</select></div>
              <div><label style={{ fontSize: 12, fontWeight: 500, color: '#666', display: 'block', marginBottom: 5 }}>Date</label>
                <input type="date" className="form-input" value={rDate} onChange={e => setRDate(e.target.value)} /></div>
            </div>
            <input type="text" className="form-input" value={rNote} onChange={e => setRNote(e.target.value)} placeholder="Notes: food, activity, symptoms..." style={{ marginBottom: 12 }} />
            {saveMsg && <div style={{ padding: '10px', borderRadius: 10, background: saveMsg.includes('✅') ? '#E1F5EE' : '#fff3f3', color: saveMsg.includes('✅') ? '#085041' : '#c0392b', fontSize: 13, fontWeight: 500, marginBottom: 10, textAlign: 'center' }}>{saveMsg}</div>}
            <Btn onClick={saveReading} disabled={saving} style={{ width: '100%', padding: 14, background: '#1D9E75', color: 'white', borderRadius: 12, fontSize: 15, fontWeight: 700 }}>{saving ? 'Saving to cloud...' : '💾 Save Reading'}</Btn>
            {notifPerm === 'granted' && <p style={{ fontSize: 11, color: '#888', textAlign: 'center', marginTop: 8 }}>🔔 Will remind you to check again in 2 hours</p>}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Today&apos;s Log</p>
            {todayR.length === 0 ? <p style={{ color: '#888', textAlign: 'center', padding: '20px 0' }}>No readings today</p>
              : todayR.map((r, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: i < todayR.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <div style={{ width: 10, height: 10, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                  <div style={{ flex: 1 }}><div style={{ fontSize: 16, fontWeight: 600 }}>{r.value} mg/dL</div><div style={{ fontSize: 11, color: '#888' }}>{SLOTS[r.slot].name}{r.note ? ` · ${r.note}` : ''}</div></div>
                  <StatusBadge value={r.value} slot={r.slot} />
                </div>
              ))}
          </div>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>Recent History</p>
            {readings.slice(0, 15).map((r, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: i < 14 ? '1px solid #f5f5f5' : 'none' }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: getStatus(r.value, r.slot) === 'normal' ? '#1D9E75' : getStatus(r.value, r.slot) === 'high' ? '#E24B4A' : '#BA7517', flexShrink: 0 }} />
                <div style={{ flex: 1 }}><span style={{ fontSize: 14, fontWeight: 600 }}>{r.value} mg/dL</span><span style={{ fontSize: 11, color: '#888', marginLeft: 8 }}>{r.date} · {SLOTS[r.slot].short}</span></div>
                <StatusBadge value={r.value} slot={r.slot} />
              </div>
            ))}
            {readings.length === 0 && <p style={{ color: '#888', textAlign: 'center', padding: '16px 0' }}>No readings yet</p>}
          </div>
        </div>
      )}

      {/* ── REPORTS ── */}
      {tab === 'reports' && (
        <div style={{ padding: '16px 14px' }}>
          {/* Doctor share card */}
          <div className="card" style={{ background: 'linear-gradient(135deg, #085041, #1D9E75)', color: 'white' }}>
            <p style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 8, opacity: .85 }}>📤 Send Report to Doctor</p>
            {drName
              ? <><p style={{ fontSize: 14, fontWeight: 600, marginBottom: 10 }}>Dr. {drName}</p>
                <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                  {(['daily', 'weekly', 'monthly'] as const).map(p => (
                    <Btn key={p} onClick={() => setReportPeriod(p)} style={{ flex: 1, padding: '6px 4px', fontSize: 11, fontWeight: 600, borderRadius: 8, background: reportPeriod === p ? 'white' : 'rgba(255,255,255,.2)', color: reportPeriod === p ? '#085041' : 'white' }}>{p}</Btn>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {drPhone && <Btn onClick={() => sendReport('whatsapp')} style={{ flex: 1, padding: '10px 6px', background: '#25D366', color: 'white', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>📱 WhatsApp</Btn>}
                  {drTelegram && <Btn onClick={() => sendReport('telegram')} style={{ flex: 1, padding: '10px 6px', background: '#229ED9', color: 'white', borderRadius: 10, fontSize: 13, fontWeight: 600 }}>✈️ Telegram</Btn>}
                </div>
                <Btn onClick={() => setShowDrForm(true)} style={{ marginTop: 8, width: '100%', padding: '7px', background: 'rgba(255,255,255,.15)', color: 'white', borderRadius: 8, fontSize: 12 }}>Edit Doctor Info</Btn>
              </>
              : <><p style={{ fontSize: 13, opacity: .85, marginBottom: 10 }}>Add your doctor&apos;s contact to send reports via WhatsApp or Telegram</p>
                <Btn onClick={() => setShowDrForm(true)} style={{ width: '100%', padding: 12, background: 'white', color: '#085041', borderRadius: 10, fontSize: 14, fontWeight: 700 }}>+ Add Doctor Contact</Btn>
              </>}
          </div>

          {/* Doctor form modal */}
          {showDrForm && (
            <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 300, display: 'flex', alignItems: 'flex-end' }}>
              <div style={{ background: 'white', borderRadius: '20px 20px 0 0', padding: 20, width: '100%', maxWidth: 430, margin: '0 auto' }}>
                <p style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>Doctor Contact</p>
                <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Doctor name</label><input className="form-input" value={drName} onChange={e => setDrName(e.target.value)} placeholder="Dr. Almaz" /></div>
                <div style={{ marginBottom: 12 }}><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>WhatsApp number (with country code)</label><input className="form-input" value={drPhone} onChange={e => setDrPhone(e.target.value)} placeholder="+251911234567" type="tel" /></div>
                <div style={{ marginBottom: 16 }}><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Telegram username</label><input className="form-input" value={drTelegram} onChange={e => setDrTelegram(e.target.value)} placeholder="@doctoralmaz" /></div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <Btn onClick={() => setShowDrForm(false)} style={{ flex: 1, padding: 12, background: '#f0f0f0', color: '#333', borderRadius: 10, fontSize: 14, fontWeight: 600 }}>Cancel</Btn>
                  <Btn onClick={saveDrInfo} style={{ flex: 1, padding: 12, background: '#085041', color: 'white', borderRadius: 10, fontSize: 14, fontWeight: 600 }}>Save</Btn>
                </div>
              </div>
            </div>
          )}

          {/* Targets */}
          <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', padding: '12px 14px', borderRadius: '0 12px 12px 0', marginBottom: 14 }}>
            <p style={{ fontSize: 11, fontWeight: 700, color: '#085041', marginBottom: 8, textTransform: 'uppercase' }}>Your Hospital Targets</p>
            {[['Before breakfast', '80–130'], ['After meals (2h)', '80–180'], ['Before dinner', '80–180']].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '2px 0' }}>
                <span style={{ fontSize: 12, color: '#0F6E56' }}>{l}</span>
                <span style={{ fontSize: 12, fontWeight: 700, color: '#085041', background: 'white', padding: '1px 8px', borderRadius: 8 }}>{v} mg/dL</span>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', background: '#f0f0f0', borderRadius: 12, padding: 4, marginBottom: 14 }}>
            {(['daily', 'weekly', 'monthly'] as const).map(t => (
              <Btn key={t} onClick={() => setReportTab(t)} style={{ flex: 1, padding: '9px 4px', fontSize: 13, fontWeight: 600, borderRadius: 10, background: reportTab === t ? 'white' : 'transparent', color: reportTab === t ? '#085041' : '#888', boxShadow: reportTab === t ? '0 1px 4px rgba(0,0,0,.12)' : 'none' }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </Btn>
            ))}
          </div>

          {reportTab === 'daily' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Daily Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() - 1); setViewDay(d.toISOString().slice(0, 10)) }} ch="‹" />
                  <span style={{ fontSize: 11, fontWeight: 600, minWidth: 90, textAlign: 'center' }}>{fmtDate(viewDay)}</span>
                  <ChevBtn onClick={() => { const d = new Date(viewDay + 'T00:00:00'); d.setDate(d.getDate() + 1); setViewDay(d.toISOString().slice(0, 10)) }} ch="›" />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left' }}>Slot</th><th>Target</th><th>Reading</th><th>Status</th></tr></thead>
                  <tbody>{dailyData.map((d, i) => (<tr key={i}><td className="td-left">{d.slot.name}</td><td style={{ fontSize: 11, color: '#888' }}>{d.slot.target.min}–{d.slot.target.max}</td><td><StatusPill value={d.value} slot={d.i} /></td><td><StatusBadge value={d.value} slot={d.i} /></td></tr>))}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <StatCard label="Day average" val={dailyAvg ? dailyAvg + ' mg/dL' : '--'} color="#1D9E75" />
              <StatCard label="In range" val={dailyVals.length ? `${dailyVals.filter(d => getStatus(d.value!, d.i) === 'normal').length}/${dailyVals.length}` : '--'} />
            </div>
          </>)}

          {reportTab === 'weekly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Weekly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => setViewWeekOff(v => v - 1)} ch="‹" />
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 90, textAlign: 'center' }}>
                    {new Date(weekDays[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – {new Date(weekDays[6] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric' })}
                  </span>
                  <ChevBtn onClick={() => setViewWeekOff(v => v + 1)} ch="›" />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left', minWidth: 50 }}>Day</th>{SLOTS.map(s => <th key={s.short}>{s.short}<br /><small style={{ fontWeight: 400 }}>≤{s.target.max}</small></th>)}<th>Avg</th></tr></thead>
                  <tbody>{weekDays.map(dk => {
                    const dr = readings.filter(r => r.date === dk)
                    const avg = dr.length ? Math.round(dr.reduce((a, r) => a + r.value, 0) / dr.length) : null
                    return <tr key={dk}><td className="td-left">{new Date(dk + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', day: 'numeric' })}</td>{SLOTS.map((_, i) => { const r = dr.find(r => r.slot === i); return <td key={i}><StatusPill value={r?.value ?? null} slot={i} /></td> })}<td><b>{avg ?? '—'}</b></td></tr>
                  })}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              <StatCard label="Week avg" val={weekAvg ? weekAvg + ' mg/dL' : '--'} color="#1D9E75" />
              <StatCard label="In range" val={weekPct !== null ? weekPct + '%' : '--'} />
              <StatCard label="High readings" val={weekR.filter(r => getStatus(r.value, r.slot) === 'high').length} color="#E24B4A" />
              <StatCard label="Total" val={weekR.length} sub="readings" />
            </div>
          </>)}

          {reportTab === 'monthly' && (<>
            <div className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase' }}>Monthly Table</p>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <ChevBtn onClick={() => setViewMonthOff(v => v - 1)} ch="‹" />
                  <span style={{ fontSize: 10, fontWeight: 600, minWidth: 80, textAlign: 'center' }}>{fmtMonth(mY, mM)}</span>
                  <ChevBtn onClick={() => setViewMonthOff(v => v + 1)} ch="›" />
                </div>
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table><thead><tr><th style={{ textAlign: 'left' }}>Week</th><th>Avg</th><th>Range%</th><th>High</th><th>Low</th><th>Total</th></tr></thead>
                  <tbody>{mWeeks.map((wk, wi) => {
                    const wr = monthR.filter(r => wk.includes(r.date))
                    const wa = wr.length ? Math.round(wr.reduce((a, r) => a + r.value, 0) / wr.length) : null
                    const wp = wr.length ? Math.round(wr.filter(r => getStatus(r.value, r.slot) === 'normal').length / wr.length * 100) : null
                    const wh = wr.filter(r => getStatus(r.value, r.slot) === 'high').length
                    const wl = wr.filter(r => getStatus(r.value, r.slot) === 'low').length
                    const ws = new Date(wk[0] + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
                    const we = new Date(wk[wk.length - 1] + 'T00:00:00').toLocaleDateString(undefined, { day: 'numeric' })
                    return <tr key={wi}><td className="td-left">Wk{wi + 1} {ws}–{we}</td><td>{wa ?? '—'}</td><td>{wp !== null ? <span className={`pill ${wp >= 70 ? 'pill-ok' : wp >= 50 ? 'pill-miss' : 'pill-high'}`}>{wp}%</span> : '—'}</td><td>{wh ? <span className="pill pill-high">{wh}</span> : '0'}</td><td>{wl ? <span className="pill pill-low">{wl}</span> : '0'}</td><td>{wr.length}</td></tr>
                  })}</tbody>
                </table>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
              <StatCard label="Month avg" val={monthAvg ? monthAvg + ' mg/dL' : '--'} color="#1D9E75" />
              <StatCard label="In range" val={monthPct !== null ? monthPct + '%' : '--'} />
              <StatCard label="High" val={monthR.filter(r => getStatus(r.value, r.slot) === 'high').length} color="#E24B4A" />
              <StatCard label="Total" val={monthR.length} />
            </div>
            {mhba1c && <div className="card" style={{ marginBottom: 12 }}><p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 8 }}>Estimated HbA1c</p><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><span style={{ fontSize: 13 }}>Based on {monthR.length} readings</span><span className={`pill ${parseFloat(mhba1c) < 7 ? 'pill-ok' : parseFloat(mhba1c) < 9 ? 'pill-miss' : 'pill-high'}`} style={{ fontSize: 15 }}>~{mhba1c}%</span></div><p style={{ fontSize: 11, color: '#888', marginTop: 5 }}>Target: below 7.0% — show this to your doctor</p></div>}
          </>)}
        </div>
      )}

      {/* ── ANALYTICS ── */}
      {tab === 'analytics' && (
        <div style={{ padding: '16px 14px' }}>
          {readings.length === 0
            ? <div className="card" style={{ textAlign: 'center', padding: '40px 20px' }}><p style={{ fontSize: 40 }}>📊</p><p style={{ fontSize: 15, fontWeight: 600, marginTop: 10 }}>No data yet</p><p style={{ fontSize: 13, color: '#888', marginTop: 6 }}>Record glucose readings to see analytics</p></div>
            : <>
              {/* Risk score */}
              <div className="card" style={{ background: `linear-gradient(135deg, ${riskColor}22, ${riskColor}11)`, border: `1.5px solid ${riskColor}44` }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>Overall Risk Score</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <div style={{ fontSize: 52, fontWeight: 700, color: riskColor }}>{riskScore}</div>
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: riskColor }}>{riskLabel}</div>
                    <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>Based on {readings.length} total readings</div>
                    <div style={{ fontSize: 11, color: '#888' }}>{anaHigh} high · {anaLow} low · {anaInRange} in range</div>
                  </div>
                </div>
                <div style={{ height: 8, background: '#e0e0e0', borderRadius: 4, marginTop: 12, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${riskScore}%`, background: riskColor, borderRadius: 4, transition: 'width .5s' }} />
                </div>
              </div>

              {/* Stats overview */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <StatCard label="All-time avg" val={anaAvg + ' mg/dL'} color="#1D9E75" />
                <StatCard label="In range" val={anaPct + '%'} color={anaPct >= 70 ? '#1D9E75' : anaPct >= 50 ? '#BA7517' : '#E24B4A'} sub={`${anaInRange} of ${readings.length}`} />
                <StatCard label="Highest ever" val={anaMax} color="#E24B4A" sub="mg/dL" />
                <StatCard label="Lowest ever" val={anaMin} color="#BA7517" sub="mg/dL" />
              </div>

              {/* Est HbA1c */}
              {hba1cAll && <div className="card" style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 8 }}>Estimated HbA1c (All Time)</p>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ fontSize: 36, fontWeight: 700, color: parseFloat(hba1cAll) < 7 ? '#1D9E75' : '#E24B4A' }}>~{hba1cAll}%</div>
                    <div style={{ fontSize: 11, color: '#888' }}>Target: below 7.0%</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div className={`pill ${parseFloat(hba1cAll) < 7 ? 'pill-ok' : parseFloat(hba1cAll) < 8 ? 'pill-miss' : 'pill-high'}`} style={{ fontSize: 13, marginBottom: 4 }}>
                      {parseFloat(hba1cAll) < 7 ? '✓ Controlled' : parseFloat(hba1cAll) < 8 ? 'Fair' : 'Needs attention'}
                    </div>
                    <div style={{ fontSize: 11, color: '#888' }}>From {readings.length} readings</div>
                  </div>
                </div>
              </div>}

              {/* Pie chart */}
              {pieData.length > 0 && <div className="card">
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>Reading Distribution</p>
                <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                  <ResponsiveContainer width={120} height={120}>
                    <PieChart>
                      <Pie data={pieData} dataKey="value" cx="50%" cy="50%" innerRadius={30} outerRadius={55}>
                        {pieData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>
                  <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {pieData.map(d => (
                      <div key={d.name} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <div style={{ width: 10, height: 10, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
                        <span style={{ fontSize: 12, flex: 1 }}>{d.name}</span>
                        <span style={{ fontSize: 13, fontWeight: 700 }}>{d.value}</span>
                        <span style={{ fontSize: 11, color: '#888' }}>{Math.round(d.value / readings.length * 100)}%</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>}

              {/* 30-day trend line */}
              {trend30.length > 2 && <div className="card">
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>30-Day Trend</p>
                <ResponsiveContainer width="100%" height={110}>
                  <LineChart data={trend30} margin={{ top: 4, right: 4, bottom: 0, left: -32 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 8, fill: '#888' }} axisLine={false} tickLine={false} interval={6} />
                    <YAxis tick={false} axisLine={false} tickLine={false} domain={['auto', 'auto']} />
                    <ReferenceLine y={180} stroke="#E24B4A" strokeDasharray="3 3" strokeWidth={1} />
                    <ReferenceLine y={80} stroke="#BA7517" strokeDasharray="3 3" strokeWidth={1} />
                    <Tooltip formatter={(v: number) => [`${v} mg/dL`, 'Avg']} contentStyle={{ fontSize: 11, borderRadius: 8, border: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.15)' }} />
                    <Line type="monotone" dataKey="avg" stroke="#1D9E75" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>}

              {/* Per-slot performance */}
              <div className="card">
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>Performance by Meal Slot</p>
                {slotPerf.map(sp => (
                  <div key={sp.i} style={{ marginBottom: 10 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ fontSize: 12, fontWeight: 500 }}>{sp.s.name}</span>
                      <span style={{ fontSize: 12, color: '#888' }}>{sp.savg ? sp.savg + ' mg/dL avg' : 'No data'} · {sp.count} readings</span>
                    </div>
                    <div style={{ height: 6, background: '#f0f0f0', borderRadius: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${sp.spct ?? 0}%`, background: (sp.spct ?? 0) >= 70 ? '#1D9E75' : (sp.spct ?? 0) >= 50 ? '#BA7517' : '#E24B4A', borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 10, color: '#888', marginTop: 2 }}>{sp.spct !== null ? sp.spct + '% in range' : ''}</div>
                  </div>
                ))}
              </div>

              {/* Dose log */}
              {doseLogs.length > 0 && <div className="card">
                <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', marginBottom: 10 }}>Recent Dose Log</p>
                {doseLogs.slice(0, 10).map((d, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 9 ? '1px solid #f5f5f5' : 'none' }}>
                    <span style={{ fontSize: 18 }}>💊</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{d.medication_name}{d.dosage ? ` — ${d.dosage}` : ''}</div>
                      <div style={{ fontSize: 11, color: '#888' }}>{new Date(d.taken_at).toLocaleDateString()} at {new Date(d.taken_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
                    </div>
                    <span className="pill pill-ok">✓ Taken</span>
                  </div>
                ))}
              </div>}
            </>
          }
        </div>
      )}

      {/* ── REMIND ── */}
      {tab === 'remind' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>🔔 Notifications</p>
            {notifPerm === 'granted'
              ? <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', background: '#E1F5EE', borderRadius: 10 }}>
                <span style={{ fontSize: 20 }}>✅</span>
                <div><div style={{ fontSize: 13, fontWeight: 600, color: '#085041' }}>Notifications enabled</div><div style={{ fontSize: 11, color: '#0F6E56' }}>You will get glucose & medication reminders</div></div>
              </div>
              : <><p style={{ fontSize: 13, color: '#666', marginBottom: 10 }}>Allow notifications for post-meal glucose reminders and medication alerts.</p>
                <Btn onClick={async () => { const ok = await requestNotifPerm(); setNotifPerm(ok ? 'granted' : 'denied') }} style={{ width: '100%', padding: 13, background: '#1D9E75', color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 700 }}>🔔 Allow Notifications</Btn>
              </>}
          </div>

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>💊 Add Medication</p>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Medication name</label><input type="text" className="form-input" value={medName} onChange={e => setMedName(e.target.value)} placeholder="e.g. Metformin" /></div>
            <div style={{ marginBottom: 10 }}><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Dosage</label><input type="text" className="form-input" value={medDosage} onChange={e => setMedDosage(e.target.value)} placeholder="e.g. 500mg, 1 tablet, 10 units insulin" /></div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Time</label><input type="time" className="form-input" value={medTime} onChange={e => setMedTime(e.target.value)} /></div>
              <div><label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 5 }}>Frequency</label>
                <select className="form-input" value={medFreq} onChange={e => setMedFreq(e.target.value)}>
                  <option value="daily">Every day</option>
                  <option value="twice daily">Twice daily</option>
                  <option value="morning">Morning only</option>
                  <option value="evening">Evening only</option>
                  <option value="with meals">With meals</option>
                  <option value="weekly">Weekly</option>
                </select>
              </div>
            </div>
            <Btn onClick={saveMed} disabled={savingMed} style={{ width: '100%', padding: 13, background: '#085041', color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 600 }}>{savingMed ? 'Saving...' : '+ Add Medication'}</Btn>
          </div>

          {medications.length > 0 && <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>My Medications</p>
            {medications.map((m, idx) => {
              const todayDoses = doseLogs.filter(d => d.medication_id === m.id && d.taken_at.startsWith(todayStr()))
              return (
                <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: idx < medications.length - 1 ? '1px solid #f5f5f5' : 'none' }}>
                  <span style={{ fontSize: 22 }}>💊</span>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{m.name}</div>
                    <div style={{ fontSize: 11, color: '#666', marginTop: 2 }}>
                      {(m as MedFull).dosage && <span style={{ background: '#E1F5EE', color: '#085041', padding: '1px 7px', borderRadius: 8, marginRight: 5, fontWeight: 600, fontSize: 11 }}>{(m as MedFull).dosage}</span>}
                      {m.time} · {(m as MedFull).frequency || 'daily'}
                    </div>
                    {todayDoses.length > 0 && <div style={{ fontSize: 10, color: '#1D9E75', marginTop: 2 }}>✓ Taken {todayDoses.length}x today</div>}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'flex-end' }}>
                    <div onClick={() => m.id && toggleMed(m.id, m.enabled)} style={{ width: 44, height: 26, background: m.enabled ? '#1D9E75' : '#ccc', borderRadius: 13, cursor: 'pointer', position: 'relative' }}>
                      <div style={{ position: 'absolute', width: 22, height: 22, background: 'white', borderRadius: '50%', top: 2, left: m.enabled ? 20 : 2, transition: 'left .2s', boxShadow: '0 1px 3px rgba(0,0,0,.3)' }} />
                    </div>
                    <Btn onClick={() => m.id && deleteMed(m.id)} style={{ background: '#fff3f3', borderRadius: 6, padding: '3px 8px', fontSize: 11, color: '#c0392b' }}>Remove</Btn>
                  </div>
                </div>
              )
            })}
          </div>}

          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 10 }}>⏰ Smart Glucose Reminders</p>
            <div style={{ background: '#f5f9f7', borderRadius: 10, padding: 12 }}>
              <p style={{ fontSize: 13, color: '#444', marginBottom: 8 }}>When you record a reading, app auto-schedules the next check:</p>
              {[['Before breakfast → ', 'After breakfast in 2h'], ['After lunch → ', 'Before dinner in 2h'], ['Before dinner → ', 'After dinner in 2h']].map(([a, b]) => (
                <div key={a} style={{ display: 'flex', gap: 6, fontSize: 12, marginBottom: 4 }}>
                  <span style={{ color: '#1D9E75', fontWeight: 600 }}>{a}</span><span style={{ color: '#666' }}>{b}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── TIPS ── */}
      {tab === 'tips' && (
        <div style={{ padding: '16px 14px' }}>
          <div className="card">
            <p style={{ fontSize: 12, fontWeight: 600, color: '#666', textTransform: 'uppercase', letterSpacing: '.5px', marginBottom: 12 }}>🤖 Ask GPT-4o Anything</p>
            <input type="text" className="form-input" value={askQ} onChange={e => setAskQ(e.target.value)} placeholder="e.g. Is 145 mg/dL normal after injera?" style={{ marginBottom: 10 }} onKeyDown={e => e.key === 'Enter' && askQuestion()} />
            <Btn onClick={askQuestion} disabled={askLoading} style={{ width: '100%', padding: 13, background: '#1D9E75', color: 'white', borderRadius: 12, fontSize: 14, fontWeight: 700 }}>{askLoading ? 'Thinking...' : 'Ask GPT-4o'}</Btn>
            {askAns && <div style={{ background: '#E1F5EE', borderLeft: '4px solid #1D9E75', borderRadius: '0 12px 12px 0', padding: 14, marginTop: 12 }}><p style={{ fontSize: 10, fontWeight: 700, color: '#085041', marginBottom: 6, textTransform: 'uppercase' }}>GPT-4o Answer</p><p style={{ fontSize: 13, lineHeight: 1.6 }}>{askAns}</p></div>}
          </div>
          {[['🍞', 'Injera & glucose', 'Pair injera with protein (lentils, tibs, shiro) to slow sugar absorption and reduce spikes.'],
            ['🚶', 'Walk after meals', '15–30 min walk after eating lowers glucose by 20–40 mg/dL. Even a short walk helps.'],
            ['💧', 'Hydration', 'Drink 6–8 glasses of water daily. Dehydration raises blood glucose significantly.'],
            ['😴', 'Sleep & stress', 'Poor sleep and stress raise glucose. Aim for 7–8 hours sleep.'],
            ['🚨', 'Emergency', 'Go to hospital if above 300 or below 60 mg/dL, or if confused, very weak, or vomiting.'],
          ].map(([icon, title, text]) => (
            <div key={title as string} style={{ background: title === 'Emergency' ? '#fff3f3' : 'white', borderRadius: 12, padding: '13px 14px', marginBottom: 10, boxShadow: '0 1px 4px rgba(0,0,0,.07)' }}>
              <p style={{ fontSize: 13, fontWeight: 700, color: title === 'Emergency' ? '#c0392b' : '#085041', marginBottom: 4 }}>{icon} {title}</p>
              <p style={{ fontSize: 13, lineHeight: 1.5, color: '#444' }}>{text as string}</p>
            </div>
          ))}
        </div>
      )}

      {/* BOTTOM NAV */}
      <div style={{ position: 'fixed', bottom: 0, left: '50%', transform: 'translateX(-50%)', width: '100%', maxWidth: 430, zIndex: 200 }}>
        <nav style={{ display: 'flex', background: 'rgba(255,255,255,0.97)', backdropFilter: 'blur(20px)', borderTop: '0.5px solid #e8e8e8', padding: '6px 0 18px' }}>
          {([['home', '🏠', 'Home'], ['record', '➕', 'Record'], ['reports', '📋', 'Reports'], ['analytics', '📊', 'Analytics'], ['remind', '💊', 'Meds'], ['tips', '💡', 'Tips']] as const).map(([t, icon, label]) => (
            <button key={t} onClick={() => setTab(t)} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, border: 'none', background: 'none', cursor: 'pointer', padding: '4px 1px', color: tab === t ? '#085041' : '#999', fontFamily: 'inherit' }}>
              <span style={{ fontSize: 20 }}>{icon}</span>
              <span style={{ fontSize: 9, fontWeight: tab === t ? 700 : 400 }}>{label}</span>
            </button>
          ))}
        </nav>
      </div>
    </div>
  )
}
