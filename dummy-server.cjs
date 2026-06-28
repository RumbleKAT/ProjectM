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
    let count = 0;
    const interval = setInterval(() => {
      count++;
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "hello" } }] })}\n\n`);
      if (count > 2) {
        clearInterval(interval);
        res.end();
      }
    }, 100);
  } else {
    res.writeHead(404);
    res.end();
  }
}).listen(1234, '0.0.0.0', () => console.log('Dummy server running on 1234'));
