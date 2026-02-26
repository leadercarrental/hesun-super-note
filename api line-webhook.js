export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(200).send("OK");
  }

  const events = req.body.events || [];

  for (const event of events) {
    if (event.type === "message" && event.message.type === "text") {
      const userText = (event.message.text || "").trim();

      let replyText = "";

      // ✅ 司機快捷：陳俊豪
      if (userText === "陳俊豪") {
        replyText =
          "司機：陳俊豪\n" +
          "電話：0973550190\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
      }
      // ✅ 司機快捷：陳正紘
      else if (userText === "陳正紘") {
        replyText =
          "司機：陳正紘\n" +
          "電話：0937429798\n" +
          "車號：RFD-\n" +
          "車型：豪華新大T保母車";
      }
      // 其他狀況：先原樣回覆（之後會改成 AI 派車單）
      else {
        replyText = `你剛剛傳的是：\n${userText}`;
      }

      await replyMessage(event.replyToken, replyText);
    }
  }

  return res.status(200).send("OK");
}

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
