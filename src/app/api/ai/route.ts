import { NextRequest, NextResponse } from 'next/server'

export async function POST(req: NextRequest) {
  try {
    const { prompt, summary } = await req.json()

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        max_tokens: 350,
        messages: [
          {
            role: 'system',
            content: `You are a caring diabetes health advisor. The patient is diabetic living in Addis Ababa, Ethiopia. 
Their doctor's targets from their hospital form:
- Before breakfast (fasting): 80–130 mg/dL
- After breakfast 2h: 80–180 mg/dL  
- After lunch 2h: 80–180 mg/dL
- Before dinner: 80–180 mg/dL
- After dinner 2h: 80–180 mg/dL

Give short, practical, compassionate advice in simple English. 
When relevant, mention Ethiopian foods like injera, tibs, shiro, kitfo, lentils, firfir.
Always end advice with: "Contact your doctor if readings stay high."
Keep responses under 130 words. Be warm and encouraging.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
      }),
    })

    const data = await response.json()
    
    if (data.error) {
      return NextResponse.json({ advice: `AI Error: ${data.error.message}` }, { status: 200 })
    }

    const advice = data.choices?.[0]?.message?.content || 'Could not get a response from AI.'
    return NextResponse.json({ advice })
  } catch (error) {
    console.error('AI API error:', error)
    return NextResponse.json({ advice: 'Could not connect to AI. Please check your internet.' }, { status: 200 })
  }
}
