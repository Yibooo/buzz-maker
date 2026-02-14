// Cloudflare Function: POST /api/generate
// Calls Gemini 2.5 Flash-Lite to generate buzz-worthy X posts

const SYSTEM_PROMPT = `あなたはX（旧Twitter）のバズ投稿の専門家です。
ユーザーの独り言や思いつきを、Xでバズりやすいポストに変換してください。

## ルール
1. 3つの異なるパターン（共感型、意外性型、ストーリー型）で生成
2. 各ポストは日本語で140字以内
3. 冒頭1行で読者の興味を引く
4. 適切な改行でテンポよく
5. 関連ハッシュタグを2-3個付与
6. 各パターンに「バズりポイント」を1行で解説

## 出力形式
必ず以下のJSON形式のみで出力してください（余計なテキストは不要）:
{
  "posts": [
    {"type": "共感型", "text": "ポスト本文（ハッシュタグ含む）", "tip": "バズりポイントの解説"},
    {"type": "意外性型", "text": "ポスト本文（ハッシュタグ含む）", "tip": "バズりポイントの解説"},
    {"type": "ストーリー型", "text": "ポスト本文（ハッシュタグ含む）", "tip": "バズりポイントの解説"}
  ]
}`;

// Simple in-memory rate limiter (per-isolate, resets on cold start)
const rateLimiter = new Map();
const RATE_LIMIT = 5; // requests per minute per IP
const RATE_WINDOW = 60 * 1000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimiter.get(ip);

  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimiter.set(ip, { windowStart: now, count: 1 });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  // CORS headers
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };

  // Handle preflight
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Rate limit check
  const clientIP = request.headers.get("CF-Connecting-IP") || "unknown";
  if (!checkRateLimit(clientIP)) {
    return new Response(
      JSON.stringify({ success: false, error: "レート制限中です。1分後にお試しください。" }),
      { status: 429, headers: corsHeaders }
    );
  }

  try {
    // Parse request body
    const body = await request.json();
    const input = (body.input || "").trim();

    if (!input) {
      return new Response(
        JSON.stringify({ success: false, error: "入力テキストが空です" }),
        { status: 400, headers: corsHeaders }
      );
    }

    if (input.length > 500) {
      return new Response(
        JSON.stringify({ success: false, error: "入力は500文字以内にしてください" }),
        { status: 400, headers: corsHeaders }
      );
    }

    // Get API key from environment
    const apiKey = env.GEMINI_API_KEY;
    if (!apiKey) {
      return new Response(
        JSON.stringify({ success: false, error: "APIキーが設定されていません" }),
        { status: 500, headers: corsHeaders }
      );
    }

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash-lite:generateContent?key=${apiKey}`;

    const geminiRes = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: {
          parts: [{ text: SYSTEM_PROMPT }],
        },
        contents: [
          {
            parts: [{ text: `以下の独り言・思いつきをバズるXポストに変換してください:\n\n「${input}」` }],
          },
        ],
        generationConfig: {
          temperature: 0.9,
          topP: 0.95,
          maxOutputTokens: 1024,
          responseMimeType: "application/json",
        },
      }),
    });

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini API error:", geminiRes.status, errText);
      return new Response(
        JSON.stringify({
          success: false,
          error: `AI生成に失敗しました (${geminiRes.status})`,
          detail: errText.substring(0, 200),
        }),
        { status: 502, headers: corsHeaders }
      );
    }

    const geminiData = await geminiRes.json();

    // Extract text from Gemini response
    const rawText =
      geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    if (!rawText) {
      return new Response(
        JSON.stringify({ success: false, error: "AIからの応答が空です" }),
        { status: 502, headers: corsHeaders }
      );
    }

    // Parse the JSON response
    let parsed;
    try {
      // Try direct parse first
      parsed = JSON.parse(rawText);
    } catch {
      // Try to extract JSON from markdown code blocks
      const jsonMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (jsonMatch) {
        parsed = JSON.parse(jsonMatch[1].trim());
      } else {
        // Last resort: find JSON object in text
        const objMatch = rawText.match(/\{[\s\S]*\}/);
        if (objMatch) {
          parsed = JSON.parse(objMatch[0]);
        } else {
          throw new Error("JSONパースに失敗");
        }
      }
    }

    // Validate structure
    if (!parsed.posts || !Array.isArray(parsed.posts) || parsed.posts.length === 0) {
      return new Response(
        JSON.stringify({ success: false, error: "生成結果の形式が不正です" }),
        { status: 502, headers: corsHeaders }
      );
    }

    // Ensure each post has required fields
    const posts = parsed.posts.map((p) => ({
      type: p.type || "不明",
      text: p.text || "",
      tip: p.tip || "",
    }));

    return new Response(
      JSON.stringify({ success: true, posts }),
      { status: 200, headers: corsHeaders }
    );
  } catch (err) {
    console.error("Generate error:", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: "生成処理でエラーが発生しました",
        detail: err.message,
      }),
      { status: 500, headers: corsHeaders }
    );
  }
}
