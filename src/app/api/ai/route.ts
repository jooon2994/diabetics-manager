import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY
  
  if (!apiKey) {
    console.error('OPENAI_API_KEY is not set')
    return NextResponse.json({ advice: '⚠️ AI not configured. Please add OPENAI_API_KEY in Vercel environment variables.' })
  }

  try {
    const { prompt } = await req.json()

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 350,
        messages: [
          {
            role: 'system',
            content: `You are a caring diabetes health advisor. The patient is diabetic living in Addis Ababa, Ethiopia. 
Their doctor's targets:
- Before breakfast (fasting): 80–130 mg/dL
- After all meals (2h): 80–180 mg/dL

Give short practical compassionate advice in simple English. 
Mention Ethiopian foods (injera, tibs, shiro, lentils) when relevant.
Always end with: "Contact your doctor if readings stay high."
Keep under 130 words.`,
          },
          { role: 'user', content: prompt },
        ],
      }),
    })

    const data = await response.json()

    if (!response.ok) {
      console.error('OpenAI error:', data.error)
      return NextResponse.json({ advice: `AI Error: ${data.error?.message || 'Unknown error'}` })
    }

    const advice = data.choices?.[0]?.message?.content || 'No response from AI.'
    return NextResponse.json({ advice })

  } catch (error) {
    console.error('AI route error:', error)
    return NextResponse.json({ advice: 'Could not connect to AI. Check your internet connection.' })
  }
}
