/**
 * 飞书机器人 - Coze API 桥接服务
 * 部署到 Vercel（免费）
 */

const COZE_API_URL = "https://ft5fwbmsx7.coze.site/stream_run";
const PROJECT_ID = "7621223759432646694";
const SESSION_MAP = new Map();

module.exports = async (req, res) => {
  // CORS 支持
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    res.status(405).json({ message: 'Method not allowed' });
    return;
  }

  try {
    const body = req.body;
    console.log('Received:', JSON.stringify(body));
    
    // 飞书挑战验证
    if (body.type === 'url_verification') {
      console.log('URL verification challenge:', body.challenge);
      res.json({ challenge: body.challenge });
      return;
    }

    // 处理消息事件
    if (body.header && body.header.event_type === 'im.message.receive_v1') {
      const event = body.event;
      const message = event.message;
      const sender = event.sender;
      
      // 只处理文本消息
      if (message.message_type !== 'text') {
        res.status(200).json({ message: 'OK' });
        return;
      }

      // 忽略机器人自己的消息
      if (sender.sender_type === 'bot') {
        res.status(200).json({ message: 'OK' });
        return;
      }

      // 获取用户输入
      const content = JSON.parse(message.content);
      const userText = content.text;
      const openId = sender.sender_id.open_id;

      console.log(`Message from ${openId}: ${userText}`);

      // 获取或创建会话 ID
      let sessionId = SESSION_MAP.get(openId);
      if (!sessionId) {
        sessionId = `sess_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        SESSION_MAP.set(openId, sessionId);
      }

      // 调用 Coze API
      const cozeResponse = await fetch(COZE_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${process.env.COZE_API_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          content: {
            query: {
              prompt: [{
                type: 'text',
                content: {
                  text: userText
                }
              }]
            }
          },
          type: 'query',
          session_id: sessionId,
          project_id: PROJECT_ID
        })
      });

      const cozeData = await cozeResponse.json();
      console.log('Coze response:', JSON.stringify(cozeData));
      
      // 解析 Coze 响应
      let botReply = '抱歉，暂时无法获取回复。';
      if (cozeData.data && cozeData.data.answer) {
        botReply = cozeData.data.answer;
      } else if (cozeData.content) {
        botReply = cozeData.content;
      }

      console.log(`Reply: ${botReply}`);

      // 回复消息到飞书
      await sendFeishuMessage(openId, botReply, message.message_id);

      res.status(200).json({ message: 'OK' });
      return;
    }

    res.status(200).json({ message: 'OK' });

  } catch (error) {
    console.error('Error:', error.message);
    res.status(500).json({ message: `Error: ${error.message}` });
  }
};

/**
 * 发送消息到飞书
 */
async function sendFeishuMessage(openId, text, replyMessageId) {
  const FEISHU_APP_ID = process.env.FEISHU_APP_ID;
  const FEISHU_APP_SECRET = process.env.FEISHU_APP_SECRET;

  if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
    console.error('Missing Feishu credentials');
    return;
  }

  // 获取 tenant_access_token
  const tokenResponse = await fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: FEISHU_APP_ID,
      app_secret: FEISHU_APP_SECRET
    })
  });

  const tokenData = await tokenResponse.json();
  const tenantToken = tokenData.tenant_access_token;

  if (!tenantToken) {
    console.error('Failed to get tenant token:', tokenData);
    return;
  }

  // 发送消息
  const messageResponse = await fetch('https://open.feishu.cn/open-apis/im/v1/messages', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${tenantToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      receive_id: openId,
      receive_id_type: 'open_id',
      msg_type: 'text',
      content: JSON.stringify({ text }),
      reply_id: replyMessageId
    })
  });

  const messageData = await messageResponse.json();
  console.log('Feishu send result:', messageData);
  return messageData;
}
