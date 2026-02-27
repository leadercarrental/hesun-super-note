// api/line-webhook.js
// 賀森超強筆記 v2.0 — Gemini AI 強化解析版
// 使用 Google Gemini 解析 → 統一輸出派車單格式

// -----------------------------------------------------------
//  1) 這段是你給 AI 的要求（SYSTEM PROMPT）
// -----------------------------------------------------------
const SYSTEM_PROMPT = `
你是一個專門協助整理「機場接送派車單」的智能助手。
使用者會傳給你一大段文字，你需要從裡面整理出派車單需要的資料，
並以 JSON 物件方式輸出：

{
  "job_tag": "",
  "date": "",
  "flight": "",
  "pickup_time": "",
  "guest_name": "",
  "guest_phone": "",
  "addresses": [],
  "people_count": "",
  "luggage": "",
  "child_seat": "",
  "remark": "",
  "payment": "",
  "car_type": ""
}

規則如下：

1) job_tag（放在 📍【】）
   若文字中有：送機、接機、單接、單送 → 擷取最先出現的
   無則空白 ""

2) date：抓第一個出現的日期格式，如 2/27、02/27、2026/02/27

3) flight：抓像 JX851/19:05、BR166/06:15 這樣的字串

4) pickup_time：
   若使用者有寫「載客時間 00:45」→ 使用該時間
   若 job_tag = 接機，且無載客時間 → 使用 flight 的時間

5) guest_name：
   電話前一行通常是姓名，因此從電話前一行擷取（若無則留空）

6) guest_phone：
   找第一個符合 09xxxxxxxx 的手機號碼

7) addresses：
   找所有包含「市 / 區 / 路 / 街 / 巷 / 號」的行 → 視為地址
   支援一行多個地址，以「、，,；;」切開

8) people_count：
   支援格式：
   - 7位、7人
   - 人數五位貴賓（中文數字要轉成阿拉伯數字）

9) child_seat：
   若包含：小朋友/兒童 + 數字 + 安全座椅 → 例如「需要安全座椅 1 位」
   若只有提到安全座椅 → "需要安全座椅"

10) payment：
   支援：
   - 收現金7000
   - 收 7000
   - 收款：現金 5000
   若金額有出現但無付款方式 → 視為「現金」

11) remark：
   不屬於日期、航班、電話、人數、地址、付款、車型的句子，都放入 remark，例如：
   - 請至環宇接貴賓
   - 會在環宇內用餐

12) car_type：
   支援關鍵字：
   - 豪華新大T → "豪華新大T保母車"
   - 大T / 大 T → "大T"
   - Caddy → "Caddy"
   - Touran → "Touran"

請務必只輸出 JSON，不要加任何解釋文字。
`;

// --------------------------------------------------------------------
//  2) Gemini API 呼叫函式
// --------------------------------------------------------------------
async function generateDispatchSheetGemini(rawText) {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const url = "https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=" + apiKey;

    const payload = {
      contents: [
        { role: "system", parts: [{ text: SYSTEM_PROMPT }] },
        { role: "user", parts: [{ text: rawText }] }
      ]
    };

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const data = await response.json();

    // 若 Gemini 回 error
    if (data.error) {
      console.error("Gemini Error:", data.error);
      return `（AI 錯誤：${data.error.message}）\n\n${rawText}`;
    }

    let text = data.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // 一些 Gemini 會給 ```json ... ``` → 我們處理掉
    text = text.replace(/```json/g, "").replace(/```/g, "").trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch (e) {
      console.error("解析 JSON 失敗：", text);
      return `（AI 回傳格式錯誤）\n${text}`;
    }

    return buildDispatchText(parsed);

  } catch (err) {
    console.error("Gemini 呼叫失敗：", err);
    return `（AI 呼叫失敗）\n\n${rawText}`;
  }
}

// --------------------------------------------------------------------
//  3) 組織派車單輸出格式（你的最終格式）
// --------------------------------------------------------------------
function buildDispatchText(data) {
  return `
✈️機場接送🚗預約單

📍【${data.job_tag || ""}】

◆日期📅：${data.date || ""}
◆航班名稱✈️：${data.flight || ""}
◆載客時間🕰️：${data.pickup_time || ""}
◆貴賓：${data.guest_name || ""}
◆電話：${data.guest_phone || ""}
◆地址：
${(data.addresses || []).map((a,i)=>`${i+1}. ${a}`).join("\n")}

◆人數：${data.people_count || ""}
◆行李：${data.luggage || ""}
◆有無安全座椅：${data.child_seat || ""}

🌟備註：
${data.remark || ""}

司機：
電話：
車號：
車型：${data.car_type || ""}
➖➖➖➖➖➖➖➖➖➖
收款方式：${data.payment || ""}
`.trim();
}

// --------------------------------------------------------------------
//  4) LINE Webhook 主入口
// --------------------------------------------------------------------
async function handler(req, res) {
  if (req.method !== "POST") return res.status(200).send("OK");

  const body = req.body || {};
  const events = body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const text = event.message.text.trim();

      // 🚗 司機快捷
      if (text === "陳俊豪") {
        await replyMessage(event.replyToken, "司機：陳俊豪\n電話：0973550190\n車號：RFD-\n車型：豪華新大T保母車");
        continue;
      }
      if (text === "陳正紘") {
        await replyMessage(event.replyToken, "司機：陳正紘\n電話：0937429798\n車號：RFD-\n車型：豪華新大T保母車");
        continue;
      }

      // 🧠 Gemini 智能解析派車單
      const result = await generateDispatchSheetGemini(text);
      await replyMessage(event.replyToken, result);
    }
  }

  res.status(200).send("OK");
}

// --------------------------------------------------------------------
//  5) 發送 LINE 回覆 API
// --------------------------------------------------------------------
async function replyMessage(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;
  if (!accessToken) return;

  await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({
      replyToken,
      messages: [{ type: "text", text }]
    })
  });
}

// --------------------------------------------------------------------
module.exports = handler;
