const http = require('http');
http.createServer((req, res) => {
  if (req.url === '/v1/models') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      object: 'list',
      data: [{ id: 'google/gemma-4-12b-qat', object: 'model' }]
    }));
  } else if (req.url === '/v1/chat/completions') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      id: 'chatcmpl-123',
      object: 'chat.completion',
      created: Date.now(),
      model: 'google/gemma-4-12b-qat',
      choices: [{ index: 0, message: { role: 'assistant', content: 'Hello from dummy' }, finish_reason: 'stop' }]
    }));
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(1234, '0.0.0.0', () => console.log('Dummy server running on 1234'));
