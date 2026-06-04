import WebSocket from 'ws';

const ws = new WebSocket('ws://localhost:9800');

ws.on('open', () => {
  console.log('Connected to ws://localhost:9800');
  
  const authMsg = {
    type: 'auth',
    userId: 'test-user',
    clientOS: 'win32'
  };
  ws.send(JSON.stringify(authMsg));
});

ws.on('message', (data) => {
  const msg = JSON.parse(data.toString());
  console.log('Received:', msg);
  
  if (msg.type === 'auth_ok') {
    const chatMsg = {
      type: 'chat',
      content: 'hi',
      model: 'deepseek/deepseek-v4-pro'
    };
    ws.send(JSON.stringify(chatMsg));
    console.log('Sent chat message');
  } else if (msg.type === 'session_end') {
    console.log('Session ended, closing...');
    ws.close();
  }
});

ws.on('close', () => {
  console.log('Disconnected');
});

ws.on('error', (err) => {
  console.error('WebSocket error:', err);
});
