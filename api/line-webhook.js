// api/line-webhook.js

export default async function handler(req, res) {
  // 只處理 POST，其他直接回 OK
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const events = req.body.events || [];

  // 逐一處理 LINE 傳來的事件
  for (const event of events) {
    // 我們先只處理「文字訊息」
    if (event.type === "message" && event.message.type === "text") {
      const userText = (event.message.text || "").trim();

      // 這裡先做一個簡單版本：把你講的話原封不動回給你
      const replyText = `你剛剛傳的是：\n${userText}`;

      await replyMessage(event.replyToken, replyText);
    }
  }

  // 一定要回 200 給 LINE，表示 Webhook 收到了
  return res.status(200).send("OK");
}

// 呼叫 LINE 的 Reply API
async function replyMessage(replyToken, text) {
  const accessToken = process.env.LINE_CHANNEL_ACCESS_TOKEN;

  if (!accessToken) {
    console.error("沒有找到 LINE_CHANNEL_ACCESS_TOKEN 環境變數！");
    return;
  }

  const body = {
    replyToken,
    messages: [
      {
        type: "text",
        text,
      },
    ],
  };

  try {
    const res = await fetch("https://api.line.me/v2/bot/message/reply", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("回覆 LINE 失敗：", res.status, errText);
    }
  } catch (err) {
    console.error("呼叫 LINE Reply API 發生錯誤：", err);
  }
}
