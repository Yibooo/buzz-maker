// Cloudflare Function: POST /api/generate
// Calls Gemini 2.5 Flash-Lite to generate buzz-worthy X posts

const SYSTEM_PROMPT = `あなたはフォロワー10万人超のXインフルエンサー兼バズ投稿コンサルタントです。
Xアルゴリズムの仕組みを熟知しており、リポスト（×20倍）、リプライ（×13.5倍）、ブックマーク（×10倍）の重み付けを意識した投稿を設計します。

## バズの鉄則（E.H.A.フレームワーク）
- Emotion（感情トリガー）: 高覚醒感情（驚き・共感・怒り・笑い・感動）を冒頭で刺激する
- Hook（フック）: 最初の1行で「スクロールを止める」。疑問形、断言、数字、逆説のいずれかを使う
- Action（行動喚起）: リプしたくなる問い / 保存したくなる有益さ / シェアしたくなる共感を仕込む

## 文章構造ルール
1. 冒頭1行 = フック（ここで9割が決まる）。絶対に平凡な書き出しにしない
2. 2-3行ごとに改行を入れてテンポよく（スマホで読みやすく）
3. 各ポストは日本語で140字以内
4. ハッシュタグは本文の流れを壊さないよう末尾に2個以内（関連性の高いもののみ）
5. 絵文字は効果的に1-2個（多用しない）
6. 最後の1行で余韻 or 行動喚起を残す

## 7つのバズパターン
ユーザーの入力内容に最も適した7パターンを以下から生成:

1. 共感型: 「わかる！」を引き出す → いいね＋リポスト狙い。「〇〇な人、私だけじゃないはず」形式
2. 逆張り型: 常識への挑戦 → 議論誘発でリプライ爆増。「〇〇って実は△△だと思う」形式
3. 数字・実績型: 具体的な数字で信頼感 → ブックマーク狙い。「3ヶ月で〇〇した方法」形式
4. 問いかけ型: 読者に質問 → リプライ率+29%。「〇〇と△△、どっち派？」形式
5. ストーリー型: 体験談で感情の起伏 → 滞在時間UP。「昨日〇〇したら...（結末が気になる構造）」形式
6. 保存させる型: 有益情報リスト → ブックマーク×10。「知らないと損する〇〇」形式
7. 一言パンチ型: 短文で刺す → 拡散しやすい。ワンフレーズで核心を突く形式

## バズスコア（各ポストに付与）
以下の3軸で5段階評価し、合計を「buzzScore」(最大15)として出力:
- hook: フックの強さ（1-5）
- emotion: 感情喚起度（1-5）
- share: シェア誘導度（1-5）

## 出力形式
必ず以下のJSON形式のみで出力してください（余計なテキストは不要）:
{
  "posts": [
    {"type": "共感型", "text": "ポスト本文", "tip": "なぜバズるかの1行解説", "buzzScore": {"hook": 4, "emotion": 5, "share": 4}},
    {"type": "逆張り型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 5, "emotion": 4, "share": 3}},
    {"type": "数字・実績型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 4, "emotion": 3, "share": 5}},
    {"type": "問いかけ型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 4, "emotion": 4, "share": 4}},
    {"type": "ストーリー型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 5, "emotion": 5, "share": 3}},
    {"type": "保存させる型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 3, "emotion": 3, "share": 5}},
    {"type": "一言パンチ型", "text": "ポスト本文", "tip": "解説", "buzzScore": {"hook": 5, "emotion": 4, "share": 5}}
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
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`;

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
          maxOutputTokens: 2048,
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
      buzzScore: p.buzzScore || { hook: 3, emotion: 3, share: 3 },
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
